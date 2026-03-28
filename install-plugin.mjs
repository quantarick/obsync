import { copyFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = join(__dirname, ".deploy-config.json");

if (!existsSync(configPath)) {
  console.log(
    "No .deploy-config.json found. Create one with your vault path:\n\n" +
    '  echo \'{ "vaultPath": "/path/to/your/vault" }\' > .deploy-config.json\n\n' +
    "This file is gitignored and stays local to your machine."
  );
  process.exit(1);
}

let config;
try {
  config = JSON.parse(readFileSync(configPath, "utf-8"));
} catch {
  console.error("Failed to parse .deploy-config.json");
  process.exit(1);
}

if (!config.vaultPath) {
  console.error('.deploy-config.json must have a "vaultPath" field.');
  process.exit(1);
}

const vaultPluginPath = join(config.vaultPath, ".obsidian", "plugins", "obsync");

if (!existsSync(vaultPluginPath)) {
  mkdirSync(vaultPluginPath, { recursive: true });
  console.log(`Created plugin directory: ${vaultPluginPath}`);
}

const files = ["main.js", "manifest.json", "styles.css"];
for (const file of files) {
  if (existsSync(file)) {
    copyFileSync(file, join(vaultPluginPath, file));
  }
}
console.log(`Installed plugin to ${vaultPluginPath}`);
