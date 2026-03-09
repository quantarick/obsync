// ============================================================
// Obsync — Debouncer
// ============================================================
// Collects file change events and waits for a "quiet period"
// before firing. This prevents commit storms when you're
// actively editing (Obsidian auto-saves every few seconds).
//
// How it works:
//   1. File changes come in:  edit A → edit B → edit A → edit C
//   2. Each change resets a timer
//   3. When no changes happen for N seconds, the debouncer fires
//   4. It passes the full set of changed files to the callback
//
// 📘 TS LEARNING NOTES:
// - `Set<T>` — a collection of unique values (like Java's HashSet)
// - `setTimeout` / `clearTimeout` — JS timers (like Java's Timer)
// - Callback functions — passing functions as arguments
// - `ReturnType<typeof setTimeout>` — advanced type inference
// ============================================================

// 📘 TYPE ALIAS: Creates a shorthand name for a function type.
// This says: "OnFlush is a function that takes a Set of strings and returns void."
// In Java, this would be like defining a functional interface:
//   @FunctionalInterface interface OnFlush { void apply(Set<String> paths); }
type OnFlush = (changedPaths: Set<string>) => void;

export class Debouncer {
	// 📘 Set<string> — stores unique file paths. If the same file is edited
	// 3 times before the timer fires, it only appears once in the Set.
	private changedPaths: Set<string> = new Set();

	// 📘 Timer handle. `ReturnType<typeof setTimeout>` is a TypeScript trick
	// to get the correct type for the timer ID (it differs between Node.js and browsers).
	// In Java, you'd just use `Timer timer;`
	private timer: ReturnType<typeof setTimeout> | null = null;

	// 📘 `readonly` fields set in constructor — can't be changed after creation.
	private readonly delayMs: number;
	private readonly onFlush: OnFlush;

	// 📘 CONSTRUCTOR: Takes the delay in milliseconds and a callback function.
	// The callback is what we call when the debounce period expires.
	constructor(delayMs: number, onFlush: OnFlush) {
		this.delayMs = delayMs;
		this.onFlush = onFlush;
	}

	// -------------------------------------------------------
	// notify() — Called when a file changes
	// -------------------------------------------------------
	// This is the main entry point. The FileWatcher calls this
	// every time a file is created, modified, or deleted.
	notify(filepath: string): void {
		// Add to the set of changed paths
		// 📘 Set.add() is idempotent — adding the same path twice is harmless.
		this.changedPaths.add(filepath);

		// Reset the timer
		// 📘 This is the "debounce" logic:
		//   - If a timer is running, cancel it
		//   - Start a new timer
		//   - The timer only fires if no new changes come in for `delayMs`
		if (this.timer !== null) {
			clearTimeout(this.timer);
		}

		// 📘 ARROW FUNCTION in setTimeout:
		// `() => { this.flush() }` creates a function that will run after delayMs.
		// Arrow functions preserve `this` — a regular `function()` would lose it.
		// This is one of the most important differences from Java lambdas!
		this.timer = setTimeout(() => {
			this.flush();
		}, this.delayMs);
	}

	// -------------------------------------------------------
	// flush() — Timer expired, fire the callback
	// -------------------------------------------------------
	private flush(): void {
		// Nothing to flush
		if (this.changedPaths.size === 0) return;

		// 📘 Create a copy of the set before clearing it.
		// `new Set(this.changedPaths)` copies all values into a new Set.
		// We do this so the callback gets a stable snapshot, even if
		// new changes arrive while the callback is running.
		const paths = new Set(this.changedPaths);

		// Clear state for the next batch
		this.changedPaths.clear();
		this.timer = null;

		// Fire the callback with the collected paths.
		// 📘 Wrapped in try-catch so a failing callback doesn't corrupt our state.
		try {
			this.onFlush(paths);
		} catch (err: unknown) {
			console.error("Obsync: Debounce callback failed —", err);
		}
	}

	// -------------------------------------------------------
	// cancel() — Stop the timer (used during plugin unload)
	// -------------------------------------------------------
	cancel(): void {
		if (this.timer !== null) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		this.changedPaths.clear();
	}

	// -------------------------------------------------------
	// hasPending() — Check if there are queued changes
	// -------------------------------------------------------
	hasPending(): boolean {
		return this.changedPaths.size > 0;
	}
}
