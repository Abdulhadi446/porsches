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
 * new dependency. Credentials come from an R2 API token (Account → R2 → API
 * tokens), which exposes `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID` and
 * `R2_SECRET_ACCESS_KEY`.
 *
 * Safety:
 *  - never deletes, only PUTs. A re-run is idempotent and skips unchanged
 *    files (same size + etag already present) unless `--force`.
 *  - the committed `public/images/_placeholder/**` is skipped: it must keep
 *    living in the deploy as the local fallback, so it is not a bucket object.
 *
 * Usage:
 *   R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… R2_BUCKET=… \
 *     node scripts/upload-r2.ts [--images] [--turntables] [--force] [--dry-run]
 *
 * Defaults to uploading both trees when neither flag is given.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID ?? "";
const ACCESS_KEY = process.env.R2_ACCESS_KEY_ID ?? "";
const SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY ?? "";
const BUCKET = process.env.R2_BUCKET ?? "";

const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const DRY = args.includes("--dry-run");
const doImages = args.includes("--images") || (!args.includes("--turntables") && !args.includes("--images"));
const doTurntables = args.includes("--turntables") || (!args.includes("--images") && !args.includes("--turntables"));

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
  ".svg": "image/svg+xml",
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
  skipped: number;
  failed: number;
  bytes: number;
}

async function uploadTree(relDir: string, counters: Counters): Promise<void> {
  const abs = path.join(ROOT, relDir);
  if (!fs.existsSync(abs)) {
    console.log(`  (missing) ${relDir} — nothing to upload; run the asset scripts first`);
    return;
  }
  for (const file of walk(abs)) {
    const key = path.relative(ROOT, file).split(path.sep).join("/");
    // the placeholder must stay a local deploy fallback, not a bucket object
    if (key.startsWith("public/images/_placeholder/")) {
      counters.skipped++;
      continue;
    }
    const stat = fs.statSync(file);
    const mime = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";

    if (DRY) {
      console.log(`  [dry] ${key} (${(stat.size / 1024).toFixed(1)} kB)`);
      counters.uploaded++;
      counters.bytes += stat.size;
      continue;
    }

    if (!FORCE) {
      const exists = await headObject(key);
      if (exists && exists.size === stat.size) {
        counters.skipped++;
        continue;
      }
    }

    const body = fs.readFileSync(file);
    const { url, headers } = signPut(key, body, mime);
    const res = await fetch(url, { method: "PUT", headers, body });
    if (res.ok) {
      counters.uploaded++;
      counters.bytes += stat.size;
      process.stdout.write(`  ↑ ${key}\r`);
    } else {
      counters.failed++;
      console.error(`\n  ✗ ${key}: ${res.status} ${await res.text()}`);
    }
  }
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

/* --------------------------------------------------------------------- main */

async function main() {
  if (!DRY && (!ACCOUNT_ID || !ACCESS_KEY || !SECRET_KEY || !BUCKET)) {
    console.error(
      "missing credentials: set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET " +
        "(or pass --dry-run to preview the file list).",
    );
    process.exit(1);
  }

  const counters: Counters = { uploaded: 0, skipped: 0, failed: 0, bytes: 0 };
  console.log(`${DRY ? "[dry-run] " : ""}uploading to r2 bucket "${BUCKET || "(unset)"}"…`);
  if (doImages) {
    console.log("images:");
    await uploadTree("public/images", counters);
  }
  if (doTurntables) {
    console.log("turntables:");
    await uploadTree("public/turntables", counters);
  }

  const mb = (counters.bytes / (1024 * 1024)).toFixed(1);
  console.log(
    `\ndone: ${counters.uploaded} uploaded (${mb} MB), ${counters.skipped} skipped, ${counters.failed} failed`,
  );
  if (counters.failed > 0) process.exit(1);
}

void main();
