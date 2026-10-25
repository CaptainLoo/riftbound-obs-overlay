const toastEl = document.getElementById("toast");
let toastTimer = null;

/** kind: "ok" | "err" | "warn" */
export function toast(msg, kind = "ok") {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.className = "toast"), 2200);
}
