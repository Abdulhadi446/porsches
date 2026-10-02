/**
 * Paint chips for the 3D colour swapper.
 *
 * Every chip is a token from `styles/tokens.css` — no ad-hoc hex values.
 * `hex` is only used where a value has to survive into a non-CSS context
 * (a three.js material colour, which is resolved on the client from the
 * token via `fxVar`-style CSS variables, so the mirror here is just the
 * deterministic SSR fallback).
 */

export type PaintToken = "guards" | "gulf-blue" | "gulf-orange" | "metal-500";

export interface Paint {
  id: string;
  label: string;
  /** CSS colour — always `var(--color-…)` so tokens stay the single source */
  css: string;
  /** deterministic mirror for three.js / SSR */
  hex: string;
  /** base metalness/roughness a paint material is nudged toward */
  finish: { metalness: number; roughness: number };
}

export const PAINTS: readonly Paint[] = [
  {
    id: "guards",
    label: "Guards Red",
    css: "var(--color-guards)",
    hex: "#d5001c",
    finish: { metalness: 0.35, roughness: 0.32 },
  },
  {
    id: "gulf-blue",
    label: "Gulf blue",
    css: "var(--color-gulf-blue)",
    hex: "#3fa9d6",
    finish: { metalness: 0.35, roughness: 0.32 },
  },
  {
    id: "gulf-orange",
    label: "Gulf orange",
    css: "var(--color-gulf-orange)",
    hex: "#f47b20",
    finish: { metalness: 0.32, roughness: 0.38 },
  },
  {
    id: "metal",
    label: "Brushed metal",
    css: "var(--color-metal-500)",
    hex: "#8b8b95",
    finish: { metalness: 0.92, roughness: 0.42 },
  },
];

export const DEFAULT_PAINT = PAINTS[0];

/** WHEEL_CHIPS are named node groups discovered in the model, never invented. */
export interface WheelOption {
  /** node-name group id, e.g. "sport" from `wheel_sport_fl` */
  id: string;
  label: string;
  /** full node names that make up the group */
  nodes: string[];
}

const NODE_PREFIX_RE = /^(?:wheel|rim|alloy)[-_]([a-z0-9]+)/i;
const NODE_ANY_RE = /(wheel|rim|alloy|rad)/i;

function labelFromId(id: string): string {
  const spaced = id.replace(/[-_]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Group wheel nodes by the token after `wheel_` / `wheel-` / `rim_`.
 * Returns `null` when the model exposes fewer than two groups, which is the
 * signal to render the swapper *disabled* rather than fake a swap.
 */
export function wheelGroups(nodeNames: readonly string[]): WheelOption[] | null {
  const groups = new Map<string, string[]>();
  let anyWheelNode = false;

  for (const name of nodeNames) {
    if (!NODE_ANY_RE.test(name)) continue;
    anyWheelNode = true;
    const match = NODE_PREFIX_RE.exec(name);
    const id = match ? match[1].toLowerCase() : "default";
    const bucket = groups.get(id);
    if (bucket) bucket.push(name);
    else groups.set(id, [name]);
  }

  if (!anyWheelNode || groups.size < 2) return null;
  return [...groups.entries()].map(([id, nodes]) => ({
    id,
    label: labelFromId(id),
    nodes,
  }));
}

/** Names matching any wheel-ish pattern — used to report "wheels found". */
export function wheelNodeCount(nodeNames: readonly string[]): number {
  return nodeNames.filter((name) => NODE_ANY_RE.test(name)).length;
}