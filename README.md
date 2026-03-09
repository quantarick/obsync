# Obsync

Sync your Obsidian vault across devices using Git.

Obsync is an Obsidian community plugin that automatically syncs your notes between macOS and Windows (or any platform) using a private GitHub repository as the backend. No external services or daemons required — it runs entirely inside Obsidian.

## Features

- **Automatic sync** — detects file changes and syncs in the background
- **Full version history** — every edit is a git commit you can browse or revert
- **Conflict resolution** — automatically merges when the same note is edited on two devices
- **Configurable** — merge strategy, sync interval, debounce delay, ignored patterns
- **Status bar** — shows sync state at a glance, click to sync manually
- **Commands** — sync now, pause/resume, view history, check status via command palette

## Prerequisites

- A **GitHub account** with a [personal access token](https://github.com/settings/tokens) (fine-grained, with `Contents: Read and write` permission)
- A **private GitHub repository** for your vault (e.g., `https://github.com/you/obsidian-vault.git`)
- **Git** installed on your system (`git --version` to check)

## Installation

### From source

```bash
git clone https://github.com/quantarick/obsync.git
cd obsync
npm install
npm run build
```

Then copy these files into your vault's plugin folder:

```
<your-vault>/.obsidian/plugins/obsync/
├── main.js
├── manifest.json
└── styles.css
```

### Manual install

Copy `main.js`, `manifest.json`, and `styles.css` from the [releases](https://github.com/quantarick/obsync/releases) into:

```
<your-vault>/.obsidian/plugins/obsync/
```

### Enable the plugin

1. Open Obsidian → Settings → Community plugins
2. Turn off **Restricted mode** if prompted
3. Find **Obsync** in the list → toggle it **on**

## Setup

1. Create a **private repository** on GitHub (e.g., `obsidian-vault`)
2. Generate a **personal access token** with `Contents: Read and write` access to that repo
3. In Obsidian, go to **Settings → Obsync** and configure:

| Setting | Description |
|---|---|
| **Remote URL** | Your GitHub repo URL (e.g., `https://github.com/you/obsidian-vault.git`) |
| **GitHub token** | Your personal access token |
| **Device name** | Identifies this machine in commits (e.g., `mac`, `windows`) |
| **Author email** | Email for git commits |
| **Merge strategy** | How to resolve conflicts (default: Append both) |

4. Use the command **"Obsync: Initialize git repo in vault"** to set up git in your vault
5. Click the sync icon in the ribbon or run **"Obsync: Sync now"**

### Setting up a second device

1. Clone your vault repo: `git clone https://github.com/you/obsidian-vault.git`
2. Open the cloned folder as an Obsidian vault
3. Install the plugin (copy `main.js`, `manifest.json`, `styles.css` into `.obsidian/plugins/obsync/`)
4. Configure the same Remote URL and token in settings
5. Set a different **Device name** (e.g., `windows`)

## Usage

### Automatic sync

Once configured, Obsync works automatically:

- **File changes** are detected, debounced (default 3s), committed, and pushed
- **Remote changes** are pulled periodically (default every 30s)
- **On startup**, the latest remote changes are pulled automatically

### Commands

Open the command palette (`Cmd/Ctrl + P`) and search for "Obsync":

| Command | Description |
|---|---|
| **Sync now** | Trigger an immediate sync |
| **Pause / Resume sync** | Toggle automatic syncing |
| **Initialize git repo in vault** | Set up git in the current vault |
| **Check git status** | Show pending file changes |
| **View sync history** | Browse recent commits in a modal |
| **Show sync status** | Display current device, strategy, and remote info |

### Status bar

The bottom status bar shows the current sync state:

| Icon | Meaning |
|---|---|
| `✓ Synced at 2:30 PM` | Up to date |
| `↑ Pushing...` | Uploading local changes |
| `↓ Pulling...` | Downloading remote changes |
| `⚠ Sync failed` | Error occurred — check console for details |
| `⏸ Paused` | Sync is paused |

Click the status bar to trigger a manual sync.

## Merge Strategies

When the same note is edited on two devices before syncing:

| Strategy | Behavior | Data loss? |
|---|---|---|
| **Append both** (default) | Keeps both versions separated by a conflict marker with timestamps | None |
| **Last write wins** | Keeps the version with the most recent timestamp | Yes |
| **Device priority** | One device always wins | Yes |
| **Longest content wins** | Keeps the version with more content | Yes |

**Append both** example:
```markdown
# My Note
Content edited on Mac...

---
> ⚠️ SYNC CONFLICT (2026-02-28 14:30) — merged from: windows

# My Note
Content edited on Windows...
```

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full design document.

### Tech stack

| Component | Technology |
|---|---|
| Language | TypeScript |
| Runtime | Node.js (Obsidian's Electron) |
| Build | esbuild |
| Git | isomorphic-git + system git CLI |
| File watching | Obsidian Vault events API |
| Auth | GitHub personal access token |

### Project structure

```
obsync/
├── src/
│   ├── main.ts                  # Plugin entry point
│   ├── settings.ts              # Settings interface + UI
│   ├── git/
│   │   └── GitOperations.ts     # Git wrapper (isomorphic-git + system git)
│   ├── sync/
│   │   ├── SyncEngine.ts        # Orchestrates commit/push/pull
│   │   ├── ConflictResolver.ts  # Auto merge strategy handler
│   │   ├── Debouncer.ts         # Batches rapid file changes
│   │   └── FileWatcher.ts       # Watches vault events
│   └── ui/
│       ├── StatusBar.ts         # Status bar component
│       └── SyncHistoryModal.ts  # Commit history modal
├── docs/
│   ├── ARCHITECTURE.md          # Design document
│   └── IMPLEMENTATION_PLAN.md   # Build phases
├── manifest.json
├── package.json
├── tsconfig.json
├── esbuild.config.mjs
└── styles.css
```

## Known Limitations

- **Binary files** (images, PDFs) use last-write-wins — content merge is not possible
- **Large vaults** with many files may have slower initial sync
- **`.obsidian/workspace.json`** is ignored by default (it changes on every UI interaction)
- System `git` must be installed for add/commit operations (needed for Unicode filename support on macOS)

## Development

```bash
npm install          # Install dependencies
npm run dev          # Build with watch mode
npm run build        # Production build
```

The built `main.js` is output to the project root. Copy it to your vault's plugin folder to test.

## License

MIT
