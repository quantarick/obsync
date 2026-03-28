// ============================================================
// Obsync — Vault Restructure Plan Types
// ============================================================
// Defines the plan schema returned by Claude and used by the
// executor. Claude returns JSON matching these types.
// ============================================================

export enum PlanOperationType {
	CREATE_FOLDER = "create_folder",
	MOVE = "move",
	RENAME = "rename",
	MERGE = "merge",
	SPLIT = "split",
}

export interface CreateFolderOp {
	type: PlanOperationType.CREATE_FOLDER;
	path: string;
	reason: string;
}

export interface MoveOp {
	type: PlanOperationType.MOVE;
	source: string;
	destination: string;
	reason: string;
}

export interface RenameOp {
	type: PlanOperationType.RENAME;
	source: string;
	destination: string;
	reason: string;
}

export interface MergeOp {
	type: PlanOperationType.MERGE;
	sources: string[];
	destination: string;
	reason: string;
}

export interface SplitOp {
	type: PlanOperationType.SPLIT;
	source: string;
	destinations: string[];
	reason: string;
}

export type PlanOperation = CreateFolderOp | MoveOp | RenameOp | MergeOp | SplitOp;

export interface VaultPlan {
	summary: string;
	operations: PlanOperation[];
}

/**
 * Parse and validate Claude's JSON response into a VaultPlan.
 * Throws if the JSON is invalid or doesn't match the expected schema.
 */
export function parsePlan(jsonString: string): VaultPlan {
	// Claude may wrap JSON in a code fence — strip it
	let cleaned = jsonString.trim();
	if (cleaned.startsWith("```")) {
		cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
	}

	let raw: any;
	try {
		raw = JSON.parse(cleaned);
	} catch {
		throw new Error("Claude returned invalid JSON. Try again.");
	}

	if (!raw || typeof raw !== "object") {
		throw new Error("Plan is not a valid object.");
	}

	const summary = typeof raw.summary === "string" ? raw.summary : "Vault restructuring plan";

	if (!Array.isArray(raw.operations)) {
		throw new Error("Plan has no operations array.");
	}

	const operations: PlanOperation[] = [];

	for (const op of raw.operations) {
		if (!op || typeof op !== "object" || !op.type) continue;

		const reason = typeof op.reason === "string" ? op.reason : "";

		switch (op.type) {
			case "create_folder":
				if (typeof op.path === "string") {
					operations.push({ type: PlanOperationType.CREATE_FOLDER, path: op.path, reason });
				}
				break;
			case "move":
				if (typeof op.source === "string" && typeof op.destination === "string") {
					operations.push({ type: PlanOperationType.MOVE, source: op.source, destination: op.destination, reason });
				}
				break;
			case "rename":
				if (typeof op.source === "string" && typeof op.destination === "string") {
					operations.push({ type: PlanOperationType.RENAME, source: op.source, destination: op.destination, reason });
				}
				break;
			case "merge":
				if (Array.isArray(op.sources) && typeof op.destination === "string") {
					operations.push({ type: PlanOperationType.MERGE, sources: op.sources, destination: op.destination, reason });
				}
				break;
			case "split":
				if (typeof op.source === "string" && Array.isArray(op.destinations)) {
					operations.push({ type: PlanOperationType.SPLIT, source: op.source, destinations: op.destinations, reason });
				}
				break;
		}
	}

	return { summary, operations };
}
