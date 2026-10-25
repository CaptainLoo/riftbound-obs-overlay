# Riftbound OBS Overlay

Stream overlay for the **Riftbound** TCG, built for OBS Studio via a *Browser Source* and driven by a web control panel. A native **Stream Deck** integration and a Windows desktop app with in-app updates are included.

- Import both players' decklists (sectioned text or TTS / Piltover export)
- Automatic card and image resolution via the community [RiftScribe](https://riftscribe.gg) API (local cache)
- Card type detection (Legend, Battlefield, Unit, etc.)
- Bo1 / Bo3 / Bo5 match formats with per-player "Win game" buttons and match winner detection
- Per-game **points** score, kept independently for each game
- Per-game selection of each player's Battlefield and Champion Unit
- On-demand card display via a per-player dropdown, with 7 reveal animations
- Full-screen matchup / deck reveal screen
- Keyboard shortcuts + external control via Stream Deck / Companion (HTTP API)
- Fully configurable layout: every element (name, legend, battlefield, champion, score, card) is a block you can position on screen, with a live preview

## Requirements

- [Node.js](https://nodejs.org) 18 or newer (development and macOS)
- OBS Studio (the *Browser Source* ships by default on Windows and macOS)

## Install

```bash
npm install
```

## Run

```bash
npm start
```

The server starts on port `7474` (configurable via the `PORT` environment variable), bound to `127.0.0.1` only:

- Overlay (add this in OBS): `http://localhost:7474/overlay`
- Control panel: `http://localhost:7474/control`

Keep this window/terminal open while you stream.

### macOS (development and testing)

macOS is the development environment: `npm start` runs the server, `npm run dev:electron` opens the native control window, `npm test` runs the test suite. From v3.0 the Stream Deck also works on macOS in dev mode (quit the Elgato Stream Deck app first, then plug in the device and run `npm start`). In-app updates remain a Windows-only feature.

## Windows desktop app (no Node.js required)

Build the Windows Electron app (works from macOS for patch builds; full `.exe` is built on GitHub Actions):

```bash
npm run build:electron   # or npm run build:win
npm run dev:electron     # local dev with native control window (Mac or Windows)
```

Output:

- `dist/electron/win-unpacked/Riftbound OBS.exe` — portable folder
- `dist/electron/riftbound-setup-X.Y.Z.exe` — NSIS installer (Windows build)
- `dist/riftbound-obs-windows.zip` — zip of portable folder (alias `dist/win/`)

**On Windows:**

1. Install via **`riftbound-setup-X.Y.Z.exe`** or extract the portable zip.
2. Double-click **`Riftbound OBS`** — the control panel opens in a dedicated window (no terminal).
3. In OBS, add Browser Source: `http://localhost:7474/overlay`

Optional debug launchers in the install folder: `Start Riftbound.bat`, `Update Riftbound.bat`.

## Data & cache

| Environment | Location |
|---|---|
| Development (`npm start`) | `data/` in the project folder |
| Windows release | `%APPDATA%\RiftboundOBS\` |
| macOS release / Electron | `~/Library/Application Support/RiftboundOBS/` |

- `db.json` holds players, decks, match, display and layout.
- Card images are cached in `cards/` (served at `/cards/<file>`).
- Update downloads, logs and locks live in `updates/`.
- To start fresh, stop the server and delete `db.json` (and optionally `cards/`). User data is never overwritten by updates. Set `RIFTBOUND_DATA_DIR` to point the server at another data folder (used by the tests).

Databases written by v2.2 (multi-game layout) are migrated automatically on first start: the Riftbound data is kept, Pokémon leftovers are removed.

## Mac dev → Windows streaming (updates)

Develop on macOS, stream on Windows with **in-app updates** (light ~1 MB patch by default, full installer when needed).

### Recommended: Windows installer

1. Download **`riftbound-setup-X.Y.Z.exe`** from [GitHub Releases](https://github.com/CaptainLoo/riftbound-obs-overlay/releases).
2. Run the installer (per-user, no admin required).
3. Launch **Riftbound OBS** from the desktop shortcut or Start menu.
4. Updates use a **hybrid patch-first channel** on the Electron app: the ~1 MB patch zip is available **immediately** after each release (no need to wait for the CI-built `.exe`). The full installer is used only when `forceFull` is set (Electron runtime bump or native dependency changes).

### Legacy: portable zip (pre-Electron)

1. Extract **`riftbound-obs-windows.zip`** anywhere.
2. Run **`Riftbound OBS.exe`** (or `Start Riftbound.bat` on very old builds).
3. Migrate to the installer for the best update experience.

### One-time setup

1. GitHub repo is configured as **`CaptainLoo/riftbound-obs-overlay`** in `package.json`.
2. Log in to GitHub CLI once, then run the setup script:

```bash
gh auth login --web --git-protocol https --scopes repo,read:org
npm run setup:github          # creates repo, pushes code
npm run setup:github -- --release   # optional: first GitHub Release for auto-updates
```

### Daily workflow (Mac)

```bash
npm start              # test locally
npm run publish        # bump patch version, build, push GitHub Release
npm run publish:beta   # prerelease (x.y.0-beta.n), marked as prerelease on GitHub
```

`npm run publish` uploads immediately:

- `riftbound-obs-patch-X.Y.Z.zip`
- `update-manifest.json`

On Windows, it also uploads `riftbound-obs-windows.zip`. On macOS, CI builds the portable zip and installer after the tag push.

Then pushes git tag `vX.Y.Z` → CI attaches within a few minutes:

- `riftbound-setup-X.Y.Z.exe` (Windows NSIS installer)
- `riftbound-obs-windows.zip` (portable Electron build)
- updated `update-manifest.json` (with installer SHA256)

Options: `npm run publish -- minor`, `npm run publish -- --no-bump`, `npm run publish -- --notes="Fix overlay"`, `npm run publish -- --force-full` (require full installer — use when Electron or native deps change).

Build commands:

```bash
npm run build:patch       # patch zip only
npm run build:electron    # Electron portable + NSIS (Windows)
npm run build:win         # alias for build:electron
npm run dev:electron      # dev shell with native control window
```

GitHub Actions workflow **Release Installer** (`.github/workflows/release-installer.yml`) builds `riftbound-setup-X.Y.Z.exe` and the portable zip on Windows automatically when `npm run publish` pushes the release tag.

### On Windows (after first install)

1. Open the control panel (`http://localhost:7474/control`).
2. When an update is available, a banner appears at the top (or click **Check updates**; the version selector lets you pick a specific release, including betas).
3. Click **Download**, then **Install & restart**.
4. The panel waits until the new version is detected, then reloads.
5. Stream Deck keys refresh automatically after patch updates (Windows desktop app only).

If update fails, check `%APPDATA%\RiftboundOBS\updates\update.log` and relaunch **Riftbound OBS**.

### Windows QA checklist (before calling updates stable)

1. Fresh install via `riftbound-setup.exe` — overlay + control panel work.
2. Patch update vN → vN+1 — version header updates, decks preserved.
3. Stale patch ignored when a newer release exists.
4. Install & restart completes and reloads to the new version.
5. Double-click Install does not corrupt the install (apply lock).
6. Interrupted apply leaves the previous version intact (backup/rollback).
7. `forceFull` or Node version mismatch triggers installer download path.

## OBS integration

1. Start the server (`npm start`) or the desktop app.
2. In OBS, add a **Browser** source to your scene.
3. URL: `http://localhost:7474/overlay`
4. Width / Height: your canvas resolution (e.g. `1920` × `1080`). Since the layout is in percentages, it adapts to any resolution.
5. Optionally tick *Refresh browser when scene becomes active*.
6. For smooth matchup animations, set the Browser source to **60 FPS** (source properties → Custom frame rate).
7. (Optional) Add the control panel as a dock: menu **Docks → Custom Browser Docks**, URL `http://localhost:7474/control`.

The overlay has a transparent background: only the configured elements are shown. Animations only use `transform` and `opacity`, which keeps the OBS browser source cheap on CPU.

## Usage

### 1. "Players & Decks" tab

- Enter both players' **names**.
- Paste each player's **decklist**, in sectioned format:

  ```
  Legend:
  1 Pyke, Bloodharbor Ripper

  Champion:
  1 Pyke, Dockside Butcher

  MainDeck:
  3 Falling Star
  3 Gust
  ...

  Battlefields:
  1 Void Gate
  1 Forbidding Waste

  Runes:
  6 Fury Rune
  6 Chaos Rune

  Sideboard:
  2 Acceptable Losses
  ```

  Recognized headers (EN/FR, case-insensitive): `Legend` / `Légende`, `Champion`, `MainDeck` / `Deck principal`, `Battlefields`, `Runes`, `Sideboard` / `Side deck`. The Champion Unit declared in the `Champion` section feeds the per-game champion selector (Match tab).
- **Import format** (menu next to the Analyze button):
  - **Sectioned text**: the format above.
  - **TTS / Piltover**: a space-separated list of card ids (each copy repeated), as produced by the one-click "Tabletop Simulator" export on Piltover Archive. Cards are classified automatically by type (Legend, Battlefield, Rune, rest → main deck). Since the champion and sideboard can't be inferred from a flat list, you can adjust them afterwards.
- The Legend name is cleaned automatically (a legend listed as "Pyke, Bloodharbor Ripper" resolves to the `Bloodharbor Ripper` card).
- Click **Analyze**: every line is resolved via the API. Ambiguous cards (several printings/variants) are highlighted with a dropdown to pick the right one.
- Click **Save deck**: images are downloaded and cached locally.

### 2. "Match" tab

- Pick the **format** (Bo1 / Bo3 / Bo5): the number of games adjusts automatically.
- **Points are per game.** The ± steppers edit the **current game's points** for each player; each game keeps its own independent score. The overlay shows the current game's points.
- Click **Win game** for a player: it increments that player's **games-won** tally, detects the match winner (Bo3/Bo5), and moves to the **next game** (whose points start fresh at 0-0). The "Games won" line shows the match tally, and "Match over" appears when a player reaches the required number of game wins.
- Select the **current game** and, for each player, the **Battlefield** and **Champion Unit**: they show immediately in the overlay.
- **Reset match**: clears points, games won, current game and selections (keeps format, decks and names).
- **Display on screen**:
  - Per-player **"show a card"** menu: any card from the deck, shown on that player's side below their battlefield.
  - **Card animation** dropdown: choose how cards appear (`Fade`, `Slide`, `Pop`, `Flip`, `Arcane glow`, `Impact slam`, or `None`).
  - **Hide card** (next to each menu): hides only that player's on-demand card.
  - **Hide all cards**: clears both players' on-demand cards.
  - **Show matchup**: full-screen reveal with both players' name + legend + champion + battlefields.
  - **Hide / back to game** (shortcut `H` / `Esc`): same as hide all cards when in persistent mode; also exits matchup when shown.
- **Keyboard shortcuts** (when not typing): `←` / `→` previous/next game · `A` = P1 wins game · `P` = P2 wins game · `M` = matchup · `H` or `Esc` = hide.

### 3. "Layout" tab

- Drag and resize each block over the live overlay preview (16:9) to place it according to your overlay design.
- The right-hand panel offers fine tuning (position, size, font, color, alignment, visibility).
- Changes apply to the overlay in real time (no OBS reload needed).

## External control (Stream Deck)

### Native Stream Deck

1. **Quit the Elgato Stream Deck app** completely (tray icon → Quit) — only one program can use the device.
2. Launch **Riftbound OBS** (Windows desktop app, or `npm start` on macOS in dev mode) with your Stream Deck plugged in.
3. Import decks in the control panel — card keys and controls appear automatically.
4. Control panel → **Stream Deck** tab shows connection status and page info.

Supported devices: Stream Deck XL (32 keys, recommended), standard 15-key, Mini 6-key. Keys refresh when you change decks or match state. The HID device is driven from a separate worker process so a native crash can never take the app down.

### Manual / Companion (advanced)

Hot URLs (`GET /api/hot/...`) and POST endpoints remain available — see `GET /api/streamdeck` for the full list.

## Architecture

```
server/
  index.js            Entry point: Express + WebSocket + Stream Deck worker spawn
  db.js               JSON storage (lowdb), defaults, schema migrations
  paths.js            Data / content / install folders per environment
  hub.js              Overlay state and WebSocket broadcast (full state or per-section patches)
  deckCards.js        Deck-derived views (display cards, battlefields, overlay players)
  decklist.js         Decklist parsers (sectioned text, TTS) + RiftScribe name resolution
  riftscribe.js       RiftScribe API client + image cache
  routes/             HTTP API, one router per area (data, deck, match, display, layout, streamdeck, update)
  services/           Business logic behind the routes; stateService persists + broadcasts
  streamdeck*.js      Stream Deck: worker process, HID device, page layout, key rendering (sharp)
  update*.js, updater.js  Windows in-app update pipeline (patch zip or full installer)
public/
  overlay/            Overlay (Browser Source)
  control/            Control panel
  shared/             WebSocket client and layout math shared by both
electron/             Desktop shell (main process, preload, updater bootstrap)
scripts/              Build and release scripts
tests/                node:test suites
```

Data and image credits: [RiftScribe](https://riftscribe.gg). Riftbound is a trademark of Riot Games; this project is an unofficial community tool.
