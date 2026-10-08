<h1 align="center">noted</h1>

<p align="center">
  A minimal desktop scratchpad for temporary notes, fast capture, and distraction-free writing.
</p>

<p align="center">
  <a href="https://github.com/khurrambhutto/noted/releases">Download</a>
  |
  <a href="https://khurrambhutto.github.io/noted/">Website</a>
  |
  <a href="#development">Build from source</a>
</p>

<p align="center">
  <img alt="noted desktop app showing the editor, settings panel, and dark theme" src="noted.png" width="100%" />
</p>

## Overview

noted is a small, native-feeling note app built with Tauri. It is designed for
short-lived notes, quick context switches, and a clean writing surface without a
full workspace wrapped around it.

The app keeps notes as plain text, supports swipe navigation between notes, and
stays lightweight enough to use as an always-available scratchpad.

## Features

- Plain-text notes backed by a local SQLite database.
- CodeMirror editor with native undo history and responsive editing.
- Swipe and keyboard navigation through a stack of notes.
- Linux global toggle shortcut through `noted-toggle` and DBus single-instance activation.
- Shortened link display inside the editor, with click-to-open behavior.
- Antinote-compatible JSON theme import with persisted theme files.
- Built-in updater support for signed release artifacts.
- Small Tauri desktop shell for Linux and Windows.

## Downloads

Installers are published on the
[GitHub Releases page](https://github.com/khurrambhutto/noted/releases).

| Platform | Artifact |
| --- | --- |
| Debian / Ubuntu | `.deb` |
| Fedora / RHEL | `.rpm` |
| Portable Linux | `.AppImage` |
| Windows | `.msi` |

Linux packages also install the `noted-toggle` helper used by desktop keyboard
shortcuts.

## Usage

Use noted as a temporary note stack:

- Write directly in the editor.
- Swipe left or right with two fingers to move between notes.
- Use the note indicator at the bottom to understand your position in the stack.
- Open settings to switch or import themes.
- Paste full URLs normally; noted will display long links in a compact form.

### Linux Global Shortcut

On supported Linux desktops, `Super+N` toggles the noted window.

GNOME and XFCE installs register the shortcut automatically when `noted-toggle`
is available on `PATH`. Other desktop environments can use the same setup:

1. Open your desktop keyboard shortcut settings.
2. Add a custom shortcut named `Noted Toggle`.
3. Set the command to `noted-toggle`.
4. Bind it to `Super+N`.

This is Wayland-friendly because the desktop environment owns the global
shortcut. The helper script only asks the running app to show or hide itself.

## Themes

noted supports Antinote-style JSON themes. Built-in themes are available by
default, and imported themes are saved as real JSON files in the app data
directory.

Theme compatibility details live in
[docs/antinote-theme-compatibility.md](docs/antinote-theme-compatibility.md).

## Development

### Requirements

- Node.js
- Rust
- Tauri v2 system dependencies

See the official
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for platform
packages.

### Setup

```bash
npm install
npm run build:frontend
npm run tauri -- dev
```

### Useful Commands

```bash
npm run build:frontend
npm run check:rust
npm run test:rust
npm run tauri -- build
```

## Tech Stack

- [Tauri 2](https://v2.tauri.app/) for the desktop shell.
- Vanilla HTML, CSS, and JavaScript for the app UI.
- [CodeMirror 6](https://codemirror.net/) for the editor.
- Rust commands for persistence, theme file handling, updater integration, and desktop behavior.
- SQLite for local note storage.

## Contributing

Issues and pull requests are welcome. For changes that affect runtime behavior,
please include focused validation notes in the PR description.

Before opening a PR, run the relevant checks:

```bash
npm run build:frontend
npm run check:rust
npm run test:rust
```

## Release Process

Releases are tag-driven. Do not hand-edit `latest.json` for a new release; it
contains updater signatures that must match the exact built artifacts. The
GitHub Actions release workflow builds installers, signs updater artifacts,
uploads them to the GitHub release, and generates the release `latest.json`.

Before tagging, bump the app version in source metadata and run:

```bash
npm run validate:release -- --version=v0.2.3
npm run build:frontend
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

Then publish:

```bash
git tag v0.2.3
git push origin main
git push origin v0.2.3
```

The repository must have these secrets configured for signed updater artifacts:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

## Roadmap

- [x] Swipe navigation
- [x] Plain-text storage
- [x] Global hotkey
- [x] Link shrink
- [ ] Checklists
- [ ] Screenshot to text
- [ ] AutoPaste
- [ ] Contextual math
- [ ] Conversions
- [ ] Reactive variables
- [ ] Timer
- [ ] One-click export

## License

noted is released under the [MIT License](LICENSE).
