/** Control panel entry point: boot order, tabs, keyboard shortcuts, state subscriptions. */
import { delegateActions } from "./dom.js";
import { initLayout, isLayoutDragging, syncLayoutFromData } from "./layout.js";
import { changeGameBy, hideDisplay, initMatch, renderMatch, toggleMatchup, winGame } from "./match.js";
import { initPlayers, renderPlayers } from "./players.js";
import { reloadData, startStateSocket, subscribe } from "./store.js";
import { initStreamDeck, renderStreamDeckDeck } from "./streamdeck.js";
import { toast } from "./toast.js";
import { initUpdates } from "./updates.js";

// ---- Tabs -----------------------------------------------------------------

const TAB_KEY = "riftbound.control.tab";

function activateTab(name, { persist = true } = {}) {
  let found = false;
  document.querySelectorAll(".tab").forEach((t) => {
    const active = t.dataset.tab === name;
    t.classList.toggle("active", active);
    t.setAttribute("aria-selected", String(active));
    t.tabIndex = active ? 0 : -1;
    if (active) found = true;
  });
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === `tab-${name}`));
  if (found && persist) {
    try {
      localStorage.setItem(TAB_KEY, name);
    } catch {
      /* ignore */
    }
    if (location.hash !== `#${name}`) history.replaceState(null, "", `#${name}`);
  }
}

function initTabs() {
  const tabs = [...document.querySelectorAll(".tab")];
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => activateTab(tab.dataset.tab));
    tab.addEventListener("keydown", (e) => {
      const i = tabs.indexOf(tab);
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
        next.focus();
        activateTab(next.dataset.tab);
      }
    });
  });
  // Deep link (#match) wins over the remembered tab, so OBS docks can pin a tab.
  const fromHash = location.hash.replace(/^#/, "");
  let saved = null;
  try {
    saved = localStorage.getItem(TAB_KEY);
  } catch {
    /* ignore */
  }
  const initial = [fromHash, saved].find((t) => t && document.getElementById(`tab-${t}`));
  if (initial) activateTab(initial, { persist: false });
  window.addEventListener("hashchange", () => {
    const t = location.hash.replace(/^#/, "");
    if (document.getElementById(`tab-${t}`)) activateTab(t, { persist: false });
  });
}

// ---- Keyboard shortcuts (ignored while typing in a field) -------------------

function initShortcuts() {
  document.addEventListener("keydown", (e) => {
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select" || e.target.isContentEditable) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest?.(".lslot")) return; // arrow keys nudge layout blocks there
    const actions = {
      arrowleft: () => changeGameBy(-1),
      arrowright: () => changeGameBy(1),
      a: () => winGame("p1"),
      p: () => winGame("p2"),
      m: () => toggleMatchup(),
      h: () => hideDisplay(),
      escape: () => hideDisplay(),
    };
    const fn = actions[e.key.toLowerCase()];
    if (fn) {
      e.preventDefault();
      fn().catch((err) => toast(err.message, "err"));
    }
  });
}

// ---- Boot -----------------------------------------------------------------

async function boot() {
  initTabs();
  delegateActions(document.querySelector("main"));
  initPlayers();
  initMatch();
  initUpdates();

  await reloadData();
  renderPlayers();
  renderMatch();
  initLayout();
  renderStreamDeckDeck();
  document.body.classList.add("ready");

  subscribe((data, info) => {
    if (!data) return;
    const sections = new Set(info.sections || []);
    const full = info.type !== "patch";
    if (full || sections.has("players")) {
      renderPlayers();
      renderStreamDeckDeck();
    }
    if (full || sections.has("players") || sections.has("match") || sections.has("game") || sections.has("display")) {
      renderMatch();
    }
    if ((full || sections.has("layout")) && !isLayoutDragging()) {
      syncLayoutFromData();
    }
  });

  startStateSocket();
  initShortcuts();
  initStreamDeck();
}

boot().catch((err) => {
  console.error(err);
  toast("Failed to load: " + err.message, "err");
});
