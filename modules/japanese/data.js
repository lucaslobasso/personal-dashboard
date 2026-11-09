// Shared data layer for the Japanese widgets: loading, search and SRS logic ported from
// personal-japanese/scripts/study.py (norm, cmd_find, lesson, overdue/is_due, err).
import { parseFile } from "./yaml.js";

export const FILES = ["grammar", "verbs", "vocab", "kanji"];
export const STATUSES = ["new", "learning", "known"];
const LEARNING_INTERVAL = { 0: 1, 1: 2, 2: 4 }; // streak -> days
const KNOWN_INTERVAL = 21;
export const SEARCH_FIELDS = ["term", "reading", "meaning", "structure", "notes", "tags", "masu_form"];

// Parsed files keyed by blob sha, so both widgets share one parse and edits from the agent
// show up as soon as GitHub serves the new sha.
const parsed = new Map();

/** Load all files: [{ file, item }] in file order (grammar, verbs, vocab, kanji like study.py). */
export async function loadAll(gh) {
  const files = await Promise.all(FILES.map(async (f) => {
    const r = await gh.getFile(`data/${f}.yaml`, { optional: true });
    if (!r) return [];
    const key = `${gh.repo}:${f}:${r.sha}`;
    if (!parsed.has(key)) parsed.set(key, parseFile(r.text, f).map((item) => ({ file: f, item })));
    return parsed.get(key);
  }));
  return files.flat();
}

export const norm = (s) =>
  String(s).toLowerCase().replace(/[\s〜~・]/g, "").replaceAll("します", "する").replaceAll("ます", "る");

const haystack = (it) =>
  norm(SEARCH_FIELDS.map((k) => {
    const v = it[k];
    return v == null ? "" : Array.isArray(v) ? v.join(" ") : String(v);
  }).join(" "));

/** cmd_find: substring match on normalized fields; if nothing hits, retry without the last char. */
export function find(pool, text) {
  const t = norm(text);
  for (const q of [t, t.length >= 3 ? t.slice(0, -1) : null]) {
    if (!q) break;
    const hits = pool.filter(({ item }) => haystack(item).includes(q));
    if (hits.length) return { hits, relaxed: q !== t };
  }
  return { hits: [], relaxed: false };
}

export function lesson(it) {
  for (const t of it.tags || []) {
    const m = /^mnn-L(\d+)$/.exec(String(t));
    if (m) return parseInt(m[1], 10);
  }
  return 999;
}

function localToday() {
  const d = new Date();
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysSince(it) {
  const lr = it.last_reviewed;
  if (!lr) return null;
  const [y, m, d] = String(lr).split("-").map(Number);
  return Math.round((localToday() - Date.UTC(y, m - 1, d)) / 86400000);
}

export function overdue(it) {
  const st = it.status || "new";
  if (st === "new") return null;
  const d = daysSince(it);
  if (d == null) return 999;
  const iv = st === "known" ? KNOWN_INTERVAL : (LEARNING_INTERVAL[Math.min(it.streak || 0, 2)] ?? 1);
  return d - iv;
}

export const isDue = (it) => { const o = overdue(it); return o != null && o >= 0; };
export const errRate = (it) => (it.times_wrong || 0) / Math.max(it.times_seen || 0, 1);

/**
 * Port of study.py cmd_due: pool = [{ file, item }] in file order. Returns { pick, due, fresh }.
 * mixed: up to 70% due reviews, topped up with new items, shuffled; review / new: only those.
 */
export function due(pool, n, mode = "mixed", random = Math.random) {
  const rev = pool.filter(({ item }) => isDue(item))
    .sort((a, b) => ((a.item.status === "known") - (b.item.status === "known")) || (errRate(b.item) - errRate(a.item)) || ((overdue(b.item) || 0) - (overdue(a.item) || 0)));
  const fresh = pool.filter(({ item }) => (item.status || "new") === "new")
    .sort((a, b) => (lesson(a.item) - lesson(b.item)) || (FILES.indexOf(a.file) - FILES.indexOf(b.file)));
  let pick;
  if (mode === "review") pick = rev.slice(0, n);
  else if (mode === "new") pick = fresh.slice(0, n);
  else {
    const r = rev.slice(0, Math.max(Math.floor((n * 7) / 10), n - fresh.length));
    pick = shuffle([...r, ...fresh.slice(0, n - r.length)], random);
  }
  return { pick, due: rev.length, fresh: fresh.length };
}

function shuffle(a, random) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const STATS = { date_learned: null, last_reviewed: null, times_seen: 0, times_wrong: 0, streak: 0, status: "new" };

/** Port of study.py cmd_record for one answer. Returns a new item (key order like Python's setdefault). */
export function record(item, result, todayStr) {
  const it = { ...item };
  for (const [k, v] of Object.entries(STATS)) if (!(k in it)) it[k] = v;
  it.times_seen += 1;
  it.last_reviewed = todayStr;
  if (result === "right") {
    it.streak = it.status === "new" ? Math.max(it.streak + 1, 2) : it.streak + 1;
    it.status = it.streak >= 3 ? "known" : "learning";
  } else if (result === "wrong") {
    it.times_wrong += 1;
    it.streak = 0;
    it.status = "learning";
  } else throw new Error(`result must be right|wrong, got ${result}`);
  return it;
}
