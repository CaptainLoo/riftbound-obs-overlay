import {
  action,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
} from "@elgato/streamdeck";
import { apiGet, apiPost, type GameSettings, type PlayerSettings } from "../riftbound";
import { runKeyAction } from "../safeAction";

const BASE = { host: "127.0.0.1", port: 7474 };

function settings<T extends { host?: string; port?: number }>(s: T) {
  return { ...BASE, ...s };
}

@action({ UUID: "com.riftbound.obs.hideall" })
export class HideAll extends SingletonAction<{ host?: string; port?: number }> {
  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    await runKeyAction(ev, () => apiGet("/api/hot/clear", settings(ev.payload.settings)).then(() => undefined));
  }
}

@action({ UUID: "com.riftbound.obs.hideplayer" })
export class HidePlayer extends SingletonAction<PlayerSettings> {
  override async onKeyDown(ev: KeyDownEvent<PlayerSettings>): Promise<void> {
    const player = ev.payload.settings.player || "p1";
    await runKeyAction(ev, () =>
      apiGet(`/api/hot/clear/${player}`, settings(ev.payload.settings)).then(() => undefined)
    );
  }
}

@action({ UUID: "com.riftbound.obs.matchup" })
export class Matchup extends SingletonAction<{ host?: string; port?: number }> {
  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    await runKeyAction(ev, () => apiGet("/api/hot/matchup", settings(ev.payload.settings)).then(() => undefined));
  }
}

@action({ UUID: "com.riftbound.obs.resetmatch" })
export class ResetMatch extends SingletonAction<{ host?: string; port?: number }> {
  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    await runKeyAction(ev, () =>
      apiPost("/api/match/reset", settings(ev.payload.settings), {}).then(() => undefined)
    );
  }
}

@action({ UUID: "com.riftbound.obs.wingame" })
export class WinGame extends SingletonAction<PlayerSettings> {
  override async onKeyDown(ev: KeyDownEvent<PlayerSettings>): Promise<void> {
    const player = ev.payload.settings.player || "p1";
    await runKeyAction(ev, () =>
      apiGet(`/api/hot/win/${player}`, settings(ev.payload.settings)).then(() => undefined)
    );
  }
}

@action({ UUID: "com.riftbound.obs.game" })
export class SelectGame extends SingletonAction<GameSettings> {
  override async onWillAppear(ev: WillAppearEvent<GameSettings>): Promise<void> {
    if (!ev.action.isKey()) return;
    const idx = Number(ev.payload.settings.index ?? 0);
    await ev.action.setTitle(`Game ${idx + 1}`);
  }

  override async onKeyDown(ev: KeyDownEvent<GameSettings>): Promise<void> {
    const index = Number(ev.payload.settings.index ?? 0);
    await runKeyAction(ev, () =>
      apiPost("/api/match", settings(ev.payload.settings), { currentGame: index }).then(() => undefined)
    );
  }
}
