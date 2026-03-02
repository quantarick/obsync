import esbuild from "esbuild";
import process from "process";

// Check if we're building for production (minified) or dev (readable)
const production = process.argv[2] === "production";

esbuild
  .build({
    // Entry point — our main plugin file
    entryPoints: ["src/main.ts"],

    // Bundle all imports into a single file
    bundle: true,

    // Mark 'obsidian' as external — Obsidian provides it at runtime
    external: ["obsidian"],

    // Output file — Obsidian expects 'main.js' in the plugin folder
    outfile: "main.js",

    // CommonJS format — required by Obsidian's plugin loader
    format: "cjs",

    // Target Node.js (Obsidian runs on Electron/Node)
    platform: "node",

    // Source maps for debugging (inline in dev, off in prod)
    sourcemap: production ? false : "inline",

    // Minify in production for smaller file size
    minify: production,

    // Log build result
    logLevel: "info",
  })
  .catch(() => process.exit(1));
