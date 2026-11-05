// Bundles the extension with esbuild. `node build.mjs` or `node build.mjs --watch`.
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");
const common = {
  bundle: true,
  target: "chrome120",
  logLevel: "info",
  legalComments: "eof",
  sourcemap: watch ? "inline" : false, // never ship source maps in a release build
  minify: false, // readable output, easy to audit what is loaded
  define: { "process.env.NODE_ENV": watch ? '"development"' : '"production"' },
  nodePaths: (process.env.NODE_PATH || "").split(":").filter(Boolean),
};

const builds = [
  { ...common, entryPoints: { background: "src/background/index.ts" }, format: "esm", outdir: "dist" },
  { ...common, entryPoints: { content: "src/content/panel.ts" }, format: "iife", outdir: "dist" },
  { ...common, entryPoints: { ui: "src/ui/main.tsx" }, format: "esm", outdir: "dist", jsx: "automatic" },
];

if (watch) {
  for (const b of builds) await (await esbuild.context(b)).watch();
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
}
