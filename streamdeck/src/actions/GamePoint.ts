import {
  action,
  DidReceiveSettingsEvent,
  KeyAction,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
} from "@elgato/streamdeck";
import { adjustGamePoint, fetchDeckProfile, type GamePointSettings } from "../riftbound";
import { runKeyAction } from "../safeAction";

@action({ UUID: "com.riftbound.obs.gamepoint" })
export class GamePoint extends SingletonAction<GamePointSettings> {
  override async onWillAppear(ev: WillAppearEvent<GamePointSettings>): Promise<void> {
    if (!ev.action.isKey()) return;
    await this.syncKey(ev.payload.settings, ev.action);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<GamePointSettings>): Promise<void> {
    if (!ev.action.isKey()) return;
    await this.syncKey(ev.payload.settings, ev.action);
  }

  override async onKeyDown(ev: KeyDownEvent<GamePointSettings>): Promise<void> {
    await runKeyAction(ev, async () => {
      await adjustGamePoint(ev.payload.settings);
      await this.syncKey(ev.payload.settings, ev.action);
    });
  }

  private async syncKey(settings: GamePointSettings, action: KeyAction) {
    const player = settings.player || "p1";
    const delta = Number(settings.delta) || 1;
    const sign = delta > 0 ? "+" : "−";
    const label = player === "p2" ? "P2" : "P1";
    let title = `${label} ${sign}${Math.abs(delta)}`;

    try {
      const profile = (await fetchDeckProfile(settings)) as {
        match?: { currentScore?: { p1?: number; p2?: number } };
      };
      const pts = profile.match?.currentScore?.[player];
      if (typeof pts === "number") title = `${label} ${sign} (${pts})`;
    } catch {
      /* offline */
    }

    await action.setTitle(title, { state: 0 });
  }
}
