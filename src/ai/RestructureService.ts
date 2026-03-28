// ============================================================
// Obsync — Restructure Service
// ============================================================
// Orchestrates AI-powered note restructuring:
//   1. Validates preconditions (AI enabled, API key, content)
//   2. Estimates token usage and warns if large
//   3. Calls ClaudeClient with the restructuring prompt
//   4. Returns original + restructured content for preview
// ============================================================

import { Notice } from "obsidian";
import { callClaude } from "./ClaudeClient";

const DEFAULT_SYSTEM_PROMPT = `You are an expert note editor. Your task is to restructure the given markdown note to improve its clarity, organization, and readability while preserving ALL original information and meaning.

Rules:
- Preserve every piece of information from the original note. Do not remove, summarize away, or omit any content.
- Improve the hierarchical structure using appropriate heading levels (##, ###, etc.).
- Group related ideas under logical sections.
- Use bullet points or numbered lists where appropriate to improve scanability.
- Fix formatting inconsistencies (e.g., inconsistent heading levels, broken lists).
- Preserve all links, tags, and Obsidian-specific syntax (e.g., [[wikilinks]], #tags, callouts, dataview queries, embeds).
- Do not add new information, opinions, or commentary.
- Do not wrap the output in a code fence. Return only the restructured markdown.
- Maintain the same language as the original note.`;

// Rough token estimate: ~4 chars per token for English text
const CHARS_PER_TOKEN = 4;
const WARN_TOKEN_THRESHOLD = 100_000;  // ~400K chars — show warning
const BLOCK_TOKEN_THRESHOLD = 190_000; // ~760K chars — block request

export interface AiSettings {
	aiEnabled: boolean;
	claudeModel: string;
	claudeApiKey: string;
	customSystemPrompt: string;
}

export interface RestructureResult {
	original: string;
	restructured: string;
	inputTokens: number;
	outputTokens: number;
	model: string;
	truncated: boolean;
}

export class RestructureService {
	private readonly getSettings: () => AiSettings;
	private readonly getApiKey: () => Promise<string | null>;

	constructor(
		getSettings: () => AiSettings,
		getApiKey: () => Promise<string | null>,
	) {
		this.getSettings = getSettings;
		this.getApiKey = getApiKey;
	}

	async restructure(content: string): Promise<RestructureResult> {
		const settings = this.getSettings();

		// Validate preconditions
		if (!settings.aiEnabled) {
			throw new Error("AI features are disabled. Enable them in Obsync settings.");
		}

		const apiKey = await this.getApiKey();
		if (!apiKey) {
			throw new Error("Claude API key not configured. Add it in Obsync settings.");
		}

		if (!content || content.trim().length === 0) {
			throw new Error("Nothing to restructure.");
		}

		// Token estimation and limits
		const estimatedTokens = Math.ceil(content.length / CHARS_PER_TOKEN);

		if (estimatedTokens > BLOCK_TOKEN_THRESHOLD) {
			throw new Error(
				`Note is too large (~${Math.round(estimatedTokens / 1000)}K tokens). ` +
				"Select a smaller section and use 'Restructure selection' instead."
			);
		}

		if (estimatedTokens > WARN_TOKEN_THRESHOLD) {
			new Notice(
				`Large note (~${Math.round(estimatedTokens / 1000)}K tokens). ` +
				"The API call may take longer and cost more.",
				8000,
			);
		}

		// Calculate max output tokens — at least 4096, scale with input
		const maxTokens = Math.min(
			Math.max(4096, Math.ceil(estimatedTokens * 1.5)),
			128_000, // Model output cap
		);

		const systemPrompt = settings.customSystemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT;

		const response = await callClaude({
			apiKey,
			model: settings.claudeModel,
			systemPrompt,
			userContent: content,
			maxTokens,
		});

		return {
			original: content,
			restructured: response.content,
			inputTokens: response.inputTokens,
			outputTokens: response.outputTokens,
			model: response.model,
			truncated: response.stopReason === "max_tokens",
		};
	}
}
