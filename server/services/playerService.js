import { PLAYER_IDS } from "../constants.js";
import { activeGameData } from "./stateService.js";

export function validatePlayerId(player) {
  return PLAYER_IDS.includes(player);
}

export function findPlayer(id) {
  return activeGameData().players.find((p) => p.id === id);
}

export function requirePlayer(id) {
  const player = findPlayer(id);
  if (!player) {
    throw Object.assign(new Error("unknown player"), { status: 404 });
  }
  return player;
}

