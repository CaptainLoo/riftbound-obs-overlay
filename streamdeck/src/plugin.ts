import streamDeck from "@elgato/streamdeck";

import { ShowCard } from "./actions/ShowCard";
import { HideAll, HidePlayer, Matchup, SelectGame, WinGame } from "./actions/Controls";
import { SetBattlefield } from "./actions/Battlefield";
import { GamePoint } from "./actions/GamePoint";

streamDeck.actions.registerAction(new ShowCard());
streamDeck.actions.registerAction(new HideAll());
streamDeck.actions.registerAction(new HidePlayer());
streamDeck.actions.registerAction(new Matchup());
streamDeck.actions.registerAction(new WinGame());
streamDeck.actions.registerAction(new SelectGame());
streamDeck.actions.registerAction(new SetBattlefield());
streamDeck.actions.registerAction(new GamePoint());

streamDeck.connect();
