import { copyFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const vaultPluginPath = join(
  "D:", "work", "record", "Obsidian", "OneNote", "Yuan's Note",
  ".obsidian", "plugins", "obsync"
);

if (!existsSync(vaultPluginPath)) {
  console.log("Vault plugin path not found, skipping install.");
  process.exit(0);
}

const files = ["main.js", "manifest.json", "styles.css"];
for (const file of files) {
  if (existsSync(file)) {
    copyFileSync(file, join(vaultPluginPath, file));
  }
}
console.log(`Installed plugin to ${vaultPluginPath}`);
