// ============================================================
// Obsync — Settings
// ============================================================
// This file defines what settings exist, their defaults,
// and the settings UI panel inside Obsidian.
//
// 📘 TS LEARNING NOTES:
// - `interface` = a shape/contract for an object (like Java's interface)
// - `enum` = a fixed set of named values (like Java's enum)
// - `Partial<T>` = makes all fields of T optional
// ============================================================

import { App, PluginSettingTab, Setting } from "obsidian";

// We need a reference to our plugin class, but importing it directly
// would create a circular dependency. Instead, we import just the type.
import type ObsyncPlugin from "./main";

// 📘 ENUM: A fixed set of named values.
// In Java: `public enum MergeStrategy { APPEND_BOTH, LAST_WRITE_WINS, ... }`
// In TS: almost the same syntax!
export enum MergeStrategy {
	APPEND_BOTH = "append_both",
	LAST_WRITE_WINS = "last_write_wins",
	DEVICE_PRIORITY = "device_priority",
	LONGEST_WINS = "longest_wins",
}

// 📘 INTERFACE: Defines the "shape" of our settings object.
// It says: "any object that claims to be ObsyncSettings MUST have these fields."
// Unlike Java interfaces, TS interfaces can define data fields (not just methods).
export interface ObsyncSettings {
	// Git remote URL (e.g., https://github.com/user/vault.git)
	remoteUrl: string;

	// GitHub personal access token for authentication
	githubToken: string;

	// Name to identify this device in sync commits
	deviceName: string;

	// Git author email for commits
	authorEmail: string;

	// How to handle merge conflicts
	mergeStrategy: MergeStrategy;

	// How often to check for remote changes (seconds)
	pullIntervalSeconds: number;

	// How long to wait after a file change before committing (seconds)
	debounceSeconds: number;

	// Whether to pull latest changes when Obsidian opens
	autoSyncOnStartup: boolean;

	// File patterns to exclude from sync
	ignoredPatterns: string[];
}

// 📘 DEFAULT VALUES: A constant object that satisfies the ObsyncSettings interface.
// `as const` is not used here because we need it to be mutable when loading.
// Notice how TypeScript checks that every field from the interface is present!
export const DEFAULT_SETTINGS: ObsyncSettings = {
	remoteUrl: "",
	githubToken: "",
	deviceName: getDefaultDeviceName(),
	authorEmail: "",
	mergeStrategy: MergeStrategy.APPEND_BOTH,
	pullIntervalSeconds: 30,
	debounceSeconds: 3,
	autoSyncOnStartup: true,
	ignoredPatterns: [
		".obsidian/workspace.json",
		".obsidian/workspace-mobile.json",
		".DS_Store",
		"Thumbs.db",
	],
};

// 📘 FUNCTION: A standalone function (not inside a class).
// Returns a string. The `: string` is the return type annotation.
function getDefaultDeviceName(): string {
	// In Node.js (which Obsidian runs on), we can detect the OS
	const platform = navigator.platform.toLowerCase();
	if (platform.includes("mac")) return "mac";
	if (platform.includes("win")) return "windows";
	if (platform.includes("linux")) return "linux";
	return "unknown";
}

// 📘 CLASS extending PluginSettingTab:
// This creates the settings panel you see in Obsidian's Settings UI.
// `display()` is called by Obsidian when the user opens the settings tab.
export class ObsyncSettingTab extends PluginSettingTab {
	// 📘 PROPERTY with type annotation
	plugin: ObsyncPlugin;

	// 📘 CONSTRUCTOR: Takes the Obsidian App and our plugin instance.
	// `super(app, plugin)` calls the parent class constructor (same as Java).
	constructor(app: App, plugin: ObsyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	// 📘 display(): Obsidian calls this to render the settings panel.
	// We build the UI using Obsidian's `Setting` class — it's a builder pattern.
	display(): void {
		// `containerEl` is the HTML element Obsidian gives us to render into
		const { containerEl } = this;

		// Clear any existing content (in case settings are re-opened)
		containerEl.empty();

		// --- Header ---
		containerEl.createEl("h2", { text: "Obsync Settings" });

		// --- Remote URL ---
		// 📘 BUILDER PATTERN: `new Setting(...)` creates a settings row.
		// `.setName()`, `.setDesc()`, `.addText()` are chained method calls.
		// Each returns `this` so you can chain them — same pattern as Java's StringBuilder.
		new Setting(containerEl)
			.setName("Remote URL")
			.setDesc("GitHub repository URL (e.g., https://github.com/user/vault.git)")
			.addText((text) =>
				text
					.setPlaceholder("https://github.com/...")
					.setValue(this.plugin.settings.remoteUrl)
					.onChange(async (value) => {
						// 📘 ASYNC ARROW FUNCTION: `async (value) => { ... }`
						// Called whenever the user types in this field.
						// `value` is automatically typed as `string` by TypeScript.
						this.plugin.settings.remoteUrl = value;
						await this.plugin.saveSettings();
					})
			);

		// --- GitHub Token ---
		new Setting(containerEl)
			.setName("GitHub token")
			.setDesc("Personal access token for authentication (stored locally)")
			.addText((text) =>
				text
					.setPlaceholder("ghp_xxxxxxxxxxxx")
					.setValue(this.plugin.settings.githubToken)
					.onChange(async (value) => {
						this.plugin.settings.githubToken = value;
						await this.plugin.saveSettings();
					})
			);

		// --- Device Name ---
		new Setting(containerEl)
			.setName("Device name")
			.setDesc("Identifies this machine in sync commits")
			.addText((text) =>
				text
					.setPlaceholder("e.g., macbook, windows-pc")
					.setValue(this.plugin.settings.deviceName)
					.onChange(async (value) => {
						this.plugin.settings.deviceName = value;
						await this.plugin.saveSettings();
					})
			);

		// --- Author Email ---
		new Setting(containerEl)
			.setName("Author email")
			.setDesc("Email used in git commits (e.g., your GitHub email)")
			.addText((text) =>
				text
					.setPlaceholder("you@example.com")
					.setValue(this.plugin.settings.authorEmail)
					.onChange(async (value) => {
						this.plugin.settings.authorEmail = value;
						await this.plugin.saveSettings();
					})
			);

		// --- Merge Strategy ---
		// 📘 DROPDOWN: `addDropdown()` creates a <select> element.
		// We use `Object.values(MergeStrategy)` to loop over all enum values.
		new Setting(containerEl)
			.setName("Merge strategy")
			.setDesc("How to resolve conflicts when the same note is edited on both devices")
			.addDropdown((dropdown) => {
				// 📘 Record<string, string> is a TypeScript type for an object
				// where both keys and values are strings. Like Java's Map<String, String>.
				const options: Record<string, string> = {
					[MergeStrategy.APPEND_BOTH]: "Append both versions (safest)",
					[MergeStrategy.LAST_WRITE_WINS]: "Last write wins",
					[MergeStrategy.DEVICE_PRIORITY]: "Device priority",
					[MergeStrategy.LONGEST_WINS]: "Longest content wins",
				};
				dropdown
					.addOptions(options)
					.setValue(this.plugin.settings.mergeStrategy)
					.onChange(async (value) => {
						// 📘 TYPE ASSERTION: `as MergeStrategy` tells TypeScript
						// "trust me, this string is a valid MergeStrategy value."
						this.plugin.settings.mergeStrategy = value as MergeStrategy;
						await this.plugin.saveSettings();
					});
			});

		// --- Pull Interval ---
		new Setting(containerEl)
			.setName("Pull interval (seconds)")
			.setDesc("How often to check for remote changes")
			.addText((text) =>
				text
					.setPlaceholder("30")
					.setValue(String(this.plugin.settings.pullIntervalSeconds))
					.onChange(async (value) => {
						// 📘 parseInt() converts string → number.
						// Math.max() enforces a minimum of 5 seconds to prevent
						// hammering the remote with too-frequent checks.
						const parsed = parseInt(value);
						this.plugin.settings.pullIntervalSeconds = Math.max(5, parsed || 30);
						await this.plugin.saveSettings();
					})
			);

		// --- Debounce Delay ---
		new Setting(containerEl)
			.setName("Debounce delay (seconds)")
			.setDesc("Wait time after a file change before committing (min 1s)")
			.addText((text) =>
				text
					.setPlaceholder("3")
					.setValue(String(this.plugin.settings.debounceSeconds))
					.onChange(async (value) => {
						const parsed = parseInt(value);
						this.plugin.settings.debounceSeconds = Math.max(1, parsed || 3);
						await this.plugin.saveSettings();
					})
			);

		// --- Auto-sync on Startup ---
		// 📘 TOGGLE: `addToggle()` creates an on/off switch.
		new Setting(containerEl)
			.setName("Auto-sync on startup")
			.setDesc("Pull latest changes when Obsidian opens")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoSyncOnStartup)
					.onChange(async (value) => {
						// `value` here is a boolean (true/false), not a string
						this.plugin.settings.autoSyncOnStartup = value;
						await this.plugin.saveSettings();
					})
			);

		// --- Ignored Patterns ---
		// 📘 ARRAY ↔ STRING: We store patterns as string[], but display as
		// a comma-separated string for easier editing. `.join()` and `.split()`
		// convert between the two.
		new Setting(containerEl)
			.setName("Ignored patterns")
			.setDesc("File patterns to exclude from sync (comma-separated)")
			.addTextArea((text) =>
				text
					.setPlaceholder("workspace.json, .DS_Store")
					.setValue(this.plugin.settings.ignoredPatterns.join(", "))
					.onChange(async (value) => {
						// 📘 CHAINING ARRAY METHODS:
						// .split(",")  → ["workspace.json", " .DS_Store"]
						// .map(s => s.trim())  → ["workspace.json", ".DS_Store"]
						// .filter(s => s.length > 0)  → removes empty strings
						this.plugin.settings.ignoredPatterns = value
							.split(",")
							.map((s) => s.trim())
							.filter((s) => s.length > 0);
						await this.plugin.saveSettings();
					})
			);
	}
}
