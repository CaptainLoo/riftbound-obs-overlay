// Tiny reconnecting WebSocket client shared by the overlay and control panel.
export function mergeStatePatch(state, patch) {
  if (!state) return patch ? { ...patch } : state;
  if (!patch || typeof patch !== "object") return state;
  return { ...state, ...patch };
}

export function connectState(onState, options = {}) {
  let socket = null;
  let retry = null;
  let state = null;

  const onPatch = options.onPatch || null;

  function open() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    socket = new WebSocket(`${proto}://${location.host}/ws`);

    socket.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "state") {
          state = msg.state;
          onState(state, { type: "state", sections: Object.keys(state || {}) });
        } else if (msg.type === "patch") {
          state = mergeStatePatch(state, msg.patch);
          const info = { type: "patch", sections: msg.sections || Object.keys(msg.patch || {}) };
          if (onPatch) onPatch(state, info);
          else onState(state, info);
        }
      } catch {
        /* ignore malformed frames */
      }
    });

    socket.addEventListener("close", () => {
      clearTimeout(retry);
      retry = setTimeout(open, 1000);
    });

    socket.addEventListener("error", () => socket.close());
  }

  open();
}
