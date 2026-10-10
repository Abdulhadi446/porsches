/**
 * ASSET-MEDIA — upload the generated media trees to Cloudflare R2.
 *
 * The two large generated trees — `public/images/**` (AVIF/WebP renders) and
 * `public/turntables/**` (frame sequences) — are gitignored because they are
 * ~500 MB of already-compressed, reproducible artefacts. This script pushes
 * them to a Cloudflare R2 bucket over its S3-compatible API so the deployed
 * site can serve them from a custom domain (`NEXT_PUBLIC_MEDIA_HOST`).
 *
 * Models, sounds and the Draco/Basis decoders stay committed under `public/`
 * and are NOT uploaded — they are small and versioned on purpose.
 *
 * R2 is S3-compatible, so this talks plain SigV4 over `fetch`; no AWS SDK, no
 * new dependency. Credentials come from an R2 API token with object read+write
 * (Account → R2 → API tokens). The account id and bucket default to this
 * project's values; the key/secret are read from `Access_Key_ID` /
 * `Secret_Access_Key` (the names `.env` uses) or the `R2_*` aliases.
 *
 * Safety:
 *  - never deletes objects it did not find locally; it only PUTs. A re-run is
 *    idempotent and skips unchanged files (same size, via a signed HEAD)
 *    unless `--force`.
 *  - `public/images/_placeholder/**` is skipped and must never be uploaded: the
 *    code serves it from the un-rewritten /images/ path as a local fallback.
 *  - R2 rejects ListObjectsV2 (501) and this token cannot list (403), so
 *    deletions are by explicit key only.
 *
 * Usage:
 *   node scripts/upload-r2.ts [--images] [--turntables] [--dry-run] [--force]
 *   node scripts/upload-r2.ts --delete-only public/images/_placeholder/x.svg
 *
 * Defaults to uploading both trees when neither --images nor --turntables is
 * given. Concurrency: R2_CONCURRENCY (default 8).
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// Load .env if present, so `node scripts/upload-r2.ts` works without a manual
// `set -a; . ./.env`. Never overwrites an already-exported variable.
try {
  process.loadEnvFile(path.join(ROOT, ".env"));
} catch {
  // no .env — fall back to the ambient environment
}

// Credential names mirror `.env` (Access_Key_ID / Secret_Access_Key); the
// R2_* aliases are accepted too. The account id and bucket default to this
// project's values but stay overridable.
const ACCOUNT_ID =
  process.env.R2_ACCOUNT_ID ?? "3849f17a9bbe8ad4f0af846f269c30a9";
const ACCESS_KEY = process.env.R2_ACCESS_KEY_ID ?? process.env.Access_Key_ID ?? "";
const SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY ?? process.env.Secret_Access_Key ?? "";
const BUCKET = process.env.R2_BUCKET ?? "porsches";

const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const DRY = args.includes("--dry-run");
// --delete-only: run the explicit-key deletions and nothing else, so a cleanup
// can never accidentally start an upload.
const DELETE_ONLY = args.includes("--delete-only");
const hasTreeFlag = args.includes("--images") || args.includes("--turntables");
const doImages = !DELETE_ONLY && (hasTreeFlag ? args.includes("--images") : true);
const doTurntables = !DELETE_ONLY && (hasTreeFlag ? args.includes("--turntables") : true);
/** Explicit object keys to delete (positional args starting with public/). */
const deleteKeys = args.filter((a) => a.startsWith("public/"));
/** Parallel in-flight requests. R2 handles concurrent PUTs fine. */
const CONCURRENCY = Math.max(1, Number(process.env.R2_CONCURRENCY ?? 8));

/* ------------------------------------------------------------- SigV4 signing */

const SERVICE = "s3";
const REGION = "auto"; // R2 ignores the region but SigV4 requires a value

function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}
function sha256Hex(data: string | Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/** Minimal SigV4 signer for a single PUT object request. */
function signPut(
  key: string,
  body: Buffer,
  contentType: string,
): { url: string; headers: Record<string, string> } {
  const host = `${ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const url = `https://${host}/${BUCKET}/${key}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);

  const canonicalUri = `/${BUCKET}/${key}`.split("/").map(encodeURIComponent).join("/");
  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = ["PUT", canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");

  const scope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");

  const kDate = hmac(`AWS4${SECRET_KEY}`, dateStamp);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  const kSigning = hmac(kService, "aws4_request");
  const signature = hmac(kSigning, stringToSign).toString("hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${ACCESS_KEY}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    url,
    headers: {
      "content-type": contentType,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      authorization,
    },
  };
}

/* --------------------------------------------------------------- walk + mime */

const MIME: Record<string, string> = {
  ".avif": "image/avif",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".glb": "model/gltf-binary",
};

function* walk(dir: string): Generator<string> {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

interface Counters {
  uploaded: number;
  /** files already identical in the bucket (or skipped by rule) */
  skipped: number;
  failed: number;
  bytes: number;
  /** finished work items, for the progress line */
  done: number;
  total: number;
  /** true in --dry-run, so the summary can say "would upload" */
  dry: boolean;
}

function progress(counters: Counters): void {
  // one line every 25 items, not a per-file \r — a progress line per file is
  // unreadable in a captured log
  if (counters.done % 25 !== 0 && counters.done !== counters.total) return;
  process.stdout.write(
    `${counters.done}/${counters.total}  ` +
      `↑${counters.uploaded} skip${counters.skipped} fail${counters.failed}  ` +
      `${(counters.bytes / (1024 * 1024)).toFixed(1)} MB\n`,
  );
}

/** Upload one file, honouring DRY / FORCE / skip rules. */
async function uploadFile(file: string, counters: Counters): Promise<void> {
  const key = path.relative(ROOT, file).split(path.sep).join("/");
  // The placeholder must stay a *local* deploy fallback, never a bucket
  // object: the code path that serves it is the un-rewritten /images/ path.
  if (key.startsWith("public/images/_placeholder/")) {
    counters.skipped++;
    counters.done++;
    return;
  }
  const stat = fs.statSync(file);
  const mime = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";

  if (DRY) {
    // never touch the network in a dry run: count the file as one that *would*
    // be uploaded, without the HEAD that would decide skip-vs-upload
    counters.uploaded++;
    counters.bytes += stat.size;
    counters.done++;
    progress(counters);
    return;
  }

  if (!FORCE) {
    try {
      const exists = await withRetry(() => headObject(key));
      if (exists && exists.size === stat.size) {
        counters.skipped++;
        counters.done++;
        progress(counters);
        return;
      }
    } catch {
      // a HEAD failure is not fatal — fall through and just PUT the file
    }
  }

  const body = fs.readFileSync(file);
  const { url, headers } = signPut(key, body, mime);
  try {
    const res = await withRetry(() => fetch(url, { method: "PUT", headers, body }));
    if (res.ok) {
      counters.uploaded++;
      counters.bytes += stat.size;
    } else {
      counters.failed++;
      console.error(`\n  ✗ ${key}: ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    // a single failed file must not abort the other thousands in flight
    counters.failed++;
    console.error(`\n  ✗ ${key}: ${(err as Error).message}`);
  }
  counters.done++;
  progress(counters);
}

/** Run `worker` over `files` with at most `limit` in flight. */
async function runPool<T>(
  files: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const lanes = Array.from({ length: Math.min(limit, files.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= files.length) return;
      await worker(files[i]);
    }
  });
  await Promise.all(lanes);
}

/** Transient network failures R2/undici can throw; worth retrying. */
function isTransient(err: unknown): boolean {
  const code = (err as { cause?: { code?: string } })?.cause?.code ?? "";
  return (
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "EPIPE" ||
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    code === "UND_ERR_HEADERS_TIMEOUT" ||
    code === "ENETUNREACH"
  );
}

/** `fn`, retried with backoff on transient network errors. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransient(err) || i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
  throw lastErr;
}

async function uploadTree(relDir: string, counters: Counters): Promise<void> {
  const abs = path.join(ROOT, relDir);
  if (!fs.existsSync(abs)) {
    console.log(`  (missing) ${relDir} — nothing to upload; run the asset scripts first`);
    return;
  }
  const files = [...walk(abs)];
  counters.total += files.length;
  await runPool(files, CONCURRENCY, (file) => uploadFile(file, counters));
}

/** Cheap existence + size probe via a signed HEAD (S3-compatible). */
async function headObject(key: string): Promise<{ size: number } | null> {
  const host = `${ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const url = `https://${host}/${BUCKET}/${key}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const canonicalUri = `/${BUCKET}/${key}`.split("/").map(encodeURIComponent).join("/");
  const canonicalHeaders = `host:${host}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-date";
  const canonicalRequest = ["HEAD", canonicalUri, "", canonicalHeaders, signedHeaders, ""].join("\n");
  const scope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const kDate = hmac(`AWS4${SECRET_KEY}`, dateStamp);
  const kSigning = hmac(hmac(hmac(kDate, REGION), SERVICE), "aws4_request");
  const signature = hmac(kSigning, stringToSign).toString("hex");
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${ACCESS_KEY}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(url, { method: "HEAD", headers: { "x-amz-date": amzDate, authorization } });
  if (!res.ok) return null;
  const size = Number(res.headers.get("content-length") ?? -1);
  return size >= 0 ? { size } : null;
}

/** Signed DELETE. R2 implements DELETE even though it rejects ListObjectsV2. */
async function deleteObject(key: string): Promise<boolean> {
  const host = `${ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const url = `https://${host}/${BUCKET}/${key}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const canonicalUri = `/${BUCKET}/${key}`.split("/").map(encodeURIComponent).join("/");
  const payloadHash = sha256Hex("");
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = ["DELETE", canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const kDate = hmac(`AWS4${SECRET_KEY}`, dateStamp);
  const kSigning = hmac(hmac(hmac(kDate, REGION), SERVICE), "aws4_request");
  const signature = hmac(kSigning, stringToSign).toString("hex");
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${ACCESS_KEY}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(url, {
    method: "DELETE",
    headers: { "x-amz-date": amzDate, "x-amz-content-sha256": payloadHash, authorization },
  });
  return res.ok || res.status === 204;
}

/* --------------------------------------------------------------------- main */

async function main() {
  if (!DRY && (!ACCOUNT_ID || !ACCESS_KEY || !SECRET_KEY || !BUCKET)) {
    console.error(
      "missing credentials: put Access_Key_ID and Secret_Access_Key (R2 API " +
        "token) in .env — optionally R2_ACCOUNT_ID / R2_BUCKET to override the " +
        "defaults — or pass --dry-run to preview the file list.",
    );
    process.exit(1);
  }

  const counters: Counters = {
    uploaded: 0,
    skipped: 0,
    failed: 0,
    bytes: 0,
    done: 0,
    total: 0,
    dry: DRY,
  };
  console.log(`${DRY ? "[dry-run] " : ""}uploading to r2 bucket "${BUCKET}"…`);
  if (doImages) {
    console.log("images:");
    await uploadTree("public/images", counters);
  }
  if (doTurntables) {
    console.log("turntables:");
    await uploadTree("public/turntables", counters);
  }

  // --delete <public/… key…> (or --delete-only with keys): remove objects that
  // must not live in the bucket (the placeholder is a local fallback). R2 has
  // no working ListObjects, so keys are named explicitly, never discovered.
  if (deleteKeys.length) process.stdout.write("\n");
  for (const key of deleteKeys) {
    if (DRY) {
      console.log(`  [dry] delete ${key}`);
      continue;
    }
    const ok = await deleteObject(key);
    console.log(`  ${ok ? "✓ deleted" : "✗ delete failed"} ${key}`);
    if (!ok) counters.failed++;
  }

  if (counters.total) process.stdout.write("\n");
  const mb = (counters.bytes / (1024 * 1024)).toFixed(1);
  console.log(
    `done: ${counters.uploaded} ${counters.dry ? "would upload" : "uploaded"} (${mb} MB), ` +
      `${counters.skipped} skipped, ${counters.failed} failed`,
  );
  if (counters.failed > 0) process.exit(1);
}

void main();
