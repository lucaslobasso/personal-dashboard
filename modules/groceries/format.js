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
