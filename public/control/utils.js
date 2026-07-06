export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export function escapeHtml(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

export function escapeAttr(s) {
  return escapeHtml(s);
}

export function cssEscape(s) {
  return s.replace(/([.:])/g, "\\$1");
}

