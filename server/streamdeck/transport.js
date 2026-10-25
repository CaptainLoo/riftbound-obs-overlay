/**
 * Message shapes exchanged between the server and the Stream Deck worker over
 * the Node IPC channel (`stdio: [..., "ipc"]`).
 *
 *   server → worker : { type: "model", model }
 *                     { type: "command", cmd: "refresh-images", force }
 *                     { type: "command", cmd: "shutdown", quick }
 *   worker → server : { type: "ready" }
 *                     { type: "status", status }
 */

/** Wrap a Node IPC endpoint (process or ChildProcess) into typed handlers. */
export function createTransport(endpoint, { statusThrottleMs = 100 } = {}) {
  const handlers = { model: [], command: [], status: [], ready: [] };

  endpoint.on("message", (msg) => {
    if (!msg || typeof msg !== "object") return;
    const list = handlers[msg.type];
    if (!list) return;
    for (const fn of list) {
      try {
        fn(msg);
      } catch {
        /* a handler must not break the channel */
      }
    }
  });

  function send(msg) {
    if (typeof endpoint.send !== "function" || endpoint.connected === false) return false;
    try {
      endpoint.send(msg);
      return true;
    } catch {
      return false;
    }
  }

  // Status updates are frequent during key drawing: coalesce them (trailing edge).
  let statusTimer = null;
  let pendingStatus = null;
  function sendStatus(status) {
    pendingStatus = status;
    if (statusTimer) return;
    statusTimer = setTimeout(() => {
      statusTimer = null;
      const s = pendingStatus;
      pendingStatus = null;
      send({ type: "status", status: s });
    }, statusThrottleMs);
  }

  function flushStatus() {
    if (!statusTimer) return;
    clearTimeout(statusTimer);
    statusTimer = null;
    if (pendingStatus) send({ type: "status", status: pendingStatus });
    pendingStatus = null;
  }

  return {
    onModel: (fn) => handlers.model.push(fn),
    onCommand: (fn) => handlers.command.push(fn),
    onStatus: (fn) => handlers.status.push(fn),
    onReady: (fn) => handlers.ready.push(fn),
    sendModel: (model) => send({ type: "model", model }),
    sendCommand: (cmd, extra = {}) => send({ type: "command", cmd, ...extra }),
    sendReady: () => send({ type: "ready" }),
    sendStatus,
    flushStatus,
  };
}

export function isIpcAvailable(endpoint = process) {
  return typeof endpoint.send === "function";
}
