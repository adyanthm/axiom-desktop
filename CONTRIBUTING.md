# Contributing to Axiom IDE

> **Repo:** [github.com/adyanthm/axiom-desktop](https://github.com/adyanthm/axiom-desktop.git)  
> **License:** [MIT](./LICENSE.md) — Axiom is 100% free and open-source software.

First off — **thank you.** Axiom IDE is an open-source project, and every issue filed, suggestion made, and PR opened genuinely makes it better. Contributions of all sizes are welcome.

This document covers everything you need to know to get from "I want to contribute" to "my PR is merged."

---

## Table of Contents

1. [Code of Conduct](#code-of-conduct)
2. [Architecture Overview](#architecture-overview)
3. [Project Structure](#project-structure)
4. [Setting Up the Dev Environment](#setting-up-the-dev-environment)
   - [Prerequisites](#prerequisites)
   - [Clone & Install](#clone--install)
   - [Running in Dev Mode](#running-in-dev-mode)
   - [Building for Production](#building-for-production)
5. [How to Contribute](#how-to-contribute)
   - [Reporting Bugs](#reporting-bugs)
   - [Suggesting Features](#suggesting-features)
   - [Submitting a Pull Request](#submitting-a-pull-request)
6. [Code Style & Conventions](#code-style--conventions)
   - [JavaScript](#javascript-mainjs)
   - [CSS](#css-stylecss)
   - [HTML](#html-indexhtml)
   - [Rust](#rust-src-taurisrc)
7. [Understanding the Codebase](#understanding-the-codebase)
   - [Frontend → Backend Communication](#frontend--backend-communication)
   - [Terminal Architecture](#terminal-architecture)
   - [Language Support System](#language-support-system)
   - [Emmet Integration](#emmet-integration)
   - [Visual Effects System](#visual-effects-system)
   - [Command Palette System](#command-palette-system)
   - [Keybindings System](#keybindings-system)
8. [Testing](#testing)
9. [Platform Compatibility](#platform-compatibility)
10. [Scope of the Project](#scope-of-the-project)

---

## Code of Conduct

Be respectful, constructive, and kind. Critique the code, not the person. That's it.

---

## Architecture Overview

Axiom is a **desktop application** built with:

```
┌───────────────────────────────────────────────────────────┐
│                     Axiom IDE                             │
│                                                           │
│  ┌──────────────────────┐     ┌──────────────────────────┐│
│  │   Frontend (JS)      │     │    Backend (Rust)         │
│  │                      │     │                           │  
│  │  • CodeMirror 6      │◄───►│  • File system (std::fs)  |  
│  │  • xterm.js          │ IPC │  • Terminal (portable-pty)│  
│  │  • Command Palette   │     │  • Native dialogs         │  
│  │  • File Explorer     │     │  • Persistent storage     │  
│  │  • Visual Effects    │     │  • Window state           │  
│  │  • Keybindings       │     │                           │  
│  └──────────────────────┘     └──────────────────────────┘│
│                                                           │
│                    Tauri 2 (Native Webview)               │
└───────────────────────────────────────────────────────────┘
```

- **Frontend:** Vanilla JavaScript, utilizing ES Modules. CodeMirror 6 for the editor, xterm.js for the terminal. All UI is constructed with standard DOM APIs, cleanly split into logical modules.
- **Backend:** Rust, compiled to a native binary. Handles file I/O, directory scanning, PTY terminal, and system integration via Tauri commands.
- **Communication:** Frontend calls Rust functions via Tauri's `invoke()` IPC. Backend sends data to frontend via Tauri's `emit()` event system (used for terminal output streaming).

---

## Project Structure

```
axiom/
├── index.html                 # Single-page app shell — all panels and overlays
├── src/
│   ├── main.js                # Minimal frontend entry point
│   ├── style.css              # All styles — pure CSS with custom variables
│   └── modules/               # Modularized frontend logic
│       ├── state.js           # Centralized global application state
│       ├── editor.js          # CodeMirror instances and theming
│       ├── terminal.js        # xterm.js integration and PTY sizing
│       ├── fs.js              # Native filesystem commands
│       ├── files.js           # File logic (open, save, drag-drop)
│       ├── explorer.js        # File tree rendering UI
│       ├── commands.js        # Fuzzy search and command execution
│       ├── runner.js          # File execution and Live Server logic
│       └── ...                # Other self-contained modules (tabs, etc)
├── src-tauri/
│   ├── Cargo.toml             # Rust dependencies
│   ├── tauri.conf.json        # Tauri app configuration
│   ├── src/
│   │   ├── main.rs            # Rust entry point
│   │   └── lib.rs             # All Rust backend logic (~220 lines)
│   │                          #   File ops, directory listing, terminal PTY,
│   │                          #   resize handling, process management
│   ├── icons/                 # App icons for all platforms
│   └── capabilities/          # Tauri permission capabilities
├── public/
│   └── logo.png               # App logo
├── media/                     # Demo GIFs and videos for README
├── package.json               # Frontend dependencies and scripts
├── CONTRIBUTING.md             # This file
├── README.md                  # Project documentation
└── LICENSE.md                 # MIT License
```

The frontend architecture has been heavily refactored from a monolithic script into a clean **ES Module** structure:
- **`src/modules/state.js`** is the single source of truth for all global variables.
- Circular dependencies are strictly avoided using dynamic `import()` where necessary.
- Rust logic remains tightly contained in `src-tauri/src/lib.rs`.

**Keep it modular.** When adding new features, isolate logic into specific modules to maintain the separation of concerns. Axiom's structural simplicity is a core feature, so avoid polluting global scopes.

---

## Setting Up the Dev Environment

### Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| **Node.js** | 18+ | For frontend tooling (Vite) |
| **Rust** | Latest stable | For the Tauri backend |
| **Tauri CLI** | Installed via npm | `@tauri-apps/cli` is a dev dependency |
| **OS-specific deps** | Varies | See [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) |

#### Platform-Specific Setup

<details>
<summary><strong>🪟 Windows</strong></summary>

1. Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the "Desktop development with C++" workload
2. Install [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (pre-installed on Windows 10 21H2+ and Windows 11)
3. Install [Rust](https://www.rust-lang.org/tools/install) via `rustup`

</details>

<details>
<summary><strong>🍎 macOS</strong></summary>

```bash
xcode-select --install
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

</details>

<details>
<summary><strong>🐧 Linux (Ubuntu/Debian)</strong></summary>

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

</details>

### Clone & Install

```bash
# 1. Fork the repository on GitHub, then clone your fork
git clone https://github.com/YOUR_USERNAME/axiom.git
cd axiom

# 2. Install frontend dependencies
npm install
```

### Running in Dev Mode

```bash
# Launch the full desktop app with hot-reload
npm run tauri dev
```

This will:
1. Start the Vite dev server on `http://localhost:5173`
2. Compile the Rust backend
3. Launch the native Axiom window

Changes to `src/main.js` and `src/style.css` hot-reload instantly. Changes to Rust files in `src-tauri/src/` trigger a recompile automatically.

#### Frontend-Only Mode (No Rust)

If you're only working on the frontend and don't want to compile Rust:

```bash
npm run dev
# Open http://localhost:5173 in Chrome or Edge
```

> ⚠️ **Note:** Terminal, native file system operations, and native dialogs will not work in browser-only mode. The editor will fall back to the browser's File System Access API where possible.

### Building for Production

```bash
# Build the native desktop binary
npm run tauri build

# Output:
#   Windows: src-tauri/target/release/axiom-editor.exe
#   macOS:   src-tauri/target/release/bundle/
#   Linux:   src-tauri/target/release/axiom-editor
```

---

## How to Contribute

### Reporting Bugs

Before opening a bug report:
- Check the existing [Issues](https://github.com/adyanthm/axiom-desktop/issues) to see if it's already reported
- Try reproducing in a clean state (close and reopen Axiom)

When opening a bug report, include:

| Field | Description |
|---|---|
| **Platform** | OS + version (e.g., Windows 11 23H2, macOS Sonoma 14.3, Ubuntu 24.04) |
| **Axiom Version** | Check `tauri.conf.json` → `version` or the app title bar |
| **Steps to Reproduce** | Be specific — numbered steps are ideal |
| **Expected vs Actual** | What should happen vs what actually happens |
| **Screenshots / Recordings** | Attach if the bug is visual |
| **Console Errors** | Open DevTools (`Ctrl+Shift+I`) and check for errors |

### Suggesting Features

Feature requests are welcome. Open an [Issue](https://github.com/adyanthm/axiom-desktop/issues) with the label `enhancement` and describe:

- **What** you want to add
- **Why** it fits Axiom's philosophy (fast, lightweight, no bloat)
- Any relevant prior art (how does VS Code or another editor handle it?)

> ⚠️ Features that add significant complexity, dependencies, or runtime overhead will be considered very carefully. Axiom's performance edge is its core value proposition — please keep that in mind.

### Submitting a Pull Request

#### 1. Open an Issue First

For anything non-trivial, [open an Issue](https://github.com/adyanthm/axiom-desktop/issues) first. This ensures your work aligns with the project direction before you invest time.

#### 2. Fork & Branch

```bash
git checkout -b feat/your-feature-name
# or
git checkout -b fix/bug-description
```

#### 3. Make Your Changes

Keep PRs focused — **one feature or fix per PR**. Avoid bundling unrelated cleanup.

#### 4. Test Manually

There is no automated test suite. Test your changes thoroughly:

- [ ] The change works as expected
- [ ] Existing features are not broken (file ops, tabs, keybindings, effects, terminal)
- [ ] The UI looks correct in both a folder-open and no-folder-open state
- [ ] If you changed Rust code: test that `npm run tauri dev` compiles without warnings
- [ ] If you touched the terminal: verify it spawns, accepts input, and resizes correctly

#### 5. Commit with a Clear Message

Use [conventional commits](https://www.conventionalcommits.org/):

```
feat: add minimap to editor area
fix: resolve zoom tracking drift on narrow viewports
style: tighten tab hover transition timing
docs: update keybindings table in README
refactor: extract terminal logic into separate module
perf: lazy-load language parsers on demand
```

#### 6. Open a Pull Request

Open a PR against the `main` branch. Include:

- **What** does this change?
- **Why** is this change needed?
- **How** was it tested?
- **Screenshots / GIFs** if the change is visual

---

## Code Style & Conventions

There is no linter or formatter configured. Follow the conventions already present in the codebase.

### JavaScript (`src/modules/*.js`)

- **No frameworks.** Vanilla JS, operating strictly via ES modules.
- **Global State:** All shared variables MUST live inside `export const state = {}` within `src/modules/state.js`. Never mutate global variables outside of this object.
- **Circular Dependencies:** Avoid circular imports by using dynamic `import('./file.js')` when required inside execution flows.
- **No TypeScript.** The project is intentionally plain JS for accessibility and simplicity.
- Use `const` and `let` — never `var`.
- Arrow functions for callbacks. Named functions (with `function` keyword) for top-level declarations.
- Tauri detection: Wrap native OS/backend calls in `if (IS_TAURI) { ... }` (exported from `state.js`) to ensure browser fallback compatibility.

**Example — Adding a new command:**
```javascript
// 1. Add to the commands array in src/modules/commands.js
const commands = [
  { id: 'your-command', label: 'Category: Your Command Description' },
  // ...
];

// 2. Handle it in execCmd() inside src/modules/commands.js
case 'your-command':
  doYourThing();
  break;

// 3. (Optional) Add a keyboard shortcut in the global listener inside src/modules/menubar.js
if (ctrl && alt && k === 'y') { 
    e.preventDefault(); 
    import('./commands.js').then(m => m.execCmd('your-command')); 
    return; 
}

// 4. (Optional) Add to the keybindings array for the settings panel in src/modules/keymap.js
{ id: 'your.command', command: 'Your Command', keys: 'Ctrl+Alt+Y', source: 'Default' },
```

### CSS (`style.css`)

- All colors and spacing tokens use **CSS custom properties** defined in `:root`. Don't hardcode hex values outside of `:root`.
- Section comments follow the pattern: `/* ── Section Name ── */`
- No CSS preprocessors. No utility classes. Styles are scoped and descriptive.
- Animations should be subtle and respect `prefers-reduced-motion` where possible.
- Use `var(--property-name)` for all colors — this ensures consistency and future theme support.

### HTML (`index.html`)

- All UI regions and overlay panels are declared here. JavaScript creates DOM elements only for dynamic content (tabs, file explorer rows, palette items).
- Use semantic elements where possible.
- IDs should be descriptive and `kebab-cased`.
- New UI panels should follow the existing overlay pattern (see `command-palette-overlay` or `keymap-overlay`).

### Rust (`src-tauri/src/`)

- All Tauri commands are defined in `lib.rs`.
- Commands use the `#[tauri::command]` attribute and return `Result<T, String>`.
- Error handling: use `.map_err(|e| format!("descriptive message: {}", e))`.
- State management: use `tauri::State<AppState>` for shared mutable state.
- Keep dependencies minimal — add a new crate only when there's no reasonable alternative.

**Example — Adding a new Tauri command:**

```rust
// 1. Define the command in lib.rs
#[tauri::command]
fn your_command(path: String) -> Result<String, String> {
    // Your logic here
    Ok("result".to_string())
}

// 2. Register it in the invoke_handler (in the run() function)
.invoke_handler(tauri::generate_handler![
    // ... existing commands ...
    your_command,
])

// 3. Call it from JavaScript
const result = await invoke('your_command', { path: '/some/path' });
```

---

## Understanding the Codebase

### Frontend → Backend Communication

Axiom uses Tauri's IPC system. The frontend calls Rust functions using `invoke()`:

```javascript
// Frontend (main.js)
import { invoke } from '@tauri-apps/api/core';

const content = await invoke('read_file_text', { path: '/path/to/file.py' });
```

```rust
// Backend (lib.rs)
#[tauri::command]
fn read_file_text(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Failed to read: {}", e))
}
```

**Available Tauri commands:**

| Command | Purpose | Parameters |
|---|---|---|
| `read_file_text` | Read file contents as string | `path: String` |
| `write_file_text` | Write string to file | `path: String, content: String` |
| `list_dir` | List directory contents | `path: String` |
| `create_file` | Create empty file | `path: String` |
| `create_dir` | Create directory (recursive) | `path: String` |
| `delete_item` | Delete file or directory | `path: String, recursive: bool` |
| `rename_item` | Rename/move a file or directory | `old_path: String, new_path: String` |
| `move_item` | Move item to another directory | `source: String, dest_dir: String` |
| `start_terminal` | Spawn a PTY terminal process | `cwd: Option<String>` |
| `terminal_input` | Send input to the terminal | `input: String` |
| `resize_terminal` | Resize the PTY | `rows: u16, cols: u16` |

### Terminal Architecture

The terminal is a two-part system:

1. **Backend (Rust):** `portable-pty` spawns a real PTY process. A reader thread continuously reads terminal output and emits it to the frontend via Tauri events. A writer is stored in `AppState` and receives input from the frontend.

2. **Frontend (JS):** `xterm.js` renders the terminal UI. User keystrokes are sent to the backend via `invoke('terminal_input', { input })`. Output arrives via `listen('terminal-output', callback)`.

```
User types → xterm.js onData → invoke('terminal_input') → Rust writer → PTY
PTY output → Rust reader thread → emit('terminal-output') → xterm.js write
```

### Language Support System

Languages are registered in `src/modules/languages.js`. Each entry maps a file extension to a lazy-loaded CodeMirror language package. Languages are split into two groups: plain languages (no Emmet) and Emmet-enabled languages:

```javascript
const languageRegistry = {
  // Plain (no Emmet)
  js:   () => import('@codemirror/lang-javascript').then(m => m.javascript()),
  py:   () => import('@codemirror/lang-python').then(m => m.python()),
  rs:   () => import('@codemirror/lang-rust').then(m => m.rust()),

  // Emmet-enabled (loads abbreviationTracker alongside the language)
  html: () => Promise.all([
    import('@codemirror/lang-html'),
    import('@emmetio/codemirror6-plugin'),
  ]).then(([m, e]) => [m.html(), e.abbreviationTracker({ syntax: 'html' })]),
  css:  () => Promise.all([ /* ... */ ]),
  // ... 17 total
};
```

**To add a new language:**
1. `npm install @codemirror/lang-yourlang`
2. Add an entry to `languageRegistry` in `languages.js`
   - If it's a markup/style language and should support Emmet, use `Promise.all` to also load `abbreviationTracker` from `@emmetio/codemirror6-plugin`
   - Add the extension to the `EMMET_EXTS` set in `src/modules/editor.js` so the Tab key activates Emmet
3. Add the file extension(s) to the icon map in `src/modules/icons.js`
4. Add the extension to the file open dialog filter in `src/modules/files.js`

---

### Emmet Integration

Emmet abbreviation expansion (`Tab` key) is powered by `@emmetio/codemirror6-plugin`. The integration has two parts:

**1. Per-language tracker** (`src/modules/languages.js`)  
For Emmet-enabled languages (HTML, CSS, SCSS, Less, JSX, TSX, Vue, PHP), each `languageRegistry` entry loads both the language extension and `abbreviationTracker()` from the plugin. The tracker provides the live visual underline and expansion preview as you type.

**2. Global Tab guard** (`src/modules/editor.js`)  
A custom `emmetExpand` function wraps `expandAbbreviation`. It checks the current file extension against `EMMET_EXTS`:
```javascript
const EMMET_EXTS = new Set(['html', 'htm', 'css', 'scss', 'less', 'jsx', 'tsx', 'vue', 'php']);

function emmetExpand(view) {
  const ext = state.currentFile?.split('.').pop()?.toLowerCase();
  if (!EMMET_EXTS.has(ext)) return false; // fall through to indentWithTab
  return expandAbbreviation(view);
}
```
This ensures `Tab` **only** triggers Emmet for supported file types. In Python, Rust, plain JS, and all other files, `Tab` indents as normal.

**To add Emmet support to a new language:**
1. Add `abbreviationTracker({ syntax: 'your-syntax' })` to its `languageRegistry` entry.
2. Add the extension to the `EMMET_EXTS` set in `editor.js`.

### Visual Effects System

Effects are toggled via CSS classes on `document.body`:
- `glow-effect` — Neon glow
- `rgb-glow-effect` — RGB cycling glow
- `rgb-text-effect` — Rainbow text
- `zoom-tracking-effect` + `zoom-active` — 300% zoom

All effect styles are defined in `style.css`. Effects are **mutually exclusive** — enabling one disables the others. This routing is handled inside `src/modules/effects.js`.

### Command Palette System

The palette has two modes:
- **Command mode** (input starts with `>`): Filters the `commands` array
- **File mode** (no `>` prefix): Fuzzy-searches all files in the project tree

Results are rendered dynamically and support keyboard navigation (Up/Down/Enter/Escape).

### Keybindings System

Keybindings are stored in the `keybindings` array. The settings panel renders them as an editable table. Users can click the pencil icon or double-click to enter edit mode, then press a new key combo to rebind.

Actual shortcut handling is done in the global `keydown` listener — it does **not** dynamically read from the `keybindings` array (the array is for display/editing in the settings panel). If you add a new shortcut, you need to add it in **both** places.

---

## Testing

Axiom does not currently have an automated test suite. All testing is manual.

### Manual Testing Checklist

When submitting a PR, verify the following still work:

**Core Editor:**
- [ ] Open a folder → files appear in the explorer
- [ ] Click a file → editor opens with syntax highlighting
- [ ] Edit → dirty indicator (●) appears on tab
- [ ] Save (`Ctrl+S`) → indicator clears
- [ ] Multiple tabs → switching preserves state
- [ ] Close tab (`Ctrl+W`) → prompts to save if dirty

**File Operations:**
- [ ] Create new file (via explorer toolbar, context menu, or `Ctrl+N`)
- [ ] Create new folder
- [ ] Rename file/folder (via context menu)
- [ ] Delete file/folder (via context menu or `Delete` key)
- [ ] Drag & drop files between folders

**Terminal:**
- [ ] Toggle terminal (`Ctrl+Shift+``)
- [ ] Type commands → output appears
- [ ] Resize terminal panel by dragging
- [ ] Run file (`F5`) → auto-saves and executes
- [ ] Close terminal (× button)

**Command Palette:**
- [ ] `Ctrl+Shift+P` → command mode works
- [ ] `Ctrl+P` → fuzzy file search works
- [ ] Arrow keys + Enter to select
- [ ] Escape to close

**Effects:**
- [ ] Each effect toggles independently
- [ ] Enabling one disables the others
- [ ] No performance degradation

**Emmet:**
- [ ] Open an `.html` file → type `div.wrapper>p*2` and press `Tab` → expands correctly
- [ ] Open a `.css` file → type `m10` and press `Tab` → expands to `margin: 10px;`
- [ ] Open a `.py` file → type `if` and press `Tab` → normal indentation (Emmet does NOT fire)

**Keybindings:**
- [ ] `Ctrl+K Ctrl+S` → settings panel opens
- [ ] Click pencil → edit mode activates
- [ ] Press new combo → binding updates
- [ ] Search filter works

---

## Platform Compatibility

Axiom targets **all major desktop platforms**:

| Platform | Shell | Status |
|---|---|---|
| **Windows 10/11** | PowerShell | ✅ Fully supported |
| **macOS** | Default `$SHELL` (zsh/bash) | ✅ Fully supported |
| **Linux** | Default `$SHELL` (bash/zsh/fish) | ✅ Fully supported |

**Important notes:**
- The terminal spawns the platform-appropriate shell automatically
- File path handling uses platform-aware separators (`\` on Windows, `/` elsewhere)
- Test your changes on your platform and note which platform you tested on in your PR

---

## Scope of the Project

### ✅ Planned & Welcome

These are things actively on the roadmap. PRs in these areas are especially encouraged:

- **Language Server Protocol (LSP)** — planned, contributions welcome
- **More language support** — add new CodeMirror language packages
- **Multiple terminal tabs** — planned
- **Split editor views** — planned
- **Minimap** — planned
- Performance improvements
- New visual effects (following the existing pattern)
- UI polish and accessibility improvements
- Better file type detection and icons
- Breadcrumb navigation improvements
- Bug fixes in file system operations
- Documentation improvements

### ❌ Out of Scope

The following are unlikely to be accepted as they conflict with the project's core philosophy of being lean and fast:

- Extension / plugin marketplace
- Cloud sync or remote editing
- Git integration (at least for now)
- Telemetry or analytics of any kind
- React, Vue, Angular, or any frontend framework
- Electron migration

When in doubt, [open an Issue](https://github.com/adyanthm/axiom-desktop/issues) and ask. It's much better to align upfront than to put in effort on something that won't be merged.

---

## 🙏 Thank You

Every contribution makes Axiom faster, more stable, and more useful. Whether you're fixing a typo in the docs or adding a major feature — **it matters.**

If you have questions, open a [Discussion](https://github.com/adyanthm/axiom-desktop/discussions) or an [Issue](https://github.com/adyanthm/axiom-desktop/issues). We're happy to help.

---

<div align="center">

**Happy coding. ⚡**

</div>
