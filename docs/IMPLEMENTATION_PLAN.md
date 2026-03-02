# Obsync — Implementation Plan

Step-by-step breakdown for building the Obsidian sync plugin. Each phase is self-contained and builds on the previous one.

---

## Phase 1: Project Setup & Hello World Plugin

**Goal:** Replace Java project with a working Obsidian plugin that loads and shows "Obsync" in the status bar.

**What you'll learn:** TypeScript basics, Obsidian plugin structure, npm/esbuild tooling.

### Tasks:
1. Remove Java project files (`pom.xml`, `src/main/java/`)
2. Initialize npm project (`package.json`)
3. Set up TypeScript config (`tsconfig.json`)
4. Set up esbuild bundler (`esbuild.config.mjs`)
5. Create Obsidian plugin manifest (`manifest.json`)
6. Write `src/main.ts` — minimal plugin that:
   - Loads and unloads cleanly
   - Adds a status bar item showing "Obsync: Ready"
   - Logs to console on load
7. Build and test in Obsidian

**Key TS concepts:** `class`, `extends`, `async/await`, `import/export`, type annotations.

---

## Phase 2: Settings Tab

**Goal:** Add a settings panel where the user configures remote URL, device name, merge strategy, etc.

**What you'll learn:** Obsidian Settings API, TypeScript interfaces, enums, data persistence.

### Tasks:
1. Define `ObsyncSettings` interface with all config fields
2. Create `src/settings.ts` — settings tab with input fields for:
   - Remote URL (text)
   - GitHub token (password field)
   - Device name (text, auto-detected default)
   - Merge strategy (dropdown: Append both / Last write wins / Device priority / Longest content)
   - Pull interval (number, seconds)
   - Debounce delay (number, seconds)
   - Ignored file patterns (text list)
3. Load/save settings using Obsidian's `loadData()`/`saveData()`
4. Register the settings tab in `main.ts`

**Key TS concepts:** `interface`, `enum`, optional properties (`?`), default values, generics (`PluginSettingTab`).

---

## Phase 3: Git Operations Layer

**Goal:** Wrap `isomorphic-git` into a clean API for init, add, commit, push, pull.

**What you'll learn:** Promises, async/await, error handling, third-party npm packages.

### Tasks:
1. Install `isomorphic-git` package
2. Create `src/git/GitOperations.ts` with methods:
   - `init()` — initialize git repo in vault if not already
   - `clone()` — clone remote repo into vault (first-time setup)
   - `status()` — get list of changed/staged files
   - `add(filepath)` — stage a file
   - `commit(message)` — create a commit
   - `push()` — push to remote
   - `pull()` — fetch + merge from remote
   - `getLog()` — retrieve commit history
3. Add a test command in the command palette: "Obsync: Test Git" that runs init + status
4. Handle auth with GitHub personal access token from settings

**Key TS concepts:** `async/await`, `try/catch`, class methods, `Promise<T>`, module imports.

---

## Phase 4: File Watcher & Debouncer

**Goal:** Detect file changes in the vault and batch them for syncing.

**What you'll learn:** Event-driven programming, timers, callbacks, Set/Map collections.

### Tasks:
1. Create `src/sync/Debouncer.ts`:
   - Collects file change events
   - Waits N seconds of inactivity before firing
   - Returns the set of changed file paths
2. Create `src/sync/FileWatcher.ts`:
   - Hooks into Obsidian's vault events (`modify`, `create`, `delete`, `rename`)
   - Filters out ignored files (from settings)
   - Feeds events into the Debouncer
3. Wire up in `main.ts`: log detected changes to console

**Key TS concepts:** `setTimeout`/`clearTimeout`, callbacks, `Set<string>`, arrow functions, event listeners.

---

## Phase 5: Sync Engine (Core Logic)

**Goal:** Orchestrate the full sync cycle: detect → commit → pull → push.

**What you'll learn:** State machines, orchestrating async operations, error recovery.

### Tasks:
1. Create `src/sync/SyncEngine.ts`:
   - `syncLocal()` — called by debouncer: add → commit → pull → push
   - `syncRemote()` — called by timer: fetch → pull if behind
   - `startPeriodicSync()` — interval timer for remote checks
   - `stopSync()` — cleanup on plugin unload
   - Sync lock to prevent concurrent sync operations
2. Update status bar during each phase (Pushing... / Pulling... / Synced / Error)
3. Handle network errors with retry logic
4. Wire everything together in `main.ts`

**Key TS concepts:** `setInterval`, mutex/lock pattern, state management, `enum` for sync states.

---

## Phase 6: Conflict Resolver

**Goal:** Automatically resolve merge conflicts using the chosen strategy.

**What you'll learn:** String manipulation, file I/O, strategy pattern.

### Tasks:
1. Create `src/sync/ConflictResolver.ts`:
   - Detect conflicted files after pull (scan for conflict markers or check git status)
   - Implement each strategy:
     - **Append both:** read both versions, concatenate with separator + timestamp + device name
     - **Last write wins:** compare timestamps, keep newer
     - **Device priority:** check device name, keep priority device's version
     - **Longest content wins:** compare content length, keep longer
   - Stage resolved files and commit
2. Add Obsidian notice (toast notification) when a conflict is auto-resolved
3. Test with a manually created conflict

**Key TS concepts:** Strategy pattern (function map or switch), string parsing, `Date`, template literals.

---

## Phase 7: Status Bar UI & Commands

**Goal:** Polish the user experience with status indicators and command palette actions.

**What you'll learn:** Obsidian UI APIs, DOM manipulation basics.

### Tasks:
1. Create `src/ui/StatusBar.ts`:
   - Show sync state with icons: ✓ Synced, ↑ Pushing, ↓ Pulling, ⚠ Conflict, ✗ Error
   - Show last sync time
   - Click to trigger manual sync
2. Register command palette commands:
   - "Obsync: Sync now" — trigger immediate sync
   - "Obsync: View sync history" — show recent git log in a modal
   - "Obsync: Pause/Resume sync" — toggle auto-sync
3. Add ribbon icon (sidebar) for quick sync access

**Key TS concepts:** DOM APIs (`HTMLElement`), Obsidian `Modal` class, command registration.

---

## Phase 8: Testing & Hardening

**Goal:** Make the plugin robust for daily use.

### Tasks:
1. Test scenarios:
   - Normal sync (edit on one machine, pull on the other)
   - Simultaneous edits (conflict resolution)
   - Large files / many files changed at once
   - Network disconnection during sync
   - First-time setup (empty vault vs existing vault)
2. Add `.gitignore` template for the vault repo
3. Handle edge cases:
   - Empty commits (no actual changes)
   - Binary file conflicts
   - File renames/moves
   - Very long file paths (Windows limit)
4. Add error notifications for common issues (auth failed, network down, etc.)

---

## Phase Summary

| Phase | What You Build | Key TS Skills |
|---|---|---|
| 1 | Hello World plugin | Classes, imports, async/await |
| 2 | Settings panel | Interfaces, enums, data persistence |
| 3 | Git operations | Promises, error handling, npm packages |
| 4 | File watcher | Events, timers, collections |
| 5 | Sync engine | State management, async orchestration |
| 6 | Conflict resolver | String manipulation, strategy pattern |
| 7 | UI polish | DOM, modals, commands |
| 8 | Testing | Edge cases, error handling |

Each phase produces a working, testable result. You can install and try the plugin after every phase.
