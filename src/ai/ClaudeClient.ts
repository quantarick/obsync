// ============================================================
// Obsync — Claude API Client
// ============================================================
// Calls the Anthropic Messages API using Obsidian's requestUrl.
// Returns structured responses with token usage info.
// ============================================================

import { requestUrl } from "obsidian";

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

export interface ClaudeRequestOptions {
	apiKey: string;
	model: string;
	systemPrompt: string;
	userContent: string;
	maxTokens: number;
}

export interface ClaudeResponse {
	content: string;
	inputTokens: number;
	outputTokens: number;
	model: string;
	stopReason: string; // "end_turn" or "max_tokens"
}

/**
 * Call the Claude Messages API. Throws descriptive errors on failure.
 */
export async function callClaude(options: ClaudeRequestOptions): Promise<ClaudeResponse> {
	const { apiKey, model, systemPrompt, userContent, maxTokens } = options;

	let response;
	try {
		response = await requestUrl({
			url: API_URL,
			method: "POST",
			headers: {
				"x-api-key": apiKey,
				"anthropic-version": API_VERSION,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				model,
				max_tokens: maxTokens,
				system: systemPrompt,
				messages: [{ role: "user", content: userContent }],
			}),
			throw: false, // Don't throw on non-2xx — we handle errors ourselves
		});
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new Error(`Could not reach Claude API. Check your internet connection. (${msg})`);
	}

	if (response.status === 401) {
		throw new Error("Invalid Claude API key. Check your key in Obsync settings.");
	}
	if (response.status === 429) {
		throw new Error("Rate limited by Claude API. Please wait a moment and try again.");
	}
	if (response.status === 400) {
		const body = response.json;
		const detail = body?.error?.message || "Bad request";
		throw new Error(`Claude API error: ${detail}`);
	}
	if (response.status >= 500) {
		throw new Error("Claude API is temporarily unavailable. Try again later.");
	}
	if (response.status !== 200) {
		throw new Error(`Claude API returned status ${response.status}`);
	}

	const body = response.json;
	const textBlock = body.content?.find((b: any) => b.type === "text");
	if (!textBlock) {
		throw new Error("Claude API returned no text content.");
	}

	return {
		content: textBlock.text,
		inputTokens: body.usage?.input_tokens ?? 0,
		outputTokens: body.usage?.output_tokens ?? 0,
		model: body.model ?? model,
		stopReason: body.stop_reason ?? "end_turn",
	};
}
