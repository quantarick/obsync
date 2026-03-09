// ============================================================
// Obsync — Conflict Resolver
// ============================================================
// Automatically resolves merge conflicts using the user's chosen
// strategy. Called by the SyncEngine when a git pull results in
// conflicted files.
//
// Git conflict markers look like this inside a file:
//   <<<<<<< HEAD
//   my local version of this line
//   =======
//   the remote version of this line
//   >>>>>>> origin/main
//
// Instead of making the user deal with these markers, we resolve
// them automatically based on the chosen strategy.
//
// 📘 TS LEARNING NOTES:
// - Strategy pattern — selecting behavior at runtime via a map of functions
// - RegExp — regular expressions for parsing conflict markers
// - Template literals — building multi-line strings
// - `readonly` tuples and structured data
// ============================================================

import { MergeStrategy } from "../settings";

// 📘 INTERFACE: Represents one conflict block within a file.
// A single file can have multiple conflict regions.
export interface ConflictBlock {
	local: string;   // Content from this device (between <<<<<<< and =======)
	remote: string;  // Content from the other device (between ======= and >>>>>>>)
}

// 📘 INTERFACE: The result of resolving a file's conflicts.
export interface ResolveResult {
	resolvedContent: string;  // The final merged content
	hadConflicts: boolean;    // Whether there were any conflicts to resolve
}

export class ConflictResolver {
	private readonly strategy: MergeStrategy;
	private readonly deviceName: string;

	constructor(strategy: MergeStrategy, deviceName: string) {
		this.strategy = strategy;
		this.deviceName = deviceName;
	}

	// -------------------------------------------------------
	// resolve() — Main entry point: resolve all conflicts in a file
	// -------------------------------------------------------
	resolve(content: string): ResolveResult {
		// Check if the file actually has conflict markers
		if (!this.hasConflictMarkers(content)) {
			return { resolvedContent: content, hadConflicts: false };
		}

		// Parse out the conflict blocks
		const { cleanParts, conflicts } = this.parseConflicts(content);

		// Apply the chosen strategy to each conflict block
		const resolvedBlocks = conflicts.map((block) =>
			this.resolveBlock(block)
		);

		// Reassemble the file: interleave clean parts with resolved blocks
		// 📘 .reduce() — accumulates a value by processing each element.
		// It's like a for loop that builds up a result.
		// Java equivalent: stream().reduce("", (acc, item) -> acc + item)
		let result = "";
		for (let i = 0; i < cleanParts.length; i++) {
			result += cleanParts[i];
			if (i < resolvedBlocks.length) {
				result += resolvedBlocks[i];
			}
		}

		return { resolvedContent: result, hadConflicts: true };
	}

	// -------------------------------------------------------
	// hasConflictMarkers() — Quick check for Git conflict markers
	// -------------------------------------------------------
	hasConflictMarkers(content: string): boolean {
		// 📘 .includes() is a simple substring check.
		// We check for all three markers to be sure it's a real conflict.
		return (
			content.includes("<<<<<<<") &&
			content.includes("=======") &&
			content.includes(">>>>>>>")
		);
	}

	// -------------------------------------------------------
	// parseConflicts() — Split file into clean parts and conflict blocks
	// -------------------------------------------------------
	// 📘 RETURN TYPE: An object with two arrays.
	// `cleanParts` are the non-conflicted regions between conflicts.
	// `conflicts` are the ConflictBlock objects we need to resolve.
	//
	// Example for a file like:
	//   Line 1
	//   <<<<<<< HEAD
	//   local stuff
	//   =======
	//   remote stuff
	//   >>>>>>> origin/main
	//   Line 2
	//
	// Returns:
	//   cleanParts: ["Line 1\n", "\nLine 2"]
	//   conflicts: [{ local: "local stuff\n", remote: "remote stuff\n" }]
	private parseConflicts(content: string): {
		cleanParts: string[];
		conflicts: ConflictBlock[];
	} {
		const cleanParts: string[] = [];
		const conflicts: ConflictBlock[] = [];

		// 📘 REGEX: Regular expression to match Git conflict blocks.
		//
		// <<<<<<< .*\n  — start marker + branch name + newline
		// ([\s\S]*?)    — local content (non-greedy match of anything)
		// =======\n     — separator
		// ([\s\S]*?)    — remote content (non-greedy)
		// >>>>>>> .*    — end marker + branch name
		//
		// The `g` flag means "global" — find ALL matches, not just the first.
		// `[\s\S]` matches any character INCLUDING newlines (`.` doesn't match \n).
		const conflictRegex = /<<<<<<< .*\n([\s\S]*?)=======\n([\s\S]*?)>>>>>>> .*(?:\n)?/g;

		let lastIndex = 0;
		let match: RegExpExecArray | null;

		// 📘 WHILE + REGEX: `regex.exec(content)` finds the next match each time.
		// It returns null when there are no more matches.
		// `match[1]` is the first capture group (local content).
		// `match[2]` is the second capture group (remote content).
		while ((match = conflictRegex.exec(content)) !== null) {
			// Everything between the last match and this one is clean
			cleanParts.push(content.slice(lastIndex, match.index));

			conflicts.push({
				local: match[1],
				remote: match[2],
			});

			lastIndex = match.index + match[0].length;
		}

		// Everything after the last conflict is also clean
		cleanParts.push(content.slice(lastIndex));

		return { cleanParts, conflicts };
	}

	// -------------------------------------------------------
	// resolveBlock() — Apply the merge strategy to one conflict block
	// -------------------------------------------------------
	// 📘 STRATEGY PATTERN: Instead of a big if/else chain, we use
	// a switch statement to select the right strategy.
	// In Java, you might use a Strategy interface with different
	// implementations. In TS, a switch on an enum is idiomatic.
	private resolveBlock(block: ConflictBlock): string {
		switch (this.strategy) {
			case MergeStrategy.APPEND_BOTH:
				return this.appendBoth(block);

			case MergeStrategy.LAST_WRITE_WINS:
				// 📘 For last-write-wins, we keep the remote version
				// because it was pushed more recently (we're pulling it).
				return block.remote;

			case MergeStrategy.DEVICE_PRIORITY:
				// Local device always wins — keep our version
				return block.local;

			case MergeStrategy.LONGEST_WINS:
				return this.longestWins(block);

			default:
				// 📘 EXHAUSTIVENESS CHECK: If we add a new MergeStrategy
				// to the enum but forget to handle it here, TypeScript
				// will warn us at compile time because `this.strategy`
				// can't be assigned to `never`.
				return this.appendBoth(block);
		}
	}

	// -------------------------------------------------------
	// Strategy implementations
	// -------------------------------------------------------

	// 📘 APPEND BOTH: Concatenate both versions with a visible separator.
	// This is the safest strategy — no data is ever lost.
	// The user can clean up the duplicate content at their leisure.
	private appendBoth(block: ConflictBlock): string {
		const timestamp = new Date().toLocaleString();
		// 📘 TEMPLATE LITERAL (backtick string):
		// Multi-line strings with embedded expressions `${...}`.
		// Way more readable than Java's string concatenation.
		return (
			block.local +
			`\n---\n` +
			`> ⚠️ SYNC CONFLICT (${timestamp}) — merged from remote, ` +
			`local device: ${this.deviceName}\n\n` +
			block.remote
		);
	}

	// 📘 LONGEST WINS: Keep whichever version has more content.
	// The assumption is that more content = more work was done.
	private longestWins(block: ConflictBlock): string {
		// 📘 .trim() removes whitespace from both ends before comparing,
		// so we don't let trailing newlines affect the decision.
		const localLen = block.local.trim().length;
		const remoteLen = block.remote.trim().length;

		if (localLen >= remoteLen) {
			return block.local;
		} else {
			return block.remote;
		}
	}
}
