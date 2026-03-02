# Obsync — Architecture Design Document

## Overview

Obsync is an **Obsidian community plugin** (TypeScript) that synchronizes vault content between macOS and Windows machines using Git as the transport and versioning backend. It runs inside Obsidian — no external services or daemons required.

## Problem Statement

Obsidian stores notes as plain Markdown files on the local filesystem. There is no built-in free sync mechanism across platforms. The official Obsidian Sync service is a paid subscription. We need a self-hosted solution that:

- Syncs vault content between Mac and Windows over the internet
- Tracks full version history of all notes
- Handles merge conflicts automatically using a user-chosen strategy
- Runs in real-time, syncing automatically as files change
- Requires zero external setup beyond a GitHub account

## Obsidian Storage Format

Obsidian vaults are plain filesystem folders:

```
MyVault/
├── .obsidian/              # Config: settings, plugins, themes, UI state
│   ├── app.json
│   ├── appearance.json
│   ├── community-plugins.json
│   ├── plugins/
│   │   └── obsync/         # ← Our plugin lives here
│   ├── themes/
│   └── workspace.json      # Changes on every UI interaction — must be ignored
├── Daily Notes/
│   └── 2026-02-28.md
├── Projects/
│   ├── obsync.md
│   └── attachments/
│       └── screenshot.png
└── Some Note.md
```

Key properties:
- Each note = one `.md` file (plain Markdown)
- Folder structure = vault organization
- Links between notes use `[[wiki-link]]` syntax inside `.md` content
- No proprietary database — Obsidian builds its index in-memory at startup
- Attachments (images, PDFs) stored as regular files

## Architecture Decisions

### Decision 1: Deployment — Obsidian Plugin (TypeScript)

**Chosen:** Build as an Obsidian community plugin in TypeScript.

| Option | Language | How It Runs | Verdict |
|---|---|---|---|
| **Obsidian Plugin** | TypeScript | Inside Obsidian's Electron/Node.js runtime | **Chosen** |
| Standalone Java Daemon | Java | Separate background process | Rejected |
| Hybrid (TS plugin + Java) | TS + Java | Plugin for UI, Java for logic | Rejected |

**Rationale:**
- Obsidian plugins run in Node.js — full access to filesystem and network APIs
- `isomorphic-git` provides pure JS Git implementation (no system `git` dependency)
- Native integration: settings tab, status bar, command palette, notifications
- No separate service to install/manage — starts and stops with Obsidian
- Syncing only matters when Obsidian is open, so a 24/7 daemon is wasteful

### Decision 2: Sync Backend — Git (GitHub)

**Chosen:** Use a private GitHub repo as the sync backend.

```
  Mac (Obsidian + Plugin)             GitHub Repo                  Windows (Obsidian + Plugin)
 ┌──────────────────────┐          ┌───────────────────┐          ┌──────────────────────┐
 │ Vault Folder          │  push   │  quantarick/       │  pull   │  Vault Folder          │
 │ = Git Repo            │────────►│  obsidian-vault    │────────►│  = Git Repo            │
 │                       │  pull   │  (private repo)    │  push   │                        │
 │ Obsync Plugin         │◄────────│  Full history      │◄────────│  Obsync Plugin         │
 │ ├─ File Watcher       │         │  of all notes      │         │  ├─ File Watcher       │
 │ ├─ Sync Engine        │         └───────────────────┘          │  ├─ Sync Engine        │
 │ ├─ Auto Merge         │                                        │  ├─ Auto Merge         │
 │ └─ Status Bar         │                                        │  └─ Status Bar         │
 └──────────────────────┘                                         └──────────────────────┘
```

| Approach | Pros | Cons | Verdict |
|---|---|---|---|
| **Git (GitHub)** | Free, full history, built-in merge, diff/blame | Binary bloat, commit noise | **Chosen** |
| Google Cloud Storage | Handles large binaries well | No history/merge, costs money | Rejected |
| Direct P2P (WebSocket) | No cloud dependency | Both machines must be online | Rejected |
| Dropbox/Google Drive API | Familiar | Poor conflict handling, rate limits | Rejected |

**Why Git wins:**
1. Full version history for free — `git log`, `git diff` on any note
2. Zero cost — GitHub private repos are free
3. Simple — we only build watcher + auto-commit/push/pull logic
4. `isomorphic-git` provides pure JS implementation for Node.js

### Decision 3: Merge Strategy — Automatic with "Append Both" Default

**Chosen:** Automatic conflict resolution with a user-configurable strategy. No manual merge required.

| Strategy | Behavior | Data Loss Risk |
|---|---|---|
| **Append both** (default) | Concatenates both versions with a conflict separator and timestamp | None — both versions preserved |
| Last write wins | Most recent edit (by timestamp) overwrites | High — older edits lost |
| Device priority | One device always wins (e.g., Mac > Windows) | Medium — subordinate device edits lost |
| Longest content wins | Keeps the version with more content | Medium — shorter edits lost |

**Rationale:**
- "Append both" guarantees zero data loss — the user can clean up at leisure
- Standard Git conflict markers (`<<<<<<<`) are confusing for non-developers
- Fully automatic — no user intervention needed during sync

**Example: "Append both" conflict result:**

```markdown
# My Note
Content edited on Mac...

---
> ⚠️ SYNC CONFLICT (2026-02-28 14:30) — merged from: windows

# My Note
Content edited on Windows...
```

**For binary files** (images, PDFs): always last-write-wins (merge is not possible).

## Core Components

### 1. Plugin Entry Point (`main.ts`)

- Extends Obsidian's `Plugin` class
- Registers settings tab, commands, and status bar item
- Starts the file watcher and sync engine on plugin load
- Cleans up on plugin unload

### 2. File Watcher

- Uses Obsidian's `vault.on('modify')`, `vault.on('create')`, `vault.on('delete')` events
- Ignores files matching configured patterns (`.obsidian/workspace.json`, `.DS_Store`, etc.)
- Feeds change events to the debounce mechanism

### 3. Debounce Mechanism

- After a file change is detected, waits a configurable period (default 3s) before acting
- Batches rapid edits (e.g., auto-save) into a single commit
- Prevents commit storms during active editing
- Resets timer on each new change within the window

### 4. Sync Engine

#### Local change detected:

```
File changed locally
  → debounce (wait 3s for batch edits)
  → git add <changed files>
  → git commit "sync: update <files> from <device>"
  → git pull (fetch + merge)
  → if conflict → apply merge strategy automatically
  → git push origin main
```

#### Periodic remote check:

```
Every 30 seconds:
  → git fetch origin
  → if behind → git pull
  → if conflict → apply merge strategy automatically
  → update status bar
```

### 5. Automatic Conflict Resolver

- Detects conflicted files after a `git pull`
- Reads both versions (local and remote)
- Applies the user's chosen merge strategy:
  - **Append both:** concatenate with separator, timestamp, and device origin
  - **Last write wins:** keep the version with the later timestamp
  - **Device priority:** keep the version from the priority device
  - **Longest content wins:** keep the version with more characters
- Stages the resolved file and commits

### 6. Settings Tab

Obsidian-native settings panel:

| Setting | Default | Description |
|---|---|---|
| Remote URL | *(required)* | GitHub repo URL |
| Device Name | *(auto-detected)* | Identifies this machine in sync commits |
| Merge Strategy | Append both | How to resolve conflicts |
| Pull Interval | 30 seconds | How often to check for remote changes |
| Debounce Delay | 3 seconds | Wait time before committing after a change |
| Auto-sync on startup | true | Pull latest changes when Obsidian opens |
| Ignored patterns | `workspace.json`, `.DS_Store` | Files to exclude from sync |

### 7. Status Bar

Displays sync state in Obsidian's status bar:
- `✓ Synced` — all changes pushed, up to date
- `↑ Pushing...` — uploading local changes
- `↓ Pulling...` — downloading remote changes
- `⚠ Conflict resolved` — auto-merged, user may want to review
- `✗ Sync failed` — network error or auth issue

## Technology Stack

| Component | Technology | Rationale |
|---|---|---|
| Language | TypeScript | Required for Obsidian plugins |
| Runtime | Node.js (via Obsidian's Electron) | Built into Obsidian |
| Build | esbuild | Standard for Obsidian plugins, fast bundling |
| Git operations | isomorphic-git | Pure JS Git implementation, works in Node.js |
| HTTP transport | isomorphic-git + `http` module | For pushing/pulling over HTTPS |
| Auth | GitHub personal access token | Stored in plugin settings (encrypted) |
| File watching | Obsidian Vault events API | `vault.on('modify'/'create'/'delete')` |

## Project Structure

```
obsync/
├── docs/
│   └── ARCHITECTURE.md          # This document
├── src/
│   ├── main.ts                  # Plugin entry point
│   ├── settings.ts              # Settings tab UI + model
│   ├── sync/
│   │   ├── SyncEngine.ts        # Orchestrates commit/push/pull
│   │   ├── ConflictResolver.ts  # Automatic merge strategy handler
│   │   └── Debouncer.ts         # Batches rapid file changes
│   ├── git/
│   │   └── GitOperations.ts     # isomorphic-git wrapper
│   └── ui/
│       └── StatusBar.ts         # Status bar component
├── manifest.json                # Obsidian plugin manifest
├── package.json
├── tsconfig.json
├── esbuild.config.mjs
└── .gitignore
```

## Known Concerns & Mitigations

| Concern | Mitigation |
|---|---|
| Binary attachments bloat the Git repo | `.gitignore` large files or integrate Git LFS later |
| `.obsidian/workspace.json` changes constantly | Ignored by default — machine-specific UI state |
| Rapid edits create too many commits | Debounce batches changes within a configurable window |
| Push race condition between devices | Pull before push; retry on conflict with auto-merge |
| Network failures | Retry with exponential backoff; queue commits locally until connectivity returns |
| GitHub token security | Stored in Obsidian's plugin data (encrypted at rest by OS keychain) |
| `isomorphic-git` performance on large vaults | Incremental operations; only stage changed files, not full `git add .` |

## Future Enhancements

- **Selective sync** — choose which folders/notes to sync
- **Git LFS integration** — for vaults with many large attachments
- **Conflict review panel** — custom Obsidian view to browse and clean up appended conflicts
- **Encryption** — encrypt notes before pushing to GitHub for privacy
- **Multi-remote support** — sync to multiple Git providers for redundancy
- **Mobile companion** — Obsidian Mobile plugin variant using the same sync protocol
