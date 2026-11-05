// Accent colour helpers shared by the UI, the in-page button and the toolbar icon.

export const DEFAULT_ACCENT = "#0f7b6c";
export const RUNNING_COLOR = "#e8710a"; // reserved for "timer running" everywhere

export const ACCENT_PRESETS: { name: string; color: string }[] = [
  { name: "Teal", color: "#0f7b6c" },
  { name: "Blue", color: "#1a73e8" },
  { name: "Indigo", color: "#4f46e5" },
  { name: "Purple", color: "#8e44ad" },
  { name: "Pink", color: "#c2185b" },
  { name: "Red", color: "#d93025" },
  { name: "Green", color: "#2e7d32" },
  { name: "Graphite", color: "#4a5568" },
];

export function isHexColor(s: unknown): s is string {
  return typeof s === "string" && /^#[0-9a-f]{6}$/i.test(s);
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hex([r, g, b]: number[]): string {
  return "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
}

/** Mixes `a` towards `b` by `t` (0..1). */
export function mix(a: string, b: string, t: number): string {
  const x = rgb(a), y = rgb(b);
  return hex(x.map((v, i) => v + (y[i] - v) * t));
}

function luminance(c: string): number {
  const ch = rgb(c).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Text colour that reads best on top of `bg`. */
export function onColor(bg: string): string {
  return contrast(bg, "#ffffff") >= contrast(bg, "#111111") ? "#ffffff" : "#111111";
}

/**
 * Derives readable light- and dark-theme variants from any picked colour:
 * darkened until it reads on white, lightened until it reads on the dark
 * background (so even a pale yellow or a near-black stays usable).
 */
export function accentPalette(input: string) {
  const base = isHexColor(input) ? input.toLowerCase() : DEFAULT_ACCENT;
  let light = base;
  for (let i = 0; i < 12 && contrast(light, "#ffffff") < 3.2; i++) light = mix(light, "#000000", 0.12);
  let dark = mix(base, "#ffffff", 0.25);
  for (let i = 0; i < 12 && contrast(dark, "#1e1f22") < 4; i++) dark = mix(dark, "#ffffff", 0.15);
  return {
    light,
    lightFg: onColor(light),
    lightSoft: mix(light, "#ffffff", 0.88),
    dark,
    darkFg: onColor(dark),
    darkSoft: mix(dark, "#1e1f22", 0.8),
  };
}
