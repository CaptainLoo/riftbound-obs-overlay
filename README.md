# Riftbound OBS Overlay

Stream overlay for the **Riftbound** TCG, built for OBS Studio via a *Browser Source* and driven by a web control panel.

- Import both players' decklists (sectioned text list)
- Automatic card and image resolution via the community [RiftScribe](https://riftscribe.gg) API (local cache)
- Card type detection (Legend, Battlefield, Unit, etc.)
- Bo1 / Bo3 / Bo5 match formats with per-player "Win game" buttons and match winner detection
- Per-game **points** score, kept independently for each game
- Per-game selection of each player's Battlefield and Champion Unit
- On-demand card display via a per-player dropdown
- Full-screen matchup / deck reveal screen
- Decklist import as sectioned text or TTS / Piltover
- Keyboard shortcuts + external control via Stream Deck / Companion (HTTP API)
- Fully configurable layout: every element (name, legend, battlefield, champion, score, card) is a block you can position on screen

## Requirements

- [Node.js](https://nodejs.org) 18 or newer (tested on Node 25)
- OBS Studio (the *Browser Source* ships by default on Windows and macOS)

## Install

```bash
npm install
```

## Run

```bash
npm start
```

The server starts on port `7474` (configurable via the `PORT` environment variable):

- Overlay (add this in OBS): `http://localhost:7474/overlay`
- Control panel: `http://localhost:7474/control`

Keep this window/terminal open while you stream.

## Windows executable (no Node.js required)

Build a portable Windows package (works from macOS or Windows):

```bash
npm run build:win
```

Output:

- `dist/riftbound-obs-windows.zip` (~32 MB) — share this with Windows users
- `dist/win/` — unzipped release folder

**On Windows:**

1. Extract the zip anywhere.
2. Double-click **`Start Riftbound.bat`**.
3. The control panel opens in the browser; add `http://localhost:7474/overlay` in OBS.

Data (decks, layout, cached images) is stored in `%APPDATA%\RiftboundOBS\`.

## Mac dev → Windows streaming (updates)

Develop on macOS, stream on Windows with **in-app updates** (~1 MB patch, not the full zip).

### One-time setup

1. Create a GitHub repo and set `package.json` → `riftbound.updateRepo` to `yourname/riftbound-obs-overlay`.
2. Install [GitHub CLI](https://cli.github.com/) on your Mac: `gh auth login`.
3. On the Windows PC: extract **`riftbound-obs-windows.zip`** once (full install ~34 MB).

### Daily workflow (Mac)

```bash
npm start              # test locally
npm run publish        # bump patch version, build, push GitHub Release
```

`npm run publish` uploads:

- `riftbound-obs-patch-X.Y.Z.zip` — incremental update (~1 MB)
- `riftbound-obs-windows.zip` — full install for new machines
- `update-manifest.json` — version + SHA256 for the updater

Options: `npm run publish -- minor`, `npm run publish -- --no-bump`, `npm run publish -- --notes="Fix overlay"`.

### On Windows (after first install)

1. Open the control panel (`http://localhost:7474/control`).
2. When an update is available, a banner appears at the top.
3. Click **Download**, then **Install & restart**.
4. The Stream Deck plugin is updated automatically; restart Stream Deck if keys behave oddly.

Your decks and layout in `%APPDATA%\RiftboundOBS\` are never overwritten.

### Manual builds (without publishing)

```bash
npm run build:patch    # dist/riftbound-obs-patch-VERSION.zip only
npm run build:win      # full portable zip
```

A GitHub Actions workflow (`.github/workflows/build-win.yml`) also builds the zip automatically on tagged releases or manual dispatch.

## OBS integration

1. Start the server (`npm start`).
2. In OBS, add a **Browser** source to your scene.
3. URL: `http://localhost:7474/overlay`
4. Width / Height: your canvas resolution (e.g. `1920` × `1080`). Since the layout is in percentages, it adapts to any resolution.
5. Optionally tick *Refresh browser when scene becomes active*.
6. (Optional) Add the control panel as a dock: menu **Docks → Custom Browser Docks**, URL `http://localhost:7474/control`.

The overlay has a transparent background: only the configured elements are shown.

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

- Drag and resize each block on the preview (16:9) to place it according to your overlay design.
- The right-hand panel offers fine tuning (position, size, font, color, alignment, visibility).
- Changes apply to the overlay in real time (no OBS reload needed).

## External control (Stream Deck)

### Ready-to-use setup (recommended)

1. Start Riftbound (`npm start` or `Start Riftbound.bat`).
2. **Install the plugin once:** `npm run install:streamdeck` — then restart the Stream Deck app.
3. Control panel → **Stream Deck** tab → choose your device → **Download profile**.
4. Double-click `Riftbound-OBS.streamDeckProfile` to import.

The profile is generated from your current decks: every card is a button with its art, plus controls (matchup, hide, win game, game 1/2/3). **Re-download the profile** after changing decks — no URLs to configure.

Supported devices: Stream Deck XL (32 keys, recommended), standard 15-key, Mini 6-key.

### Manual / Companion (advanced)

Hot URLs and POST endpoints remain available — see `GET /api/streamdeck` for the full list.

## Data & cache

- All data (players, decks, match, layout) is stored in `data/db.json`.
- Card images are cached in `data/cards/`.
- To start fresh, stop the server and delete `data/db.json` (and optionally `data/cards/`).

## Architecture

```
server/        Node server (Express + WebSocket)
  index.js     Entry point
  db.js        JSON storage (lowdb) + defaults
  riftscribe.js RiftScribe API client + image cache
  decklist.js  Decklist parser + name resolution
  hub.js       Real-time state broadcast (WebSocket)
  routes.js    REST API
public/
  overlay/     Overlay (Browser Source)
  control/     Control panel
  shared/      Shared WebSocket client
data/          Local database + cached images (created on start)
```

Data and image credits: [RiftScribe](https://riftscribe.gg). Riftbound is a trademark of Riot Games; this project is an unofficial community tool.
