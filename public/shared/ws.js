// Tiny reconnecting WebSocket client shared by the overlay and control panel.
export function connectState(onState) {
  let socket = null;
  let retry = null;

  function open() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    socket = new WebSocket(`${proto}://${location.host}/ws`);

    socket.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "state") onState(msg.state);
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
