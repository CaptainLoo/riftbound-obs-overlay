import {
  action,
  DidReceiveSettingsEvent,
  KeyAction,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
} from "@elgato/streamdeck";
import {
  fetchDeckProfile,
  loadCardImage,
  setBattlefield,
  type BattlefieldSettings,
} from "../riftbound";
import { runKeyAction } from "../safeAction";

@action({ UUID: "com.riftbound.obs.battlefield" })
export class SetBattlefield extends SingletonAction<BattlefieldSettings> {
  override async onWillAppear(ev: WillAppearEvent<BattlefieldSettings>): Promise<void> {
    if (!ev.action.isKey()) return;
    await this.syncKey(ev.payload.settings, ev.action);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<BattlefieldSettings>): Promise<void> {
    if (!ev.action.isKey()) return;
    await this.syncKey(ev.payload.settings, ev.action);
  }

  override async onKeyDown(ev: KeyDownEvent<BattlefieldSettings>): Promise<void> {
    await runKeyAction(ev, async () => {
      await setBattlefield(ev.payload.settings);
      await this.syncKey(ev.payload.settings, ev.action);
    });
  }

  private async syncKey(settings: BattlefieldSettings, action: KeyAction) {
    const player = settings.player || "p1";
    const cardId = settings.cardId;
    let title = settings.label || (cardId ? "BF" : "Battlefield");

    try {
      const profile = (await fetchDeckProfile(settings)) as {
        players?: {
          id: string;
          battlefields?: { id: string; name?: string; label?: string }[];
        }[];
        match?: { currentGame: number; games: { battlefield: { p1?: string; p2?: string } }[] };
      };
      const p = profile.players?.find((x) => x.id === player);
      const bf = p?.battlefields?.find((b) => b.id === cardId);
      if (bf?.label) title = bf.label;
      else if (bf?.name) title = bf.name;

      const current = profile.match?.games?.[profile.match.currentGame]?.battlefield?.[player];
      if (current && current === cardId) title = `✓ ${title}`.slice(0, 22);
    } catch {
      title = cardId ? title : "Offline";
    }

    await action.setTitle(title.slice(0, 22), { state: 0 });

    if (cardId) {
      try {
        const image = await loadCardImage(cardId, settings);
        if (image) await action.setImage(image, { state: 0 });
      } catch {
        /* keep default icon */
      }
    }
  }
}
