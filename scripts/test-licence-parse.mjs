/**
 * Regression test for the licence-template fix in scripts/fetch-images.ts.
 * The old code took the first creativecommons.org URL on the page, which is
 * usually a footer link — it recorded CC BY-SA 4.0 for CC BY 2.0 files.
 * Run: node scripts/test-licence-parse.mjs
 */

function licenceFromTemplate(text) {
  const inner = /\b(?:self\|)?(cc-zero|cc-by(?:-sa)?(?:-[a-z]{2})?-[0-9.]+|cc-by(?:-sa)?)\b/i.exec(
    (/\{\{\s*(?:self\|)?([a-z0-9|._-]+)\s*\}\}/i.exec(text)?.[1] ?? ""),
  );
  if (!inner || /nc|nd/.test(inner[1])) return null;
  const tag = inner[1].toLowerCase();
  if (tag === "cc-zero") return "CC0 1.0";
  const version = (/-([0-9.]+)$/.exec(tag)?.[1] ?? "4.0").replace(/\.0$/, "");
  return /-sa/.test(tag) ? `CC BY-SA ${version}.0` : `CC BY ${version}.0`;
}

const cases = [
  ["{{self|cc-by-2.0}}", "CC BY 2.0"],
  ["{{cc-by-sa-4.0}}", "CC BY-SA 4.0"],
  ["{{self|cc-by-sa-4.0}}", "CC BY-SA 4.0"],
  ["{{self|cc-zero}}", "CC0 1.0"],
  ["{{cc-zero}}", "CC0 1.0"],
  ["{{cc-by-sa-2.0-de}}", "CC BY-SA 2.0"],
  ["{{cc-by-3.0}}", "CC BY 3.0"],
  ["{{cc-by-4.0}}", "CC BY 4.0"],
  ["{{cc-by-nc-4.0}}", null],
  ["{{cc-by-nd-4.0}}", null],
  ["no template at all", null],
];

let failed = 0;
for (const [text, want] of cases) {
  const got = licenceFromTemplate(text);
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${text.padEnd(24)} -> ${got} (want ${want})`);
}
console.log(failed === 0 ? "\nall licence-template cases pass" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);