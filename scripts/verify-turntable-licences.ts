/**
 * LEAD INTEGRATION — verify the licences behind every turntable source image.
 *
 * Why this exists: ASSET-TURNTABLES recorded `CC BY-SA 4.0 (file page template:
 * {{cc-by-2.0}})` for all 210 sources, but spot checks found the rendered
 * Commons licence sentence says CC BY 2.0 for some of them, and two files have
 * no rendered licence sentence at all. A licence claim we cannot read off the
 * source is not a licence claim — this pass re-parses every file with the same
 * positive-identification logic `scripts/fetch-images.ts` uses, then reports
 * what has to be dropped.
 *
 *   node scripts/verify-turntable-licences.ts [--write]
 *
 * --write rewrites data/turntable-credits.json with the verified licence (or a
 * null licence + reason) and prints the variants that must be excluded.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const WRITE = process.argv.includes("--write");
const UA = "Porsche911FanProject/1.1 (licence verification)";

const ACCEPTED = /^(CC0|CC BY(?:-SA)?)\s?(?:1\.0|2\.0(?:\s+[A-Z]{2})?|2\.5|3\.0|4\.0)?/;

type Credit = Record<string, string | null> & { sourceId: string };

const path = "data/turntable-credits.json";
const raw = JSON.parse(readFileSync(join(ROOT, path), "utf8"));
const credits: Credit[] = Array.isArray(raw) ? raw : raw.credits;

const strip = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

async function renderedLicence(title: string): Promise<string | null> {
  const url = `https://api.wikimedia.org/core/v1/commons/page/${encodeURIComponent(
    title,
  )}/html`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) return null;
  const text = strip(await res.text());
  const m =
    /This (?:file|image|work|photo|photograph|media) is licensed under the (?:Creative Commons )?([^.]*?licen[sc]e)\./i.exec(
      text,
    ) ??
    /This (?:file|image|work|photo|photograph|media) (?:is|has been released(?: into)?|is released to) (?:in )?the public domain[^.]*\./i.exec(
      text,
    );
  if (!m) return null;
  return m[0].replace(/^This (?:file|image|work|photo|photograph|media)\s+/i, "").trim();
}

const problems: string[] = [];
const changed: string[] = [];
let ok = 0;

for (const credit of credits) {
  const title = credit.sourceId ?? "";
  const sentence = await renderedLicence(title);
  if (!sentence) {
    credit.license = null;
    credit.licenseNote = "no licence sentence found on the Commons file page — unverified, exclude";
    problems.push(title);
    continue;
  }
  if (!ACCEPTED.test(sentence) || /\bNC\b|\bND\b|NonCommercial|NoDeriv/i.test(sentence)) {
    credit.license = sentence;
    credit.licenseNote = "licence not in the accepted set — exclude";
    problems.push(title);
    continue;
  }
  const before = credit.license ?? "";
  credit.license = sentence;
  delete credit.licenseNote;
  if (!before.startsWith(sentence)) changed.push(`${title}: "${before}" -> "${sentence}"`);
  ok++;
  process.stdout.write(".");
}

console.log(`\n\nverified ${ok}/${credits.length}`);
console.log(`licence string corrected on ${changed.length} entries`);
if (changed.length) {
  console.log("\ncorrections (first 25):");
  for (const c of changed.slice(0, 25)) console.log("  -", c);
}
if (problems.length) {
  console.log(`\nEXCLUDE these ${problems.length} sources:`);
  for (const p of problems) console.log("  -", p);
}

if (WRITE) {
  const out = {
    verifiedAt: new Date().toISOString(),
    note: "Licences re-parsed from the rendered Commons licence sentence by scripts/verify-turntable-licences.ts. Entries with license:null are unverified or non-free and must not ship.",
    credits,
  };
  writeFileSync(join(ROOT, path), JSON.stringify(out, null, 2) + "\n");
  console.log(`\nwrote ${path}`);
} else {
  console.log("\n(dry run — pass --write to apply)");
}