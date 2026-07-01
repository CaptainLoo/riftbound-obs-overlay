import streamDeck from "@elgato/streamdeck";
import type { KeyDownEvent } from "@elgato/streamdeck";

/** Run a key action; show green check or yellow alert for the user. */
export async function runKeyAction(ev: KeyDownEvent, fn: () => Promise<void>) {
  try {
    await fn();
    await ev.action.showOk();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    streamDeck.logger.error(msg);
    await ev.action.showAlert();
  }
}
