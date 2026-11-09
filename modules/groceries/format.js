// pending.json helpers. Schema and style follow personal-groceries/CLAUDE.md:
// [{ "id", "name", "qty", "unit", "note", "addedAt" }], one item per line, 2-space indent,
// so a dashboard edit produces the same one-line git diff Claude's edits do.
export const KEYS = ["id", "name", "qty", "unit", "note", "addedAt"];
export const UNITS = ["un", "kg"];

export function parsePending(text) {
  if (!text || !text.trim()) return [];
  const v = JSON.parse(text);
  if (!Array.isArray(v)) throw new Error("data/pending.json is not a list.");
  return v;
}

const line = (it) => {
  const keys = [...KEYS.filter((k) => k in it), ...Object.keys(it).filter((k) => !KEYS.includes(k))];
  return "{ " + keys.map((k) => `${JSON.stringify(k)}: ${JSON.stringify(it[k])}`).join(", ") + " }";
};

export function formatPending(items) {
  if (!items.length) return "[]\n";
  return "[\n" + items.map((it) => "  " + line(it)).join(",\n") + "\n]\n";
}

/** Short kebab slug of the name, accent-free: "Jabón en polvo" → "jabon-en-polvo". */
export function slugify(name) {
  return String(name).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "item";
}

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function fmtQty(it) {
  const q = Number(it.qty);
  return it.unit === "kg" ? `${q.toLocaleString("es-AR")} kg` : `×${q.toLocaleString("es-AR")}`;
}

export const ars = (n) =>
  n == null || isNaN(n) ? "–" : new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);

// ---- list operations: pure functions of the current list, so a conflict retry can
// re-apply them to whatever version is on GitHub at that moment. ----

/** Add, or (same id already pending) set qty/unit/note like /add does. */
export const opAdd = (item) => (list) => {
  const i = list.findIndex((x) => x.id === item.id);
  if (i < 0) return [...list, item];
  const next = list.slice();
  next[i] = { ...list[i], qty: item.qty, unit: item.unit, note: item.note || list[i].note };
  return next;
};
export const opEdit = (id, patch) => (list) => list.map((x) => (x.id === id ? { ...x, ...patch } : x));
export const opRemove = (id) => (list) => list.filter((x) => x.id !== id);

// ---- other data files (canonical formats, documented in personal-groceries/CLAUDE.md) ----
// One entry per line inside a 2-space-indented container, keys in their given order.
const flat = (o) => "{ " + Object.entries(o).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(", ") + " }";
const arrayBlock = (arr, indent) => (arr.length ? "[\n" + arr.map((x) => `${indent}  ${flat(x)}`).join(",\n") + `\n${indent}]` : "[]");
const parseJson = (text, fallback) => (!text || !text.trim() ? fallback : JSON.parse(text));

/** data/usual.json: pinned staples [{ name, qty, unit, note }]. */
export const parseUsual = (text) => parseJson(text, []);
export const formatUsual = (list) =>
  (list.length ? arrayBlock(list.map(({ name, qty, unit, note }) => ({ name, qty, unit, note })), "") + "\n" : "[]\n");

/** data/products.json: { key: { sku, productName, confirmed, lastPrice, date } }. */
export const parseProducts = (text) => parseJson(text, {});
export function formatProducts(obj) {
  const keys = Object.keys(obj);
  if (!keys.length) return "{}\n";
  return "{\n" + keys.map((k) => `  ${JSON.stringify(k)}: ${flat(obj[k])}`).join(",\n") + "\n}\n";
}

/** data/history/YYYY-MM-DD.json: { date, bought: [...], missing: [...] }. */
export function formatHistory(hist) {
  return `{\n  "date": ${JSON.stringify(hist.date)},\n  "bought": ${arrayBlock(hist.bought || [], "  ")},\n  "missing": ${arrayBlock(hist.missing || [], "  ")}\n}\n`;
}

/**
 * Usual-items chips: pinned first, then names bought in past purchases by frequency and
 * recency, skipping anything already pending. histories: [{ date, bought: [{ name }] }].
 */
export function rankUsual(usual, histories, pending, limit = 12) {
  const pendingIds = new Set(pending.map((p) => p.id));
  const out = new Map();
  for (const u of usual) out.set(slugify(u.name), { ...u, pinned: true, count: 0, last: "" });
  for (const hist of histories) {
    for (const b of hist.bought || []) {
      if (!b.name) continue;
      const id = slugify(b.name);
      const cur = out.get(id) || { name: b.name, qty: 1, unit: "un", note: "", pinned: false, count: 0, last: "" };
      cur.count++;
      if ((hist.date || "") > cur.last) cur.last = hist.date;
      out.set(id, cur);
    }
  }
  return [...out.entries()].filter(([id]) => !pendingIds.has(id)).map(([, v]) => v)
    .sort((x, y) => (y.pinned - x.pinned) || (y.count - x.count) || y.last.localeCompare(x.last) || x.name.localeCompare(y.name))
    .slice(0, limit);
}

/**
 * Mark bought (the dashboard's /bought). sel: { date, bought: [{ id, name, sku, productName, qty, unitPrice }],
 * missing: [{ name, reason }] }. Returns per-file mutate functions for one atomic commit.
 */
export function boughtChanges(sel) {
  const ids = new Set(sel.bought.map((b) => b.id).filter(Boolean));
  const skus = new Set(sel.bought.map((b) => b.sku).filter((s) => s != null && s !== ""));
  return [
    { path: `data/history/${sel.date}.json`, mutate: (text) => {
      const prev = parseJson(text, { date: sel.date, bought: [], missing: [] });
      const bought = [...(prev.bought || []), ...sel.bought.map(({ name, sku, productName, qty, unitPrice }) =>
        ({ name, sku: sku ?? null, productName: productName ?? null, qty, unitPrice: unitPrice ?? null }))];
      const boughtNames = new Set(bought.map((b) => slugify(b.name)));
      const missing = [...(prev.missing || []), ...sel.missing].filter((m) => !boughtNames.has(slugify(m.name)));
      return formatHistory({ date: sel.date, bought, missing });
    } },
    { path: "data/pending.json", mutate: (text) => formatPending(parsePending(text).filter((p) => !ids.has(p.id))) },
    { path: "data/products.json", mutate: (text) => {
      const p = parseProducts(text);
      let touched = false;
      for (const v of Object.values(p)) if (skus.has(v.sku) && v.confirmed !== true) { v.confirmed = true; touched = true; }
      return touched ? formatProducts(p) : null;
    } },
    { path: "data/cart.json", mutate: (text) => (text && text.trim() && text.trim() !== "{}" ? "{}\n" : null) },
  ];
}
