import { defaultLayout } from "../db.js";
import { activeGameData, commit } from "./stateService.js";

export function getLayout() {
  return activeGameData().layout;
}

export async function resetLayout() {
  const gameData = activeGameData();
  gameData.layout = defaultLayout();
  commit(["layout"]);
  return gameData.layout;
}

export function updateLiveLayoutSlot(slot, props) {
  const gameData = activeGameData();
  if (slot && props && gameData.layout[slot]) {
    gameData.layout[slot] = { ...gameData.layout[slot], ...props };
    commit(["layout"]);
  }
  return gameData.layout;
}

export async function saveLayout({ slot, props, layout } = {}) {
  const gameData = activeGameData();
  if (layout && typeof layout === "object") {
    gameData.layout = layout;
  } else if (slot && props && gameData.layout[slot]) {
    gameData.layout[slot] = { ...gameData.layout[slot], ...props };
  } else {
    throw Object.assign(new Error("provide either {layout} or {slot, props}"), { status: 400 });
  }
  commit(["layout"]);
  return gameData.layout;
}
