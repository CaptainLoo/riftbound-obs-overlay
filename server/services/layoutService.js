import { defaultLayoutForGame, getActiveGameId } from "../db.js";
import { activeGameData, persistAndBroadcast, scheduleBroadcast, scheduleWrite } from "./stateService.js";

export function getLayout() {
  return activeGameData().layout;
}

export async function resetLayout() {
  const gameData = activeGameData();
  gameData.layout = defaultLayoutForGame(getActiveGameId());
  await persistAndBroadcast(["layout"]);
  return gameData.layout;
}

export function updateLiveLayoutSlot(slot, props) {
  const gameData = activeGameData();
  if (slot && props && gameData.layout[slot]) {
    gameData.layout[slot] = { ...gameData.layout[slot], ...props };
    scheduleBroadcast("layout");
    scheduleWrite({ broadcast: false });
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
  await persistAndBroadcast(["layout"]);
  return gameData.layout;
}

