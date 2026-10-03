/**
 * LEAD INTEGRATION — correct the recorded licence on data/turntable-credits.json.
 *
 * Why: ASSET-TURNTABLES wrote every source as
 *   "CC BY-SA 4.0 (file page template: {{cc-by-2.0}})"
 * i.e. it took the last Creative Commons licence URL found anywhere on the
 * rendered file page (which is usually a footer link) instead of the licence
 * the uploader actually selected. The inline template is the authoritative
 * signal, so we derive the licence from it — offline, deterministically.
 *
 * Direction of the original error is conservative (CC BY-SA 4.0 claimed for a
 * CC BY 2.0 file claims FEWER rights than the source grants), so nothing here
 * was a licence violation — but the credits page must state the truth.
 *
 *   node scripts/fix-turntable-licences.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const PATH_ = "data/turntable-credits.json";

/** template tag -> human label, and whether we may ship under it. */
const TEMPLATES: Record<string, { label: string; ok: boolean }> = {
  "cc-zero": { label: "CC0 1.0 (public domain dedication)", ok: true },
  "cc-by-4.0": { label: "CC BY 4.0", ok: true },
  "cc-by-3.0": { label: "CC BY 3.0", ok: true },
  "cc-by-2.0": { label: "CC BY 2.0", ok: true },
  "cc-by": { label: "CC BY 2.0", ok: true },
  "cc-by-sa-4.0": { label: "CC BY-SA 4.0", ok: true },
  "cc-by-sa-3.0": { label: "CC BY-SA 3.0", ok: true },
  "cc-by-sa-2.0": { label: "CC BY-SA 2.0", ok: true },
  "cc-by-sa-2.0-de": { label: "CC BY-SA 2.0 DE", ok: true },
  "cc-by-nc-4.0": { label: "CC BY-NC 4.0", ok: false },
  "cc-by-nc-3.0": { label: "CC BY-NC 3.0", ok: false },
  "cc-by-nc-sa-4.0": { label: "CC BY-NC-SA 4.0", ok: false },
  "cc-by-nd-4.0": { label: "CC BY-ND 4.0", ok: false },
  "cc-by-nc-nd-4.0": { label: "CC BY-NC-ND 4.0", ok: false },
  pd: { label: "Public domain", ok: true },
};

const raw = JSON.parse(readFileSync(join(ROOT, PATH_), "utf8"));
const credits: Record<string, unknown>[] = Array.isArray(raw) ? raw : raw.credits;

let fixed = 0;
let confirmed = 0;
let unusable = 0;
const unusableIds: string[] = [];

for (const credit of credits) {
  const recorded = String(credit.license ?? "");
  const m = /\{\{(?:self\|)?([a-z0-9.-]+)\}\}/i.exec(recorded);
  if (!m) {
    // Already normalised by an earlier run of this script: accept a plain
    // accepted label, otherwise flag it.
    if (/^(CC0|Public domain|CC BY(?: 1\.0| 2\.0| 3\.0| 4\.0)?|CC BY-SA (?:1\.0|2\.0|3\.0|4\.0))( DE)?$/i.test(recorded.trim())) {
      credit.licenseSource = "commons file page licence template (normalised by an earlier pass)";
      delete credit.licenseNote;
      confirmed++;
      continue;
    }
    credit.licenseNote = "no licence template recorded — re-verify against the file page";
    unusable++;
    unusableIds.push(String(credit.sourceId));
    continue;
  }
  const tag = m[1].trim().toLowerCase().replace(/^self\|?/, "");
  const entry = TEMPLATES[tag];
  if (!entry) {
    credit.licenseNote = `unrecognised licence template {{${tag}}}`;
    unusable++;
    unusableIds.push(String(credit.sourceId));
    continue;
  }
  if (!entry.ok) {
    credit.license = entry.label;
    credit.licenseNote = "NON-FREE licence — must not ship";
    unusable++;
    unusableIds.push(String(credit.sourceId));
    continue;
  }
  credit.license = entry.label;
  credit.licenseSource = "commons file page licence template";
  delete credit.licenseNote;
  if (recorded.startsWith(entry.label)) confirmed++;
  else fixed++;
}

const out = {
  verifiedAt: new Date().toISOString(),
  note: "Licence derived from each file's own Commons licence template (the authoritative signal) by scripts/fix-turntable-licenses.ts, replacing the earlier last-CC-URL-on-the-page heuristic, which over-stated CC BY-SA 4.0 for files licensed CC BY 2.0 or CC0. Re-run scripts/verify-turntable-licences.ts to re-confirm against the rendered licence sentence.",
  corrected: fixed,
  alreadyCorrect: confirmed,
  unusable: unusable,
  credits,
};
writeFileSync(join(ROOT, PATH_), JSON.stringify(out, null, 2) + "\n");

console.log(`licence corrected on ${fixed} entries, ${confirmed} were already right, ${unusable} need exclusion`);
if (unusableIds.length) {
  console.log("\nexclude these sources:");
  for (const id of unusableIds) console.log("  -", id);
}