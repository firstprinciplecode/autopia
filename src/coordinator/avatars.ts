import type { MachineAvatar } from "../shared/types.js";

/**
 * The avatar engine: one little voxel creature per machine, in the "1-up" poster palette the map
 * islands use. Colours come as [body, accent, trim] so every figure has the poster's bright block,
 * a contrasting detail and dark little parts.
 */
const PALETTES: [string, string, string][] = [
  ["#ff2f7a", "#ffd23a", "#2e2e38"],
  ["#ffd23a", "#ff2f7a", "#2e2e38"],
  ["#2aa6a6", "#ffd23a", "#2e2e38"],
  ["#2d7fd8", "#6fe0da", "#2e2e38"],
  ["#9bd23c", "#f4f1e6", "#2f6b25"],
  ["#8e4fd8", "#b48ef0", "#2e2e38"],
  ["#ff3b3b", "#ffd23a", "#2e2e38"],
  ["#f4f1e6", "#ff2f7a", "#2e2e38"],
  ["#ff9a1f", "#2aa6a6", "#7a4a2a"],
  ["#b48ef0", "#ffd23a", "#2e2e38"],
  ["#6fe0da", "#ff2f7a", "#2e2e38"],
  ["#ffb3cf", "#ff2f7a", "#2e2e38"],
];

const KINDS: MachineAvatar["kind"][] = ["block", "block", "tall", "wide", "stack", "stack", "screen"];
const TOPS: MachineAvatar["top"][] = ["none", "none", "antenna", "antenna", "ears", "cap", "tuft"];

const INK = "#1b1b22";
const CREAM = "#f4f1e6";

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** A fresh figure. `rnd` is injectable so tests can pin one down. */
export function createAvatar(rnd: () => number = Math.random): MachineAvatar {
  const pick = <T>(list: T[]): T => list[Math.floor(rnd() * list.length)]!;
  const span = (a: number, b: number) => round(a + rnd() * (b - a));
  const [body, accent, trim] = pick(PALETTES);
  const kind = pick(KINDS);
  const base = { v: 1 as const, kind, body, accent, trim, eye: luminance(body) > 0.5 ? INK : CREAM };
  const face = { eyeGap: span(0.12, 0.16), cheeks: rnd() < 0.4 };
  const top = pick(TOPS);
  switch (kind) {
    case "tall":
      return { ...base, ...face, w: span(0.26, 0.3), d: span(0.26, 0.3), h: span(0.56, 0.64), top, band: rnd() < 0.5, feet: true, eyeZ: span(0.66, 0.74), eyeGap: span(0.1, 0.12) };
    case "wide":
      return { ...base, ...face, w: span(0.44, 0.5), d: span(0.3, 0.34), h: span(0.3, 0.36), top, band: rnd() < 0.3, feet: true, eyeZ: span(0.56, 0.64) };
    case "stack":
      return {
        ...base, ...face, w: span(0.36, 0.42), d: span(0.34, 0.4), h: span(0.22, 0.28),
        head: { w: span(0.3, 0.34), d: span(0.28, 0.32), h: span(0.26, 0.3) },
        top, band: false, feet: rnd() < 0.7, eyeZ: span(0.44, 0.56),
      };
    case "screen":
      return {
        ...base, ...face, w: span(0.24, 0.3), d: span(0.24, 0.28), h: span(0.18, 0.24),
        head: { w: span(0.42, 0.48), d: span(0.3, 0.34), h: span(0.3, 0.34) },
        top: rnd() < 0.6 ? "antenna" : "none", band: false, feet: true, cheeks: false, eyeZ: span(0.44, 0.54),
      };
    default:
      return { ...base, ...face, w: span(0.36, 0.42), d: span(0.34, 0.4), h: span(0.4, 0.48), top, band: rnd() < 0.4, feet: rnd() < 0.8, eyeZ: span(0.56, 0.66) };
  }
}

const COLOUR_NAMES: Record<string, string> = {
  "#ff2f7a": "pink",
  "#ffd23a": "yellow",
  "#2aa6a6": "teal",
  "#2d7fd8": "blue",
  "#9bd23c": "green",
  "#8e4fd8": "purple",
  "#ff3b3b": "red",
  "#f4f1e6": "cream",
  "#ff9a1f": "orange",
  "#b48ef0": "lilac",
  "#6fe0da": "aqua",
  "#ffb3cf": "rose",
};

const SHAPES: Record<MachineAvatar["kind"], string> = {
  block: "boxy",
  tall: "tall, narrow",
  wide: "wide, low",
  stack: "two-block",
  screen: "screen-headed",
};

const TOPPERS: Record<MachineAvatar["top"], string> = {
  none: "",
  antenna: "a little antenna",
  ears: "two square ears",
  cap: "a flat cap",
  tuft: "a tuft on top",
};

/** One plain line about how a machine looks, for prompts and settings. */
export function describeAvatar(a: MachineAvatar): string {
  const body = COLOUR_NAMES[a.body.toLowerCase()] ?? "bright";
  const accent = COLOUR_NAMES[a.accent.toLowerCase()];
  const features = [
    accent && accent !== body ? `${accent} trim` : "",
    a.cheeks ? "rosy cheeks" : "",
    TOPPERS[a.top],
  ].filter(Boolean);
  const list = features.length > 1 ? `${features.slice(0, -1).join(", ")} and ${features.at(-1)}` : features[0];
  return `A ${SHAPES[a.kind]} ${body} machine${list ? ` with ${list}` : ""}.`;
}

const HEX = /^#[0-9a-f]{6}$/i;
const inRange = (n: unknown, lo: number, hi: number) => typeof n === "number" && Number.isFinite(n) && n >= lo && n <= hi;

/** True for a stored avatar this version can draw; anything else gets a new one. */
export function isAvatar(value: unknown): value is MachineAvatar {
  const a = value as MachineAvatar | undefined;
  if (!a || a.v !== 1 || !KINDS.includes(a.kind) || !TOPS.includes(a.top)) return false;
  if (![a.body, a.accent, a.trim, a.eye].every((c) => typeof c === "string" && HEX.test(c))) return false;
  if (!inRange(a.w, 0.1, 0.6) || !inRange(a.d, 0.1, 0.6) || !inRange(a.h, 0.1, 0.8)) return false;
  if (a.head && !(inRange(a.head.w, 0.1, 0.6) && inRange(a.head.d, 0.1, 0.6) && inRange(a.head.h, 0.1, 0.6))) return false;
  return inRange(a.eyeGap, 0.05, 0.3) && inRange(a.eyeZ, 0, 1);
}
