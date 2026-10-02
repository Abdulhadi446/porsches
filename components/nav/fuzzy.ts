/**
 * NAV-UX FUZZY MATCHING — owned by NAV-UX.
 *
 * Deliberately dependency-free and *data-free*: it lives in its own module so
 * the command palette can import the highlighter without dragging the ~460 kB
 * generation JSON into the initial route bundle (the catalogue itself is
 * `import()`ed lazily on first open).
 *
 * `fieldScore` returns `1` for an exact hit at position 0 and decays towards
 * `0` for misses, handling both a literal substring and a loose in-order
 * subsequence so "gt3rs" still finds "GT3 RS".
 */

export function normaliseQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

export function fieldScore(haystack: string, query: string): number {
  if (!haystack || !query) return 0;
  const direct = haystack.indexOf(query);
  if (direct === 0) return 1;
  if (direct > 0) {
    const boundary = /[\s\-/,.·|]/.test(haystack[direct - 1]);
    return (boundary ? 0.9 : 0.58) * (1 - Math.min(direct, 60) / 500);
  }
  let previous = -1;
  let first = -1;
  let gaps = 0;
  for (const char of query) {
    const found = haystack.indexOf(char, previous + 1);
    if (found === -1) return 0;
    if (first === -1) first = found;
    if (previous >= 0 && found - previous > 1) gaps += 1;
    previous = found;
  }
  const span = previous - first + 1;
  const compact = query.length / span;
  return 0.6 * compact * (1 - Math.min(gaps, 8) / 24);
}

/**
 * Character offsets of `query` inside `text`, for `<mark>` highlighting.
 * Falls back to a loose subsequence walk and returns `[]` when the text does
 * not contain the query at all.
 */
export function matchPositions(text: string, query: string): number[] {
  const q = normaliseQuery(query);
  if (!q) return [];
  const haystack = text.toLowerCase();
  const direct = haystack.indexOf(q);
  if (direct >= 0) {
    return Array.from({ length: q.length }, (_, i) => direct + i);
  }
  const out: number[] = [];
  let previous = -1;
  for (const char of q) {
    if (char === " ") continue;
    const found = haystack.indexOf(char, previous + 1);
    if (found === -1) return [];
    out.push(found);
    previous = found;
  }
  return out;
}
