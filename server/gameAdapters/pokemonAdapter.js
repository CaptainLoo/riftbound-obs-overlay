export function makePlayer(id) {
  return {
    id,
    pseudo: "",
    deck: {
      pokemon: [],
      trainer: [],
      energy: [],
    },
  };
}

export function normalizeDeck(input = {}) {
  const norm = (arr) =>
    (Array.isArray(arr) ? arr : [])
      .map((e) => (typeof e === "string" ? { id: e, quantity: 1 } : e))
      .filter((e) => e && e.id)
      .map((e) => ({ id: e.id, quantity: Number(e.quantity) || 1 }));

  return {
    pokemon: norm(input.pokemon),
    trainer: norm(input.trainer),
    energy: norm(input.energy),
  };
}

export function deckCardIds(deck = {}) {
  return [
    ...(deck.pokemon || []).map((e) => e.id),
    ...(deck.trainer || []).map((e) => e.id),
    ...(deck.energy || []).map((e) => e.id),
  ].filter(Boolean);
}

export function displayCardEntries(deck = {}, cardsCache = {}) {
  const entries = [];
  const seen = new Set();
  const add = (group, id, quantity = 1) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    const name = cardsCache[id]?.name || id;
    const label = quantity > 1 ? `${name} ×${quantity}` : name;
    entries.push({ index: entries.length, id, name, group, quantity, label });
  };

  for (const e of deck.pokemon || []) add("Pokémon", e.id, Number(e.quantity) || 1);
  for (const e of deck.trainer || []) add("Trainer", e.id, Number(e.quantity) || 1);
  for (const e of deck.energy || []) add("Energy", e.id, Number(e.quantity) || 1);

  return entries;
}

export function playerBattlefields() {
  return [];
}

export function buildOverlayPlayers(players = []) {
  return players.map((p) => ({
    id: p.id,
    pseudo: p.pseudo,
    legend: null,
    champion: null,
    battlefields: [],
  }));
}

export function ensurePlayerDeck(player) {
  player.deck ||= {};
  if (!Array.isArray(player.deck.pokemon)) {
    player.deck = { pokemon: [], trainer: [], energy: [] };
  } else {
    player.deck.pokemon ||= [];
    player.deck.trainer ||= [];
    player.deck.energy ||= [];
  }
}

