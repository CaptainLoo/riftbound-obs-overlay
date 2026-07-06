import test from "node:test";
import assert from "node:assert/strict";
import { parseLimitless } from "../server/pokemonDecklist.js";

test("parseLimitless groups pokemon trainer and energy", () => {
  const parsed = parseLimitless(`Pokémon: 2
4 Dreepy TWM 128

Trainer: 1
2 Ultra Ball MEG 131

Energy: 1
3 Psychic Energy MEE 5`);

  assert.equal(parsed.pokemon[0].quantity, 4);
  assert.equal(parsed.pokemon[0].name, "Dreepy");
  assert.equal(parsed.pokemon[0].setCode, "TWM");
  assert.equal(parsed.pokemon[0].localId, "128");
  assert.equal(parsed.trainer[0].name, "Ultra Ball");
  assert.equal(parsed.energy[0].name, "Psychic Energy");
});

