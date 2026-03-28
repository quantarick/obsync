// ============================================================
// Obsync — Vault Restructure Service
// ============================================================
// Orchestrates multi-step AI vault restructuring:
//   Phase 1: Analyze vault → send metadata to Claude → get plan
//   Phase 2: For merge/split ops, make follow-up Claude calls
//            to generate actual content
// ============================================================

import { Vault, MetadataCache } from "obsidian";
import { callClaude } from "./ClaudeClient";
import { analyzeVault, formatMetadataForPrompt } from "./VaultAnalyzer";
import { VaultPlan, parsePlan } from "./VaultRestructurePlan";
import type { AiSettings } from "./RestructureService";

const PLAN_SYSTEM_PROMPT = `You are an expert knowledge management consultant. Your task is to analyze an Obsidian vault and propose a reorganization plan.

You will receive metadata about every note in the vault (file paths, headings, tags, links, and content previews). Based on this, produce a JSON reorganization plan.

Rules:
- Return ONLY valid JSON matching the schema below. No explanation text before or after.
- Preserve ALL content. Never propose deleting notes without merging their content elsewhere.
- Group related notes under meaningful folders. Keep hierarchy shallow (max 3 levels deep).
- Merge notes only when they are clearly about the same topic and would benefit from consolidation.
- Split notes only when a single note covers multiple clearly distinct topics.
- Rename notes to be descriptive and consistent. Use Title Case for note names.
- For moves, create the necessary folders first (create_folder operations must come before moves into them).
- Provide a clear reason for every operation.
- Do not touch notes that are already well-organized.
- Preserve Obsidian conventions: keep daily notes in their folder, templates in templates folder, etc.

JSON Schema:
{
  "summary": "One paragraph describing the overall reorganization",
  "operations": [
    { "type": "create_folder", "path": "Folder/Subfolder/", "reason": "..." },
    { "type": "move", "source": "old/path.md", "destination": "new/path.md", "reason": "..." },
    { "type": "rename", "source": "old name.md", "destination": "New Name.md", "reason": "..." },
    { "type": "merge", "sources": ["note1.md", "note2.md"], "destination": "Folder/Combined.md", "reason": "..." },
    { "type": "split", "source": "big-note.md", "destinations": ["Topic A.md", "Topic B.md"], "reason": "..." }
  ]
}`;

const MERGE_SYSTEM_PROMPT = `You are an expert note editor. Merge the following notes into a single well-structured markdown note.

Rules:
- Preserve ALL information from every source note. Do not omit anything.
- Organize content under clear headings. Remove duplicated information.
- Preserve all links ([[wikilinks]]), tags (#tags), and Obsidian-specific syntax.
- Do not wrap output in a code fence. Return only the merged markdown.
- Maintain the same language as the source notes.`;

const SPLIT_SYSTEM_PROMPT = `You are an expert note editor. Split the following note into separate focused notes.

You will be told what topics to split into. Return a JSON object where keys are the destination filenames and values are the markdown content for each.

Rules:
- Preserve ALL information from the original note across the split notes.
- Each split note should be self-contained with proper headings.
- Preserve all links ([[wikilinks]]), tags (#tags), and Obsidian-specific syntax.
- Return ONLY valid JSON: { "filename.md": "content...", "filename2.md": "content..." }
- Maintain the same language as the original note.`;

export class VaultRestructureService {
	private readonly getSettings: () => AiSettings;
	private readonly getApiKey: () => Promise<string | null>;

	constructor(
		getSettings: () => AiSettings,
		getApiKey: () => Promise<string | null>,
	) {
		this.getSettings = getSettings;
		this.getApiKey = getApiKey;
	}

	/**
	 * Phase 1: Analyze vault and generate a restructuring plan.
	 */
	async generatePlan(
		vault: Vault,
		metadataCache: MetadataCache,
	): Promise<VaultPlan> {
		const settings = this.getSettings();
		const apiKey = await this.requireApiKey(settings);

		// Collect vault metadata
		const notes = await analyzeVault(vault, metadataCache);
		if (notes.length === 0) {
			throw new Error("No markdown notes found in the vault.");
		}

		const metadata = formatMetadataForPrompt(notes);
		console.log(`Obsync: Vault analysis — ${notes.length} notes, ~${Math.ceil(metadata.length / 4)} tokens`);

		const response = await callClaude({
			apiKey,
			model: settings.claudeModel,
			systemPrompt: PLAN_SYSTEM_PROMPT,
			userContent: metadata,
			maxTokens: 16384,
		});

		return parsePlan(response.content);
	}

	/**
	 * Phase 2a: Generate merged content for a merge operation.
	 * Reads full content of source notes and sends to Claude.
	 */
	async generateMergedContent(
		vault: Vault,
		sourcePaths: string[],
		destinationName: string,
	): Promise<string> {
		const settings = this.getSettings();
		const apiKey = await this.requireApiKey(settings);

		const parts: string[] = [];
		for (const sourcePath of sourcePaths) {
			const file = vault.getAbstractFileByPath(sourcePath);
			if (!file || !("stat" in file)) {
				throw new Error(`Source file not found: ${sourcePath}`);
			}
			const content = await vault.read(file as any);
			parts.push(`=== SOURCE: ${sourcePath} ===\n${content}\n`);
		}

		const userContent = `Merge these ${sourcePaths.length} notes into: "${destinationName}"\n\n${parts.join("\n")}`;

		const response = await callClaude({
			apiKey,
			model: settings.claudeModel,
			systemPrompt: MERGE_SYSTEM_PROMPT,
			userContent,
			maxTokens: Math.max(8192, Math.ceil(userContent.length / 2)),
		});

		return response.content;
	}

	/**
	 * Phase 2b: Generate split content for a split operation.
	 * Reads full content of source note and asks Claude to split it.
	 */
	async generateSplitContent(
		vault: Vault,
		sourcePath: string,
		destinations: string[],
	): Promise<Record<string, string>> {
		const settings = this.getSettings();
		const apiKey = await this.requireApiKey(settings);

		const file = vault.getAbstractFileByPath(sourcePath);
		if (!file || !("stat" in file)) {
			throw new Error(`Source file not found: ${sourcePath}`);
		}
		const content = await vault.read(file as any);

		const destNames = destinations.map((d) => {
			const parts = d.split("/");
			return parts[parts.length - 1];
		});

		const userContent =
			`Split this note into these files: ${destNames.join(", ")}\n\n` +
			`=== SOURCE: ${sourcePath} ===\n${content}`;

		const response = await callClaude({
			apiKey,
			model: settings.claudeModel,
			systemPrompt: SPLIT_SYSTEM_PROMPT,
			userContent,
			maxTokens: Math.max(8192, Math.ceil(content.length / 2)),
		});

		// Parse the JSON response
		let cleaned = response.content.trim();
		if (cleaned.startsWith("```")) {
			cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
		}

		let parsed: Record<string, string>;
		try {
			parsed = JSON.parse(cleaned);
		} catch {
			throw new Error("Claude returned invalid JSON for split operation.");
		}

		// Map filenames back to full destination paths
		const result: Record<string, string> = {};
		for (const dest of destinations) {
			const filename = dest.split("/").pop() || dest;
			const matchedContent = parsed[filename] || parsed[dest];
			if (!matchedContent) {
				throw new Error(`Claude did not generate content for: ${filename}`);
			}
			result[dest] = matchedContent;
		}

		return result;
	}

	private async requireApiKey(settings: AiSettings): Promise<string> {
		if (!settings.aiEnabled) {
			throw new Error("AI features are disabled. Enable them in Obsync settings.");
		}
		const apiKey = await this.getApiKey();
		if (!apiKey) {
			throw new Error("Claude API key not configured. Add it in Obsync settings.");
		}
		return apiKey;
	}
}
