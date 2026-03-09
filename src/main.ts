// ============================================================
// Obsync — Main Plugin Entry Point
// ============================================================
import { Plugin, Notice } from "obsidian";
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

export default class ObsyncPlugin extends Plugin {
	settings!: ObsyncSettings;
	git!: GitOperations;
	private debouncer: Debouncer | null = null;
	private fileWatcher: FileWatcher | null = null;
	private syncEngine: SyncEngine | null = null;
	private statusBar: StatusBar | null = null;
	private initialized: boolean = false;

	async onload(): Promise<void> {
		console.log("Obsync: Plugin loaded");

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

		console.log("Obsync: Plugin ready");
	}

	onunload(): void {
		console.log("Obsync: Plugin unloaded");
		// Safe cleanup — each component might be null if init failed partway
		if (this.fileWatcher) this.fileWatcher.stop();
		if (this.syncEngine) this.syncEngine.cleanup();
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
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
