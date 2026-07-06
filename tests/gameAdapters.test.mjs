import test from "node:test";
import assert from "node:assert/strict";
import { getGameAdapter } from "../server/gameAdapters/index.js";

test("pokemon adapter normalizes deck and display cards", () => {
  const adapter = getGameAdapter("pokemon");
  const deck = adapter.normalizeDeck({
    pokemon: [{ id: "sv06-128", quantity: 4 }],
    trainer: ["me01-119"],
    energy: [{ id: "mee-005", quantity: 3 }],
  });

  assert.deepEqual(adapter.deckCardIds(deck), ["sv06-128", "me01-119", "mee-005"]);
  assert.deepEqual(
    adapter.displayCardEntries(deck, {
      "sv06-128": { name: "Dreepy" },
      "me01-119": { name: "Lillie's Determination" },
      "mee-005": { name: "Psychic Energy" },
    }).map((e) => [e.group, e.label]),
    [
      ["Pokémon", "Dreepy ×4"],
      ["Trainer", "Lillie's Determination"],
      ["Energy", "Psychic Energy ×3"],
    ]
  );
});

test("riftbound adapter normalizes deck and display cards", () => {
  const adapter = getGameAdapter("riftbound");
  const deck = adapter.normalizeDeck({
    legend: "sfd-197-221",
    champions: [{ id: "champion-1" }],
    maindeck: [{ id: "card-1", quantity: 2 }],
    sideboard: ["side-1"],
  });

  assert.deepEqual(adapter.deckCardIds(deck), ["sfd-197-221", "champion-1", "card-1", "side-1"]);
  assert.deepEqual(
    adapter.displayCardEntries(deck, {
      "sfd-197-221": { name: "Emperor" },
      "champion-1": { name: "Champion" },
      "card-1": { name: "Main Card" },
      "side-1": { name: "Side Card" },
    }).map((e) => [e.group, e.label]),
    [
      ["Legend", "Emperor"],
      ["Champion", "Champion"],
      ["Main deck", "Main Card ×2"],
      ["Side deck", "Side Card"],
    ]
  );
});

