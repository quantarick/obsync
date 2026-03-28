// ============================================================
// Obsync — Main Plugin Entry Point
// ============================================================
import { Plugin, Notice, Editor, MarkdownView } from "obsidian";
import {
	ObsyncSettings,
	DEFAULT_SETTINGS,
	ObsyncSettingTab,
} from "./settings";
import { GitOperations } from "./git/GitOperations";
import { Debouncer } from "./sync/Debouncer";
import { FileWatcher } from "./sync/FileWatcher";
import { SyncEngine, SyncState } from "./sync/SyncEngine";
import { StatusBar } from "./ui/StatusBar";
import { SyncHistoryModal } from "./ui/SyncHistoryModal";
import { RestructureService } from "./ai/RestructureService";
import { VaultRestructureService } from "./ai/VaultRestructureService";
import { executePlan } from "./ai/PlanExecutor";
import { RestructurePreviewModal } from "./ui/RestructurePreviewModal";
import { VaultRestructureModal } from "./ui/VaultRestructureModal";
import { LoadingModal } from "./ui/LoadingModal";

export default class ObsyncPlugin extends Plugin {
	settings!: ObsyncSettings;
	git!: GitOperations;
	private restructureService!: RestructureService;
	private vaultRestructureService!: VaultRestructureService;
	private debouncer: Debouncer | null = null;
	private fileWatcher: FileWatcher | null = null;
	private syncEngine: SyncEngine | null = null;
	private statusBar: StatusBar | null = null;
	private initialized: boolean = false;

	async onload(): Promise<void> {
		console.log("Obsync: Plugin loaded");

		const getAiSettings = () => this.settings;
		const getAiKey = () => Promise.resolve(this.app.secretStorage.getSecret("claude-api-key"));
		this.restructureService = new RestructureService(getAiSettings, getAiKey);
		this.vaultRestructureService = new VaultRestructureService(getAiSettings, getAiKey);

		try {
			await this.loadSettings();
		} catch (err: unknown) {
			console.error("Obsync: Failed to load settings, using defaults");
			this.settings = Object.assign({}, DEFAULT_SETTINGS);
		}

		// Settings tab (always available, even if init fails)
		this.addSettingTab(new ObsyncSettingTab(this.app, this));

		// Status bar (always visible)
		const statusBarEl = this.addStatusBarItem();
		this.statusBar = new StatusBar(statusBarEl, () => {
			this.triggerSync();
		});

		try {
			// Validate vault path
			const adapter = this.app.vault.adapter as any;
			const vaultPath: string | undefined = adapter?.basePath;
			if (!vaultPath || typeof vaultPath !== "string") {
				throw new Error("Could not determine vault path");
			}

			// Git
			this.git = new GitOperations(
				vaultPath,
				this.settings.remoteUrl,
				this.settings.githubToken,
				this.settings.deviceName,
				this.settings.authorEmail,
				this.settings.branch,
			);

			// Sync engine
			this.syncEngine = new SyncEngine(
				this.git,
				this.settings.pullIntervalSeconds * 1000,
				(state: SyncState, message: string) => {
					if (this.statusBar) {
						this.statusBar.update(state, message);
					}
				},
				this.settings.mergeStrategy,
				this.settings.deviceName,
				vaultPath,
			);

			// Debouncer → SyncEngine
			this.debouncer = new Debouncer(
				this.settings.debounceSeconds * 1000,
				(changedPaths: Set<string>) => {
					if (this.syncEngine) {
						this.syncEngine.syncLocal(changedPaths);
					}
				}
			);

			// File watcher
			this.fileWatcher = new FileWatcher(
				this.app.vault,
				this.debouncer,
				this.settings.ignoredPatterns,
			);
			this.fileWatcher.start();

			// Start periodic remote checks (if remote URL is configured)
			if (this.settings.remoteUrl) {
				this.syncEngine.startPeriodicSync();
			}

			// Auto-sync on startup
			if (this.settings.autoSyncOnStartup && this.settings.remoteUrl) {
				setTimeout(() => {
					if (this.syncEngine) {
						this.syncEngine.syncRemote();
					}
				}, 3000);
			}

			this.initialized = true;

		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`Obsync: Initialization failed — ${msg}`);
			if (this.statusBar) {
				this.statusBar.update(SyncState.ERROR, `Init failed: ${msg}`);
			}
			new Notice(`Obsync: Initialization failed — ${msg}`, 10000);
		}

		// ========================
		// UI: RIBBON ICON
		// ========================
		const ribbonEl = this.addRibbonIcon("refresh-cw", "Obsync: Sync now", () => {
			this.triggerSync();
		});
		ribbonEl.setAttribute("aria-label", "Obsync: Sync now");

		// ========================
		// COMMANDS (always registered, even if init fails — they show errors gracefully)
		// ========================
		this.addCommand({
			id: "obsync-sync-now",
			name: "Sync now",
			callback: () => this.triggerSync(),
		});

		this.addCommand({
			id: "obsync-toggle-sync",
			name: "Pause / Resume sync",
			callback: () => {
				if (!this.syncEngine) {
					new Notice("Obsync: Not initialized — check settings");
					return;
				}
				if (this.syncEngine.isPaused()) {
					this.syncEngine.resume();
					new Notice("Obsync: Sync resumed");
				} else {
					this.syncEngine.pause();
					new Notice("Obsync: Sync paused");
				}
			},
		});

		this.addCommand({
			id: "obsync-init-repo",
			name: "Initialize git repo in vault",
			callback: async () => {
				if (!this.git) {
					new Notice("Obsync: Not initialized — check settings");
					return;
				}
				try {
					await this.git.ensureRepo();
					new Notice("Obsync: Git repo initialized!");
				} catch (err: unknown) {
					const msg = err instanceof Error ? err.message : String(err);
					new Notice(`Obsync: Init failed — ${msg}`);
				}
			},
		});

		this.addCommand({
			id: "obsync-check-status",
			name: "Check git status",
			callback: async () => {
				if (!this.git) {
					new Notice("Obsync: Not initialized — check settings");
					return;
				}
				try {
					const statuses = await this.git.status();
					if (statuses.length === 0) {
						new Notice("Obsync: No changes detected");
					} else {
						const summary = statuses
							.slice(0, 10)
							.map((s) => `${s.status}: ${s.filepath}`)
							.join("\n");
						const extra = statuses.length > 10
							? `\n...and ${statuses.length - 10} more`
							: "";
						new Notice(`Obsync: ${statuses.length} changes\n${summary}${extra}`, 10000);
					}
				} catch (err: unknown) {
					const msg = err instanceof Error ? err.message : String(err);
					new Notice(`Obsync: Status failed — ${msg}`);
				}
			},
		});

		this.addCommand({
			id: "obsync-view-history",
			name: "View sync history",
			callback: async () => {
				if (!this.git) {
					new Notice("Obsync: Not initialized — check settings");
					return;
				}
				try {
					const logs = await this.git.log(20);
					new SyncHistoryModal(this.app, logs).open();
				} catch (err: unknown) {
					const msg = err instanceof Error ? err.message : String(err);
					new Notice(`Obsync: Failed to load history — ${msg}`);
				}
			},
		});

		this.addCommand({
			id: "obsync-status",
			name: "Show sync status",
			callback: () => {
				new Notice(
					`Obsync — Device: ${this.settings.deviceName}, ` +
					`Strategy: ${this.settings.mergeStrategy}, ` +
					`Remote: ${this.settings.remoteUrl || "(not set)"}` +
					`${this.initialized ? "" : " [NOT INITIALIZED]"}`
				);
			},
		});

		// ========================
		// AI RESTRUCTURE COMMANDS
		// ========================
		this.addCommand({
			id: "obsync-restructure-note",
			name: "Restructure entire note with AI",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.runRestructure(editor, editor.getValue(), (result) => {
					editor.setValue(result);
				});
			},
		});

		this.addCommand({
			id: "obsync-restructure-selection",
			name: "Restructure selection with AI",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				const selection = editor.getSelection();
				if (!selection || selection.trim().length === 0) {
					new Notice("Obsync: Select some text first");
					return;
				}
				this.runRestructure(editor, selection, (result) => {
					editor.replaceSelection(result);
				});
			},
		});

		this.addCommand({
			id: "obsync-restructure-vault",
			name: "Restructure vault with AI",
			callback: () => this.runVaultRestructure(),
		});

		this.addCommand({
			id: "obsync-restructure-folder",
			name: "Restructure current folder with AI",
			callback: () => this.runFolderRestructure(),
		});

		console.log("Obsync: Plugin ready");
	}

	onunload(): void {
		console.log("Obsync: Plugin unloaded");
		// Safe cleanup — each component might be null if init failed partway
		if (this.fileWatcher) this.fileWatcher.stop();
		if (this.syncEngine) this.syncEngine.cleanup();
	}

	private async runRestructure(
		editor: Editor,
		content: string,
		applyResult: (restructured: string) => void,
	): Promise<void> {
		const loading = new LoadingModal(this.app, "Restructuring note with Claude...");
		loading.open();

		try {
			const result = await this.restructureService.restructure(content);
			loading.dismiss();
			new RestructurePreviewModal(this.app, result, () => {
				applyResult(result.restructured);
				new Notice("Obsync: Note restructured", 3000);
			}).open();
		} catch (err: unknown) {
			loading.dismiss();
			const msg = err instanceof Error ? err.message : String(err);
			new Notice(`Obsync: ${msg}`, 10000);
			console.error(`Obsync: Restructure failed — ${msg}`);
		}
	}

	private async runVaultRestructure(): Promise<void> {
		const loading = new LoadingModal(this.app, "Analyzing vault and generating plan...");
		loading.open();

		try {
			const plan = await this.vaultRestructureService.generatePlan(
				this.app.vault,
				this.app.metadataCache,
			);
			loading.dismiss();

			if (plan.operations.length === 0) {
				new Notice("Obsync: Vault is already well-organized. No changes proposed.", 5000);
				return;
			}

			new VaultRestructureModal(this.app, plan, async (selectedOps) => {
				const report = await executePlan(
					this.app,
					selectedOps,
					this.vaultRestructureService,
					(msg) => console.log(`Obsync: ${msg}`),
				);

				const summary =
					`Obsync: ${report.succeeded} operation(s) succeeded` +
					(report.failed > 0 ? `, ${report.failed} failed` : "");
				new Notice(summary, 8000);

				if (report.errors.length > 0) {
					console.error("Obsync: Vault restructure errors:", report.errors);
				}
			}).open();
		} catch (err: unknown) {
			loading.dismiss();
			const msg = err instanceof Error ? err.message : String(err);
			new Notice(`Obsync: ${msg}`, 10000);
			console.error(`Obsync: Vault restructure failed — ${msg}`);
		}
	}

	private async runFolderRestructure(): Promise<void> {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile || !activeFile.parent) {
			new Notice("Obsync: Open a note inside a folder first");
			return;
		}

		const folderPath = activeFile.parent.path;
		if (folderPath === "/") {
			new Notice("Obsync: Active note is at vault root. Use 'Restructure vault with AI' instead.");
			return;
		}

		const loading = new LoadingModal(this.app, `Analyzing folder "${folderPath}"...`);
		loading.open();

		try {
			const plan = await this.vaultRestructureService.generateFolderPlan(
				this.app.vault,
				this.app.metadataCache,
				folderPath,
			);
			loading.dismiss();

			if (plan.operations.length === 0) {
				new Notice("Obsync: Folder is already well-organized. No changes proposed.", 5000);
				return;
			}

			new VaultRestructureModal(this.app, plan, async (selectedOps) => {
				const report = await executePlan(
					this.app,
					selectedOps,
					this.vaultRestructureService,
					(msg) => console.log(`Obsync: ${msg}`),
				);

				const summary =
					`Obsync: ${report.succeeded} operation(s) succeeded` +
					(report.failed > 0 ? `, ${report.failed} failed` : "");
				new Notice(summary, 8000);

				if (report.errors.length > 0) {
					console.error("Obsync: Folder restructure errors:", report.errors);
				}
			}).open();
		} catch (err: unknown) {
			loading.dismiss();
			const msg = err instanceof Error ? err.message : String(err);
			new Notice(`Obsync: ${msg}`, 10000);
			console.error(`Obsync: Folder restructure failed — ${msg}`);
		}
	}

	private async triggerSync(): Promise<void> {
		if (!this.git || !this.syncEngine) {
			new Notice("Obsync: Not initialized — configure Remote URL and Token in settings");
			return;
		}
		try {
			const statuses = await this.git.status();
			if (statuses.length > 0) {
				const paths = new Set(statuses.map((s) => s.filepath));
				await this.syncEngine.syncLocal(paths);
			} else {
				await this.syncEngine.syncRemote();
			}
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			new Notice(`Obsync: Sync failed — ${msg}`);
		}
	}

	async loadSettings(): Promise<void> {
		const data = await this.loadData() || {};
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);

		// Load secrets from Obsidian's native secret storage
		const secureToken = this.app.secretStorage.getSecret("github-token");
		if (secureToken) {
			this.settings.githubToken = secureToken;
		}

		const secureClaudeKey = this.app.secretStorage.getSecret("claude-api-key");
		if (secureClaudeKey) {
			this.settings.claudeApiKey = secureClaudeKey;
		}

		// Migrate secrets from data.json to native secret storage
		if (data.githubToken && !secureToken) {
			console.log("Obsync: Migrating GitHub token from data.json to secret storage");
			this.app.secretStorage.setSecret("github-token", data.githubToken);
			delete data.githubToken;
			await this.saveData(data);
		}
		if (data.claudeApiKey && !secureClaudeKey) {
			console.log("Obsync: Migrating Claude API key from data.json to secret storage");
			this.app.secretStorage.setSecret("claude-api-key", data.claudeApiKey);
			delete data.claudeApiKey;
			await this.saveData(data);
		}
	}

	async saveSettings(): Promise<void> {
		// Save secrets to Obsidian's native secret storage
		if (this.settings.githubToken) {
			this.app.secretStorage.setSecret("github-token", this.settings.githubToken);
		}
		if (this.settings.claudeApiKey) {
			this.app.secretStorage.setSecret("claude-api-key", this.settings.claudeApiKey);
		}

		// Save everything except secrets to data.json
		const dataToSave = Object.assign({}, this.settings);
		delete (dataToSave as any).githubToken;
		delete (dataToSave as any).claudeApiKey;
		await this.saveData(dataToSave);
	}
}
