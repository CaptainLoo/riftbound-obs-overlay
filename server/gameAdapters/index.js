import { DEFAULT_GAME_ID } from "../games.js";
import * as riftbound from "./riftboundAdapter.js";
import * as pokemon from "./pokemonAdapter.js";

const ADAPTERS = {
  riftbound,
  pokemon,
};

export function getGameAdapter(gameId = DEFAULT_GAME_ID) {
  return ADAPTERS[gameId] || ADAPTERS[DEFAULT_GAME_ID];
}

