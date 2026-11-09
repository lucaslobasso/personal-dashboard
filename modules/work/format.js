// personal-work data helpers. Formats match personal-work/scripts/work.py byte for byte
// (one entry per line, keys in schema order), so Claude's and the dashboard's edits look the same.
import { today } from "../../core/ui.js";

export const ITEMS = "data/items.json";
export const hoursPath = (ymd) => `data/hours/${ymd.slice(0, 7)}.json`;
export const ITEM_KEYS = ["id", "title", "kind", "priority", "status", "due", "project", "ref", "notes", "createdAt", "doneAt"];
export const HOUR_KEYS = ["date", "hours", "project", "item", "note"];
export const KINDS = ["task", "ticket", "deadline"];
export const PRIORITIES = ["high", "normal", "low"];
export const STATUSES = ["todo", "doing", "waiting", "done"];

const line = (o, keys) => "{ " + [...keys.filter((k) => k in o), ...Object.keys(o).filter((k) => !keys.includes(k))]
  .map((k) => `${JSON.stringify(k)}: ${JSON.stringify(o[k] ?? null)}`).join(", ") + " }";
export const formatRows = (rows, keys) => (rows.length ? "[\n" + rows.map((r) => "  " + line(r, keys)).join(",\n") + "\n]\n" : "[]\n");
export const parseRows = (text) => (!text || !text.trim() ? [] : JSON.parse(text));

/** Same as work.py slug(): accent-free kebab, max 40 chars. */
export const slug = (s) => String(s).normalize("NFKD").replace(/[^\x00-\x7f]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "item";

// ---- item ops (pure; re-applied on conflicts) ----
export function opAddItem(fields) {
  return (items) => {
    const base = slug(fields.title);
    let id = base, n = 2;
    while (items.some((x) => x.id === id)) id = `${base}-${n++}`;
    const it = { id, title: fields.title.trim(), kind: fields.kind || "task", priority: fields.priority || "normal", status: fields.status || "todo",
      due: fields.due || null, project: fields.project || "", ref: fields.ref || "", notes: fields.notes || "", createdAt: today(), doneAt: null };
    if (it.status === "done") it.doneAt = today();
    return [...items, it];
  };
}
export function opUpdateItem(id, patch) {
  return (items) => items.map((x) => {
    if (x.id !== id) return x;
    const next = { ...x, ...patch };
    if (next.status === "done" && x.status !== "done") next.doneAt = today();
    if (next.status !== "done") next.doneAt = null;
    return next;
  });
}
export const opRemoveItem = (id) => (items) => items.filter((x) => x.id !== id);
export const NEXT_STATUS = { todo: "doing", doing: "done", waiting: "doing", done: "todo" };

// ---- hours ----
export function opLogHours(row) {
  const r = { date: row.date, hours: row.hours, project: row.project || "", item: row.item || null, note: row.note || "" };
  return (rows) => [...rows, r].map((x, i) => [x, i]).sort((a, b) => a[0].date.localeCompare(b[0].date) || a[1] - b[1]).map(([x]) => x);
}
export const opRemoveHours = (match) => (rows) => {
  const i = rows.findIndex((r) => r.date === match.date && r.hours === match.hours && r.project === match.project && (r.note || "") === (match.note || ""));
  return i < 0 ? rows : [...rows.slice(0, i), ...rows.slice(i + 1)];
};

const addDays = (ymd, n) => { const [y, m, d] = ymd.split("-").map(Number); return today(new Date(y, m - 1, d + n)); };
export function weekOf(ymd = today()) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dow = (new Date(y, m - 1, d).getDay() + 6) % 7; // Monday = 0
  const start = addDays(ymd, -dow);
  return { start, end: addDays(start, 6), days: [...Array(7)].map((_, i) => addDays(start, i)) };
}

/** Mon–Sun totals for the week containing ymd: { days: [{ date, hours }], projects: [[name, h]], total, entries }. */
export function weekStats(rows, ymd = today()) {
  const w = weekOf(ymd);
  const entries = rows.filter((r) => r.date >= w.start && r.date <= w.end);
  const round = (x) => Math.round(x * 100) / 100;
  const days = w.days.map((date) => ({ date, hours: round(entries.filter((r) => r.date === date).reduce((s, r) => s + Number(r.hours), 0)) }));
  const proj = {};
  for (const r of entries) proj[r.project || "(none)"] = (proj[r.project || "(none)"] || 0) + Number(r.hours);
  return { ...w, days, entries, total: round(days.reduce((s, x) => s + x.hours, 0)),
    projects: Object.entries(proj).map(([k, v]) => [k, round(v)]).sort((a, b) => b[1] - a[1]) };
}

/** Group open items for the list: overdue, this week, doing, next, low; done in the last 7 days. */
export function sections(items, ymd = today()) {
  const { end } = weekOf(ymd);
  const out = { overdue: [], week: [], doing: [], next: [], low: [], done: [] };
  const byDue = (a, b) => (a.due || "9999").localeCompare(b.due || "9999") || PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority) || a.createdAt.localeCompare(b.createdAt);
  for (const it of items) {
    if (it.status === "done") { if (it.doneAt && it.doneAt >= addDays(ymd, -7)) out.done.push(it); continue; }
    if (it.due && it.due < ymd) out.overdue.push(it);
    else if (it.due && it.due <= end) out.week.push(it);
    else if (it.status === "doing") out.doing.push(it);
    else if (it.priority === "low") out.low.push(it);
    else out.next.push(it);
  }
  for (const k of Object.keys(out)) out[k].sort(k === "done" ? (a, b) => b.doneAt.localeCompare(a.doneAt) : byDue);
  return out;
}

export const parseHours = (s) => parseFloat(String(s).trim().replace(",", "."));
