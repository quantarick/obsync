// ============================================================
// Obsync — Main Plugin Entry Point
// ============================================================
// This file is the heart of the plugin. Obsidian calls onload()
// when the plugin starts and onunload() when it stops.
//
// TS LEARNING NOTES are marked with "📘" throughout the code.
// ============================================================

// 📘 IMPORTS: We pull in classes from the 'obsidian' package.
// In TypeScript, `import` is how you bring in code from other files/packages.
// Think of it like Java's `import` statement.
import { Plugin, Notice } from "obsidian";

// 📘 CLASS: We define a class that extends Obsidian's Plugin class.
// This is just like Java: `public class ObsyncPlugin extends Plugin`.
// The `export default` means this is the main thing this file provides.
export default class ObsyncPlugin extends Plugin {

	// 📘 PROPERTY: A class field with a type annotation.
	// `statusBarEl` holds a reference to our status bar item.
	// The type `HTMLElement | null` means it's either an HTML element or null.
	// This is TypeScript's way of saying "this might not exist yet."
	private statusBarEl: HTMLElement | null = null;

	// 📘 ASYNC METHOD: `async` means this method can use `await` inside it.
	// Obsidian calls this when the plugin is enabled/loaded.
	// It's like a constructor, but async (constructors can't be async).
	async onload(): Promise<void> {
		console.log("Obsync: Plugin loaded");

		// Add a status bar item at the bottom of Obsidian
		// 📘 `this` refers to the current instance (same as Java's `this`)
		this.statusBarEl = this.addStatusBarItem();
		this.statusBarEl.setText("Obsync: Ready");

		// Show a toast notification
		// 📘 `new Notice(...)` creates a popup message in Obsidian.
		// It auto-dismisses after a few seconds.
		new Notice("Obsync plugin loaded!");

		// Register a command in the command palette (Ctrl/Cmd + P)
		// 📘 The object `{ id, name, callback }` is a plain object literal.
		// `callback` is an arrow function — a shorthand for writing functions.
		// Arrow syntax:  () => { ... }  is like Java's lambda: () -> { ... }
		this.addCommand({
			id: "obsync-status",
			name: "Show sync status",
			callback: () => {
				new Notice("Obsync is running! (sync not yet implemented)");
			},
		});
	}

	// 📘 Obsidian calls this when the plugin is disabled/unloaded.
	// Clean up anything we set up in onload().
	onunload(): void {
		console.log("Obsync: Plugin unloaded");
		// 📘 No need to manually remove the status bar item —
		// Obsidian cleans up items registered via this.addStatusBarItem()
	}
}
