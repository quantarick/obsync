// ============================================================
// Obsync — Status Bar Component
// ============================================================
// Manages the status bar item at the bottom of Obsidian.
// Shows sync state, last sync time, and is clickable to
// trigger a manual sync.
//
// 📘 TS LEARNING NOTES:
// - DOM manipulation — creating and styling HTML elements
// - Event listeners on DOM elements — click handlers
// - `HTMLElement` type — the base type for all HTML elements
// ============================================================

import { SyncState } from "../sync/SyncEngine";

// 📘 Map each sync state to an icon and a CSS-friendly class name.
// Using `as const` makes TypeScript treat the values as literal types,
// not just generic strings. This enables better autocomplete.
const STATE_CONFIG: Record<SyncState, { icon: string; className: string }> = {
	[SyncState.IDLE]: { icon: "✓", className: "obsync-idle" },
	[SyncState.PUSHING]: { icon: "↑", className: "obsync-pushing" },
	[SyncState.PULLING]: { icon: "↓", className: "obsync-pulling" },
	[SyncState.ERROR]: { icon: "✗", className: "obsync-error" },
	[SyncState.PAUSED]: { icon: "⏸", className: "obsync-paused" },
};

export class StatusBar {
	private readonly el: HTMLElement;
	private readonly onClick: () => void;

	// 📘 CONSTRUCTOR: Takes the raw HTMLElement from Obsidian's addStatusBarItem()
	// and a click handler function.
	constructor(el: HTMLElement, onClick: () => void) {
		this.el = el;
		this.onClick = onClick;

		// 📘 DOM: Set a CSS class and cursor style on the element.
		// `classList.add()` is like jQuery's `.addClass()`.
		// `style.cursor` changes the mouse cursor on hover.
		this.el.classList.add("obsync-status-bar");
		this.el.style.cursor = "pointer";

		// 📘 EVENT LISTENER: When the user clicks the status bar item,
		// call the onClick handler. Arrow function preserves `this`.
		this.el.addEventListener("click", () => {
			this.onClick();
		});

		// Set initial state
		this.update(SyncState.IDLE, "Obsync: Ready");
	}

	// -------------------------------------------------------
	// update() — Change the displayed state and message
	// -------------------------------------------------------
	update(state: SyncState, message: string): void {
		const config = STATE_CONFIG[state];

		// 📘 INNERHTML vs TEXTCONTENT:
		// - `textContent` sets plain text (safe, no HTML parsing)
		// - `innerHTML` would parse HTML (risky — XSS vulnerability)
		// We use textContent because our icon is just a unicode character.
		// 📘 Truncate long messages for the status bar (max 50 chars displayed).
		// The full message goes into the tooltip so the user can still read it.
		const displayMsg = message.length > 50
			? message.slice(0, 47) + "..."
			: message;
		this.el.textContent = `${config.icon} ${displayMsg}`;

		// 📘 Remove all obsync-* classes, then add the current one.
		Object.values(STATE_CONFIG).forEach((c) => {
			this.el.classList.remove(c.className);
		});
		this.el.classList.add(config.className);

		// Full message in tooltip, so user can hover for details
		this.el.title = `${message}\nClick to sync now`;
	}
}
