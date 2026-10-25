/** Small DOM helpers: element builder, no-op writes, and action delegation. */

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k === "html") el.innerHTML = v;
    else if (k in el && k !== "style") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

/** Write textContent only when it changed (avoids layout work and caret jumps). */
export function setText(el, text) {
  if (!el) return;
  const next = text ?? "";
  if (el.textContent !== String(next)) el.textContent = next;
}

/** Set a form control's value only when it differs and the control is not focused. */
export function setValue(el, value) {
  if (!el) return;
  const next = value ?? "";
  if (document.activeElement === el) return;
  if (el.value !== String(next)) el.value = next;
}

const handlers = { click: new Map(), change: new Map(), input: new Map() };

/**
 * Register a handler for `[data-action="name"]` elements. The handler receives
 * (element, event). One listener per event type lives on the delegation root.
 */
export function onAction(type, name, fn) {
  handlers[type].set(name, fn);
}

export function delegateActions(root) {
  for (const type of Object.keys(handlers)) {
    root.addEventListener(type, (event) => {
      const el = event.target.closest?.("[data-action]");
      if (!el || !root.contains(el)) return;
      // Click handlers must not fire for change/input of the same control and vice versa.
      const fn = handlers[type].get(el.dataset.action);
      if (!fn) return;
      if (type === "click" && (el.tagName === "SELECT" || el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      Promise.resolve(fn(el, event)).catch((err) => {
        console.error(`[action ${el.dataset.action}]`, err);
        import("./toast.js").then(({ toast }) => toast(err.message || String(err), "err"));
      });
    });
  }
}
