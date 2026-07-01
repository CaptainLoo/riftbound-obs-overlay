import {
  action,
  DidReceiveSettingsEvent,
  KeyAction,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
} from "@elgato/streamdeck";
import { fetchDeckProfile, loadCardImage, showCard, type ShowCardSettings } from "../riftbound";
import { runKeyAction } from "../safeAction";

@action({ UUID: "com.riftbound.obs.showcard" })
export class ShowCard extends SingletonAction<ShowCardSettings> {
  override async onWillAppear(ev: WillAppearEvent<ShowCardSettings>): Promise<void> {
    if (!ev.action.isKey()) return;
    await this.syncKey(ev.payload.settings, ev.action);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<ShowCardSettings>): Promise<void> {
    if (!ev.action.isKey()) return;
    await this.syncKey(ev.payload.settings, ev.action);
  }

  override async onKeyDown(ev: KeyDownEvent<ShowCardSettings>): Promise<void> {
    await runKeyAction(ev, () => showCard(ev.payload.settings));
  }

  private async syncKey(settings: ShowCardSettings, action: KeyAction) {
    const player = settings.player || "p1";
    const cardId = settings.cardId;
    let title = settings.cardId ? "Card" : "Pick card";

    try {
      const profile = (await fetchDeckProfile(settings)) as {
        players?: { id: string; cards?: { id: string; label?: string; name?: string }[] }[];
      };
      const p = profile.players?.find((x) => x.id === player);
      const card = p?.cards?.find((c) => c.id === cardId);
      if (card?.label) title = card.label;
      else if (card?.name) title = card.name;
    } catch {
      title = cardId ? cardId : "Offline";
    }

    await action.setTitle(title, { state: 0 });

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
