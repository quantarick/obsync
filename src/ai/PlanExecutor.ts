// ============================================================
// Obsync — Plan Executor
// ============================================================
// Applies a user-approved vault restructuring plan.
// Executes operations in safe order: folders → merges → splits → moves → renames
// Uses Obsidian APIs that auto-update wikilinks.
// ============================================================

import { App, TFile, TFolder, Notice } from "obsidian";
import {
	PlanOperation,
	PlanOperationType,
	MergeOp,
	SplitOp,
} from "./VaultRestructurePlan";
import { VaultRestructureService } from "./VaultRestructureService";

export interface ExecutionReport {
	succeeded: number;
	failed: number;
	errors: string[];
}

/**
 * Execute an approved plan. Operations are sorted into safe execution order.
 * Merge/split operations trigger additional Claude API calls for content generation.
 */
export async function executePlan(
	app: App,
	operations: PlanOperation[],
	restructureService: VaultRestructureService,
	onProgress: (message: string) => void,
): Promise<ExecutionReport> {
	const report: ExecutionReport = { succeeded: 0, failed: 0, errors: [] };

	// Sort operations into safe execution order
	const folders = operations.filter((op) => op.type === PlanOperationType.CREATE_FOLDER);
	const merges = operations.filter((op) => op.type === PlanOperationType.MERGE) as MergeOp[];
	const splits = operations.filter((op) => op.type === PlanOperationType.SPLIT) as SplitOp[];
	const moves = operations.filter((op) => op.type === PlanOperationType.MOVE);
	const renames = operations.filter((op) => op.type === PlanOperationType.RENAME);

	const total = operations.length;
	let done = 0;

	const progress = (msg: string) => {
		done++;
		onProgress(`(${done}/${total}) ${msg}`);
	};

	// 1. Create folders
	for (const op of folders) {
		if (op.type !== PlanOperationType.CREATE_FOLDER) continue;
		try {
			await ensureFolder(app, op.path);
			progress(`Created folder: ${op.path}`);
			report.succeeded++;
		} catch (err: unknown) {
			const msg = `Failed to create folder "${op.path}": ${errMsg(err)}`;
			report.errors.push(msg);
			report.failed++;
			progress(msg);
		}
	}

	// 2. Merge operations (need Claude API calls)
	for (const op of merges) {
		try {
			onProgress(`Generating merged content for: ${op.destination}...`);

			// Ensure destination folder exists
			const destFolder = op.destination.substring(0, op.destination.lastIndexOf("/"));
			if (destFolder) await ensureFolder(app, destFolder);

			// Generate merged content via Claude
			const mergedContent = await restructureService.generateMergedContent(
				app.vault,
				op.sources,
				op.destination.split("/").pop() || op.destination,
			);

			// Create the merged file
			await app.vault.create(op.destination, mergedContent);

			// Trash the source files (safe — recoverable from trash)
			for (const source of op.sources) {
				const file = app.vault.getAbstractFileByPath(source);
				if (file) {
					await app.vault.trash(file, true);
				}
			}

			progress(`Merged ${op.sources.length} notes → ${op.destination}`);
			report.succeeded++;
		} catch (err: unknown) {
			const msg = `Failed to merge into "${op.destination}": ${errMsg(err)}`;
			report.errors.push(msg);
			report.failed++;
			progress(msg);
		}
	}

	// 3. Split operations (need Claude API calls)
	for (const op of splits) {
		try {
			onProgress(`Generating split content from: ${op.source}...`);

			// Generate split content via Claude
			const splitContent = await restructureService.generateSplitContent(
				app.vault,
				op.source,
				op.destinations,
			);

			// Create the split files
			for (const [destPath, content] of Object.entries(splitContent)) {
				const destFolder = destPath.substring(0, destPath.lastIndexOf("/"));
				if (destFolder) await ensureFolder(app, destFolder);
				await app.vault.create(destPath, content);
			}

			// Trash the source file
			const file = app.vault.getAbstractFileByPath(op.source);
			if (file) {
				await app.vault.trash(file, true);
			}

			progress(`Split ${op.source} → ${op.destinations.length} notes`);
			report.succeeded++;
		} catch (err: unknown) {
			const msg = `Failed to split "${op.source}": ${errMsg(err)}`;
			report.errors.push(msg);
			report.failed++;
			progress(msg);
		}
	}

	// 4. Moves (use fileManager.renameFile for link updates)
	for (const op of moves) {
		if (op.type !== PlanOperationType.MOVE) continue;
		try {
			const file = app.vault.getAbstractFileByPath(op.source);
			if (!file) throw new Error(`File not found: ${op.source}`);

			// Ensure destination folder exists
			const destFolder = op.destination.substring(0, op.destination.lastIndexOf("/"));
			if (destFolder) await ensureFolder(app, destFolder);

			// renameFile auto-updates all [[wikilinks]] across the vault
			await app.fileManager.renameFile(file, op.destination);

			progress(`Moved: ${op.source} → ${op.destination}`);
			report.succeeded++;
		} catch (err: unknown) {
			const msg = `Failed to move "${op.source}": ${errMsg(err)}`;
			report.errors.push(msg);
			report.failed++;
			progress(msg);
		}
	}

	// 5. Renames (also use fileManager.renameFile)
	for (const op of renames) {
		if (op.type !== PlanOperationType.RENAME) continue;
		try {
			const file = app.vault.getAbstractFileByPath(op.source);
			if (!file) throw new Error(`File not found: ${op.source}`);

			await app.fileManager.renameFile(file, op.destination);

			progress(`Renamed: ${op.source} → ${op.destination}`);
			report.succeeded++;
		} catch (err: unknown) {
			const msg = `Failed to rename "${op.source}": ${errMsg(err)}`;
			report.errors.push(msg);
			report.failed++;
			progress(msg);
		}
	}

	return report;
}

/**
 * Create a folder (and parents) if it doesn't exist.
 */
async function ensureFolder(app: App, folderPath: string): Promise<void> {
	// Normalize: remove trailing slash
	const normalized = folderPath.replace(/\/+$/, "");
	if (!normalized) return;

	const existing = app.vault.getAbstractFileByPath(normalized);
	if (existing instanceof TFolder) return; // Already exists

	// Create parent folders recursively
	const parent = normalized.substring(0, normalized.lastIndexOf("/"));
	if (parent) {
		await ensureFolder(app, parent);
	}

	try {
		await app.vault.createFolder(normalized);
	} catch {
		// Folder may have been created by a concurrent operation
		if (!(app.vault.getAbstractFileByPath(normalized) instanceof TFolder)) {
			throw new Error(`Could not create folder: ${normalized}`);
		}
	}
}

function errMsg(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
