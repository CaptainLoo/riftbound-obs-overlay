export const GAMES = [
  {
    id: "riftbound",
    name: "Riftbound",
    overlayPath: "/overlay",
    controlPath: "/control",
  },
  {
    id: "pokemon",
    name: "Pokémon TCG",
    overlayPath: "/overlay",
    controlPath: "/control",
  },
];

const GAME_MAP = new Map(GAMES.map((g) => [g.id, g]));

export function listGames() {
  return GAMES.map(({ id, name, overlayPath, controlPath }) => ({
    id,
    name,
    overlayPath,
    controlPath,
  }));
}

export function getGame(id) {
  return GAME_MAP.get(id) || null;
}

export function isValidGameId(id) {
  return GAME_MAP.has(id);
}

export const DEFAULT_GAME_ID = "riftbound";
