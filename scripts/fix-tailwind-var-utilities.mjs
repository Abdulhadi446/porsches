/**
 * LEAD FIX — migrate Tailwind v3 custom-property utilities to v4 syntax.
 *
 * `[--token]` was v3 shorthand. Tailwind v4 emits it literally as
 * `padding-inline:--gutter`, which is invalid CSS, so the browser dropped every
 * one of those declarations: 497 sites across the site lost their gutters,
 * radii, tracking, max-widths and durations.
 *
 * v4 wants `(--token)`. We only rewrite a bracket whose entire content is a
 * custom-property name — anything containing calc(), commas, min()/max(),
 * media queries or data attributes is already valid arbitrary syntax and is
 * left alone.
 *
 *   node scripts/fix-tailwind-var-utilities.mjs [--check]
 *
 * --check exits 1 and lists offenders without writing (wire it into CI).
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const CHECK_ONLY = process.argv.includes("--check");
const ROOTS = ["app", "components"];
const EXTS = new Set([".tsx", ".ts"]);

/** `[--foo]` → `(--foo)`; never touches `[calc(…)]`, `[min(…)]`, `[--a,--b]`, `[data-x=y]`. */
const BROKEN = /-\[(--[a-z0-9-]+)\]/gi;

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (EXTS.has(full.slice(full.lastIndexOf(".")))) yield full;
  }
}

let files = 0;
let sites = 0;
const remaining = [];

for (const root of ROOTS) {
  for (const file of walk(join(ROOT, root))) {
    const before = readFileSync(file, "utf8");
    let count = 0;
    const after = before.replace(BROKEN, (_m, prop) => {
      count++;
      return `-(${prop})`;
    });
    if (count) {
      sites += count;
      files++;
      if (!CHECK_ONLY) writeFileSync(file, after);
    }
    if (BROKEN.test(after)) {
      BROKEN.lastIndex = 0;
      remaining.push(relative(ROOT, file));
    } else {
      BROKEN.lastIndex = 0;
    }
  }
}

if (CHECK_ONLY) {
  if (remaining.length) {
    console.error(`FAIL: ${remaining.length} file(s) still use v3 [var] utilities:`);
    for (const f of remaining) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("OK: no [var] utilities remain");
} else {
  console.log(
    `migrated ${sites} custom-property utilities across ${files} files` +
      (remaining.length ? `; STILL PRESENT in ${remaining.length} files` : ""),
  );
  for (const f of remaining) console.log("  !", f);
}