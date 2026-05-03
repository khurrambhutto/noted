# noted

A minimal, distraction-free note-taking app built with [Tauri](https://v2.tauri.app/).

## Features

- Clean, minimal editor — just you and your words
- Slide navigation between notes (trackpad gestures or keyboard shortcuts)
- Custom themes compatible with Antinote JSON format
- Lightweight — a single native window, no bloat

## Navigation

Swipe left or right with two fingers on the trackpad to move between notes. The active note indicator at the bottom shows your position in the stack.

## Install

### Linux

**Debian/Ubuntu (.deb):**

```bash
sudo dpkg -i noted_0.1.0_amd64.deb
```

**Fedora/RHEL (.rpm):**

```bash
sudo rpm -i noted-0.1.0-1.x86_64.rpm
```

**AppImage:**

```bash
chmod +x noted_0.1.0_amd64.AppImage
./noted_0.1.0_amd64.AppImage
```

### Windows

Run the `.msi` installer from the latest release.

## Build from Source

### Prerequisites

- [Rust](https://rustup.rs/)
- Node.js
- Tauri system dependencies — see [Tauri docs](https://v2.tauri.app/start/prerequisites/)

### Commands

```bash
npm install
npx tauri dev    # run in development mode
npx tauri build  # build for distribution
```

## Themes

noted uses Antinote-compatible theme JSON files. Import themes from the settings panel.

## Tech Stack

- [Tauri](https://v2.tauri.app/) — native desktop shell
- Vanilla HTML/CSS/JS — no framework overhead
- [Antinote](https://antinote.app/) — theme format compatible
