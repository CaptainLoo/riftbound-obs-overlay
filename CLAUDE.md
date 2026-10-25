# Riftbound OBS Overlay

Overlay OBS pour le TCG Riftbound : serveur Node (Express + WebSocket), panneau de contrôle web, overlay pour Browser Source, contrôle natif d'un Stream Deck Elgato, application Windows Electron avec mises à jour intégrées. Produit **mono-jeu** (Riftbound uniquement).

## Commandes

```bash
npm start              # serveur sur http://localhost:7474 (overlay: /overlay, panneau: /control)
npm run dev            # idem avec --watch
npm run dev:electron   # coquille Electron en dev (Mac ou Windows)
npm test               # node --test tests/*.test.mjs
npx knip               # code mort (exports, fichiers, dépendances)
npm run build:patch    # zip de patch (~1 Mo) pour la mise à jour intégrée
npm run build:electron # build Windows complet (portable + NSIS), normalement en CI
npm run publish        # bump + release GitHub (voir README)
```

## Architecture

- `server/index.js` démarre Express, le WebSocket (`hub.js`) et le worker Stream Deck.
- `server/db.js` : base lowdb (un fichier JSON plat `{ cardsCache, players, match, display, layout }`) et migrations défensives.
- `server/routes/*` (HTTP) appellent `server/services/*` (logique) ; l'état est diffusé par sections (`players`, `match`, `game`, `display`, `layout`) via `hub.broadcastPatch`.
- `server/riftscribe.js` : API RiftScribe + cache d'images dans `data/cards/`.
- `server/streamdeck*.js` : le HID tourne dans un processus enfant (`streamdeckWorker.js`), qui ne doit **jamais** importer `db.js` ; il reçoit un modèle du serveur et rend les touches avec sharp.
- `server/update*.js`, `updater.js` : mises à jour Windows (patch zip ou installeur), voir README.
- `public/overlay` (Browser Source), `public/control` (panneau), `public/shared` (client WS, maths de layout). ES modules servis tels quels : pas de bundler, pas de framework.
- Données utilisateur : `data/` en dev, `%APPDATA%\RiftboundOBS` ou `~/Library/Application Support/RiftboundOBS` en release.

## Conventions

- ESM partout (`"type": "module"`), Node 18+, pas de TypeScript.
- Toute mutation d'état passe par le service concerné puis `stateService` (diffusion immédiate, écriture disque débouncée). Pas de `db.write()` direct ailleurs.
- Routes `GET /api/hot/*` : mutantes par conception (Stream Deck, Companion), serveur lié à 127.0.0.1 uniquement.
- Overlay : animer uniquement `transform` et `opacity`, aucun timer au repos (CEF d'OBS est sensible au CPU).
- Journal de démarrage : `logStartup()` (préfixe rôle + ms depuis le lancement) dans `startup.log`.
- Tests : `node:test`, fichiers `tests/*.test.mjs`, `RIFTBOUND_DATA_DIR` pour isoler les données.
