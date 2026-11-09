// DOM helpers. All data is inserted as text (never innerHTML), so repo content can't inject markup.

/** h("div", { class, onClick, ... }, ...children) */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k === "href") { if (safeHref(v)) el.setAttribute("href", v); }
    else if (k === "value" || k === "checked" || k === "selected") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const safeHref = (v) => /^(https:\/\/|#|\.\/)/.test(String(v));

/** External link: https only, opens in a new tab. */
export const extLink = (href, text, cls) =>
  safeHref(href) ? h("a", { href, class: cls, target: "_blank", rel: "noopener noreferrer" }, text) : h("span", { class: cls }, text);

export function select(options, value, props = {}) {
  const el = h("select", props, options.map(([v, label]) => h("option", { value: v }, label)));
  el.value = value;
  return el;
}

export const empty = (...lines) => h("div", { class: "empty" }, lines.map((l) => h("p", {}, l)));

// ---- toasts ----
let toastHost;
/** toast("Saved") / toast("Removed", { action: "Undo", onAction }) / toast(msg, { error: true }) */
export function toast(message, { action, onAction, error = false, timeout = 4000 } = {}) {
  toastHost ||= document.body.appendChild(h("div", { class: "toasts", role: "status", "aria-live": "polite" }));
  const el = h("div", { class: "toast" + (error ? " toast-error" : "") }, h("span", {}, message));
  const close = () => el.remove();
  if (action) el.append(h("button", { class: "btn btn-ghost", onClick: () => { close(); onAction?.(); } }, action));
  el.append(h("button", { class: "btn btn-icon", "aria-label": "Dismiss", onClick: close }, "×"));
  toastHost.append(el);
  if (timeout) setTimeout(close, error ? timeout * 2 : timeout);
  return close;
}

// ---- widget frame ----
export function card(title) {
  const badge = h("span", { class: "card-badge" });
  const actions = h("div", { class: "card-actions" });
  const body = h("div", { class: "card-body" }, h("div", { class: "loading" }, "Loading…"));
  const el = h("section", { class: "card" }, h("header", { class: "card-head" }, h("h2", {}, title), badge, actions), body);
  return {
    el, body, actions,
    setBadge: (text) => { badge.textContent = text ?? ""; },
    setTitle: (text) => { el.querySelector("h2").textContent = text; },
  };
}

export function errorBox(err, onRetry) {
  const auth = err?.status === 401 || err?.status === 403;
  return h("div", { class: "error" },
    h("p", {}, err?.message || String(err)),
    h("div", { class: "row" },
      onRetry && h("button", { class: "btn", onClick: onRetry }, "Retry"),
      auth && h("a", { class: "btn", href: "#/settings" }, "Open Settings")));
}

export const debounce = (fn, ms = 150) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};
