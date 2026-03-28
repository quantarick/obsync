// ============================================================
// Obsync — Vault Analyzer
// ============================================================
// Walks the vault and collects metadata for all markdown files.
// Produces a compact summary suitable for sending to Claude.
// ============================================================

import { Vault, MetadataCache, TFile, CachedMetadata } from "obsidian";

export interface NoteMeta {
	path: string;
	size: number;
	headings: string[];
	tags: string[];
	outLinks: string[];
	preview: string; // First ~200 chars of content
}

/**
 * Analyze all markdown files in the vault and collect metadata.
 */
export async function analyzeVault(
	vault: Vault,
	metadataCache: MetadataCache,
): Promise<NoteMeta[]> {
	const files = vault.getMarkdownFiles();
	const notes: NoteMeta[] = [];

	for (const file of files) {
		// Skip plugin data and hidden files
		if (file.path.startsWith(".obsidian/")) continue;

		const cache = metadataCache.getFileCache(file);
		const content = await vault.cachedRead(file);

		notes.push({
			path: file.path,
			size: file.stat.size,
			headings: extractHeadings(cache),
			tags: extractTags(cache),
			outLinks: extractLinks(cache),
			preview: content.slice(0, 200).trim(),
		});
	}

	return notes;
}

/**
 * Format vault metadata into a compact string for the Claude prompt.
 * Each note is summarized in a few lines to minimize token usage.
 */
export function formatMetadataForPrompt(notes: NoteMeta[]): string {
	const lines: string[] = [];
	lines.push(`Vault contains ${notes.length} markdown notes:\n`);

	for (const note of notes) {
		lines.push(`--- ${note.path} (${formatSize(note.size)}) ---`);

		if (note.headings.length > 0) {
			lines.push(`  Headings: ${note.headings.join(" | ")}`);
		}
		if (note.tags.length > 0) {
			lines.push(`  Tags: ${note.tags.join(", ")}`);
		}
		if (note.outLinks.length > 0) {
			lines.push(`  Links to: ${note.outLinks.join(", ")}`);
		}
		if (note.preview) {
			lines.push(`  Preview: ${note.preview.replace(/\n/g, " ")}`);
		}
		lines.push("");
	}

	return lines.join("\n");
}

function extractHeadings(cache: CachedMetadata | null): string[] {
	if (!cache?.headings) return [];
	return cache.headings.map((h) => {
		const prefix = "#".repeat(h.level);
		return `${prefix} ${h.heading}`;
	});
}

function extractTags(cache: CachedMetadata | null): string[] {
	if (!cache?.tags) return [];
	return cache.tags.map((t) => t.tag);
}

function extractLinks(cache: CachedMetadata | null): string[] {
	if (!cache?.links) return [];
	// Deduplicate link targets
	const targets = new Set(cache.links.map((l) => l.link));
	return Array.from(targets);
}

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
