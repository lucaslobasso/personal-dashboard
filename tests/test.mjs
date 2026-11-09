// Parity tests against the real data in the sibling repos (../personal-japanese, ../personal-groceries).
//   node tests/test.mjs
// Checks the JS ports match study.py and that pending.json round-trips byte for byte.
import { readFileSync, existsSync, mkdtempSync, cpSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseFile, formatLine, applyRecords } from "../modules/japanese/yaml.js";
import { find, isDue, FILES, due, record } from "../modules/japanese/data.js";
import { today } from "../core/ui.js";
import { parsePending, formatPending, slugify, opAdd, opEdit, opRemove, rankUsual, formatUsual, parseUsual,
  formatProducts, formatHistory, boughtChanges } from "../modules/groceries/format.js";

import { appendBullet, template } from "../modules/japanese/notes.js";
import { askSensei } from "../modules/japanese/due.js";

const here = dirname(fileURLToPath(import.meta.url));
// Nearest ancestor folder holding the clone (works from a git worktree too).
const sibling = (name) => {
  for (let d = join(here, ".."); ; d = dirname(d)) {
    if (existsSync(join(d, "..", name))) return join(d, "..", name);
    if (dirname(d) === d) return join(here, "..", "..", name);
  }
};
const JP = sibling("personal-japanese");
const GR = sibling("personal-groceries");
let failed = 0, passed = 0;
const ok = (cond, msg) => { if (cond) passed++; else { failed++; console.log("FAIL", msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}\n  got:  ${JSON.stringify(a)}\n  want: ${JSON.stringify(b)}`);

function python(args, cwd) {
  for (const exe of ["python", "python3"]) {
    try { return execFileSync(exe, args, { cwd, encoding: "utf-8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } }); } catch (e) { if (e.code !== "ENOENT") throw e; }
  }
  throw new Error("python not found");
}

// ---- groceries ----
eq(slugify("jabón"), "jabon", "slug accents");
eq(slugify("Papel Higiénico  x4!"), "papel-higienico-x4", "slug spaces/symbols");
eq(slugify("¡¡!!"), "item", "slug fallback");
eq(formatPending([]), "[]\n", "empty list");
const a = { id: "a", name: "a", qty: 1, unit: "un", note: "", addedAt: "2026-11-09" };
eq(opAdd({ ...a, qty: 3, note: "x" })([a]).map((x) => [x.qty, x.note]), [[3, "x"]], "add existing sets qty (not +)");
eq(opAdd({ ...a, qty: 2, note: "" })([{ ...a, note: "old" }])[0].note, "old", "add keeps note when none given");
eq(opEdit("a", { qty: 0.5, unit: "kg" })([a])[0].unit, "kg", "edit");
eq(opRemove("a")([a]).length, 0, "remove");
if (existsSync(join(GR, "data/pending.json"))) {
  const text = readFileSync(join(GR, "data/pending.json"), "utf-8");
  eq(formatPending(parsePending(text)), text, "pending.json round-trips byte for byte");
} else console.log("skip: ../personal-groceries not found");

// usual items: pinned first, then by purchase count/recency, never what's already pending
{
  const usual = [{ name: "yerba", qty: 2, unit: "un", note: "Playadito 1 kg" }];
  const hist = [{ date: "2026-10-01", bought: [{ name: "leche" }, { name: "pan" }] }, { date: "2026-10-20", bought: [{ name: "leche" }, { name: "Yerba" }, { name: "café" }] }];
  eq(rankUsual(usual, hist, []).map((x) => x.name), ["yerba", "leche", "café", "pan"], "usual ranking: pinned, then count, then recency");
  eq(rankUsual(usual, hist, [{ id: "leche" }]).map((x) => x.name), ["yerba", "café", "pan"], "usual skips pending items");
  eq(rankUsual(usual, hist, [])[0].qty, 2, "pinned keeps its qty/note");
  const txt = formatUsual(usual);
  eq([txt, parseUsual(txt)], ['[\n  { "name": "yerba", "qty": 2, "unit": "un", "note": "Playadito 1 kg" }\n]\n', usual], "usual.json format round-trips");
  eq(formatProducts({}), "{}\n", "empty products");
}

// mark bought: four files, only ticked items leave pending, missing recorded, cart cleared
{
  const pending = formatPending([a, { ...a, id: "b", name: "b" }, { ...a, id: "c", name: "c" }]);
  const products = formatProducts({ a: { sku: "11", productName: "A 1kg", confirmed: false, lastPrice: 10, date: "2026-11-01" } });
  const sel = { date: "2026-11-09", bought: [{ id: "a", name: "a", sku: "11", productName: "A 1kg", qty: 1, unitPrice: 10 }], missing: [{ name: "b", reason: "not delivered" }] };
  const ch = Object.fromEntries(boughtChanges(sel).map((c) => [c.path, c.mutate]));
  eq(Object.keys(ch), ["data/history/2026-11-09.json", "data/pending.json", "data/products.json", "data/cart.json"], "mark bought touches the four files");
  eq(parsePending(ch["data/pending.json"](pending)).map((x) => x.id), ["b", "c"], "only bought items leave pending");
  eq(JSON.parse(ch["data/products.json"](products)).a.confirmed, true, "bought SKU becomes confirmed");
  eq(ch["data/products.json"](formatProducts({})), null, "products untouched when nothing to confirm");
  eq([ch["data/cart.json"]('{"url":"x"}\n'), ch["data/cart.json"]("{}\n")], ["{}\n", null], "cart reset only when a cart exists");
  const hist = ch["data/history/2026-11-09.json"](null);
  eq(hist, formatHistory({ date: "2026-11-09", bought: [{ name: "a", sku: "11", productName: "A 1kg", qty: 1, unitPrice: 10 }], missing: [{ name: "b", reason: "not delivered" }] }), "history file written");
  ok(hist.startsWith('{\n  "date": "2026-11-09",\n  "bought": [\n    { "name": "a"'), "history uses one line per entry");
  const again = boughtChanges({ date: "2026-11-09", bought: [{ id: "b", name: "b", qty: 1 }], missing: [] })[0].mutate(hist);
  eq([JSON.parse(again).bought.map((x) => x.name), JSON.parse(again).missing], [["a", "b"], []], "a second purchase the same day merges and drops it from missing");
}

// ---- work: formats match work.py byte for byte; week totals; sections ----
{
  const W = await import("../modules/work/format.js");
  const WK = sibling("personal-work");
  if (existsSync(join(WK, "scripts/work.py"))) {
    const tmp = mkdtempSync(join(tmpdir(), "pd-work-"));
    cpSync(join(WK, "scripts"), join(tmp, "scripts"), { recursive: true });
    cpSync(join(WK, "data"), join(tmp, "data"), { recursive: true });
    const titles = ["Release notes v2 — ¡urgente!", "Árbol de decisión para el equipo de plataforma y datos", "  ", "Release notes v2 — ¡urgente!"];
    let pyIds = [];
    for (const t of titles) {
      try { pyIds.push(JSON.parse(python(["scripts/work.py", "add", JSON.stringify({ title: t, due: "2026-11-12", project: "Core" })], tmp)).id); } catch { pyIds.push(null); }
    }
    python(["scripts/work.py", "log", "2026-11-10", "3,5", "Core", "--note", "revisión"], tmp);
    python(["scripts/work.py", "log", "2026-11-09", "2", "Ops"], tmp);
    const itemsTxt = readFileSync(join(tmp, "data/items.json"), "utf-8");
    const hoursTxt = readFileSync(join(tmp, "data/hours/2026-11.json"), "utf-8");
    eq(W.formatRows(W.parseRows(itemsTxt), W.ITEM_KEYS), itemsTxt, "work items.json: JS writer matches work.py byte for byte");
    eq(W.formatRows(W.parseRows(hoursTxt), W.HOUR_KEYS), hoursTxt, "work hours file: JS writer matches work.py byte for byte");
    let jsItems = [];
    const jsIds = titles.map((t) => { if (!t.trim()) return null; jsItems = W.opAddItem({ title: t })(jsItems); return jsItems.at(-1).id; });
    eq(jsIds, pyIds, "work item ids (slug + -2 suffix) match work.py");
    const jsHours = W.opLogHours({ date: "2026-11-09", hours: 2, project: "Ops" })(W.opLogHours({ date: "2026-11-10", hours: 3.5, project: "Core", note: "revisión" })([]));
    eq(W.formatRows(jsHours, W.HOUR_KEYS), hoursTxt, "logging hours from the dashboard writes what work.py writes");
    rmSync(tmp, { recursive: true, force: true });
  } else console.log("skip: ../personal-work not found");

  const rows = [{ date: "2026-11-09", hours: 8, project: "Core" }, { date: "2026-11-10", hours: 3.5, project: "Core" }, { date: "2026-11-10", hours: 1, project: "Ops" }, { date: "2026-11-16", hours: 5, project: "X" }];
  const w = W.weekStats(rows, "2026-11-11");
  eq([w.start, w.end, w.total, w.days.map((d) => d.hours), w.projects], ["2026-11-09", "2026-11-15", 12.5, [8, 4.5, 0, 0, 0, 0, 0], [["Core", 11.5], ["Ops", 1]]], "week stats Mon–Sun");
  eq(W.weekOf("2026-11-15").start, "2026-11-09", "a Sunday belongs to the week starting the Monday before");
  const it = (id, o) => ({ id, title: id, kind: "task", priority: "normal", status: "todo", due: null, createdAt: "2026-11-01", doneAt: null, ...o });
  const s = W.sections([it("late", { due: "2026-11-10" }), it("fri", { due: "2026-11-13" }), it("wip", { status: "doing" }), it("later", { due: "2026-12-01" }),
    it("someday", { priority: "low" }), it("old", { status: "done", doneAt: "2026-10-01" }), it("fresh", { status: "done", doneAt: "2026-11-10" })], "2026-11-11");
  eq(Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.map((x) => x.id)])),
    { overdue: ["late"], week: ["fri"], doing: ["wip"], next: ["later"], low: ["someday"], done: ["fresh"] }, "work sections");
  const up = W.opUpdateItem("a", { status: "done" })([it("a")])[0];
  eq([up.status, up.doneAt !== null, W.opUpdateItem("a", { status: "todo" })([up])[0].doneAt], ["done", true, null], "done sets doneAt; reopening clears it");
}

// Node has no localStorage without a flag: give core/store.js an in-memory one.
const mem = new Map();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; } } });

// ---- github.updateFile: concurrent edit → 409 → re-read and re-apply (fake GitHub) ----
{
  const { updateFile, b64encode, b64decode } = await import("../core/github.js");
  let server = { text: formatPending([a]), sha: "s1" };
  let puts = 0, injected = false;
  globalThis.fetch = async (url, opts = {}) => {
    const res = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ETag: `"${server.sha}"` } });
    if ((opts.method || "GET") === "GET") return res({ type: "file", encoding: "base64", content: b64encode(server.text), sha: server.sha });
    const body = JSON.parse(opts.body);
    puts++;
    if (!injected) { injected = true; server = { text: formatPending([a, { ...a, id: "b", name: "b" }]), sha: "s2" }; } // another device commits first
    if (body.sha !== server.sha) return res({ message: "conflict" }, 409);
    server = { text: b64decode(body.content), sha: `s${puts + 2}` };
    return res({ content: { sha: server.sha } });
  };
  const r = await updateFile("me/repo", "data/pending.json", (t) => formatPending(opAdd({ ...a, id: "c", name: "c" })(parsePending(t))), "msg");
  eq(parsePending(server.text).map((x) => x.id), ["a", "b", "c"], "conflict retry keeps the other edit and re-applies ours");
  eq([r.changed, puts], [true, 2], "exactly one retry after a 409");
  const unchanged = await updateFile("me/repo", "data/cart.json", () => null, "msg");
  eq(unchanged.changed, false, "mutate returning null skips the write");

  // offline: a network failure serves the last copy seen (flagged stale) instead of erroring
  const { getFile } = await import("../core/github.js");
  const fresh = await getFile("me/repo", "data/pending.json");
  globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
  const off = await getFile("me/repo", "data/pending.json");
  eq([off.text === fresh.text, off.stale], [true, true], "offline read falls back to the cached copy");
  let threw = false;
  try { await getFile("me/repo", "data/never-seen.json"); } catch (e) { threw = e.status === 0; }
  ok(threw, "offline read of an uncached file still errors");
}

// ---- github.commitFiles: atomic multi-file commit, retry when main moves (fake git server) ----
{
  const { commitFiles, b64encode, gitBlobSha } = await import("../core/github.js");
  const files = { "data/pending.json": formatPending([a]), "data/cart.json": '{"url":"https://x"}\n' };
  const blobsBySha = new Map();
  const snap = async () => {
    const tree = [];
    for (const [p, t] of Object.entries(files)) { const s = await gitBlobSha(t); blobsBySha.set(s, t); tree.push({ path: p, type: "blob", sha: s }); }
    return tree;
  };
  let head = 1, trees = new Map(), cmts = new Map(), patches = 0, raced = false;
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(url).pathname, m = opts.method || "GET", body = opts.body ? JSON.parse(opts.body) : null;
    const res = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });
    if (u.endsWith("/git/ref/heads/main")) return res({ object: { sha: `c${head}` } });
    if (u.includes("/git/commits/")) return res({ tree: { sha: `t${head}` } });
    if (u.includes("/git/trees/")) return res({ tree: await snap() });
    if (u.includes("/git/blobs/")) return res({ content: b64encode(blobsBySha.get(u.split("/").pop())) });
    if (u.endsWith("/git/trees")) { trees.set(`nt${trees.size}`, body.tree); return res({ sha: `nt${trees.size - 1}` }); }
    if (u.endsWith("/git/commits")) { cmts.set(`nc${cmts.size}`, body); return res({ sha: `nc${cmts.size - 1}` }); }
    if (u.endsWith("/git/refs/heads/main")) {
      patches++;
      if (!raced) { raced = true; files["data/pending.json"] = formatPending([a, { ...a, id: "b", name: "b" }]); head++; return res({ message: "not ff" }, 422); }
      const c = cmts.get(body.sha);
      if (c.parents[0] !== `c${head}`) return res({ message: "not ff" }, 422);
      for (const e of trees.get(c.tree)) files[e.path] = e.content;
      head++;
      return res({ object: { sha: body.sha } });
    }
    return res({ message: "?" }, 404);
  };
  const r = await commitFiles("me/repo", [
    { path: "data/pending.json", mutate: (t) => formatPending(opAdd({ ...a, id: "c", name: "c" })(parsePending(t))) },
    { path: "data/cart.json", mutate: (t) => (JSON.parse(t).url ? "{}\n" : null) },
  ], "msg");
  eq(parsePending(files["data/pending.json"]).map((x) => x.id), ["a", "b", "c"], "commitFiles retry keeps the other commit's change");
  eq([files["data/cart.json"], r.changed, patches], ["{}\n", true, 2], "both files land in one commit after one retry");
  const none = await commitFiles("me/repo", [{ path: "data/cart.json", mutate: () => null }], "msg");
  eq(none.changed, false, "commitFiles with no changes makes no commit");
}

// ---- japanese ----
if (existsSync(join(JP, "scripts/study.py"))) {
  const all = [];
  for (const f of FILES) {
    const p = join(JP, "data", `${f}.yaml`);
    if (existsSync(p)) all.push(...parseFile(readFileSync(p, "utf-8"), f).map((item) => ({ file: f, item })));
  }
  // byte-exact round trip: re-serialize every item line with formatLine (port of study.py's q() writer)
  let lines = 0;
  const diffs = [];
  for (const f of FILES) {
    const p = join(JP, "data", `${f}.yaml`);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf-8").split("\n").filter((l) => l.startsWith("- {"))) {
      lines++;
      if (formatLine(parseFile(line, f)[0]) !== line) diffs.push(`${f}: ${line.slice(0, 80)}`);
    }
  }
  ok(lines > 0 && diffs.length === 0, `all ${lines} YAML item lines round-trip byte for byte${diffs.length ? "\n  " + diffs.slice(0, 3).join("\n  ") : ""}`);

  // record + due parity: run the real study.py on a temp copy and compare byte for byte
  {
    const tmp = mkdtempSync(join(tmpdir(), "pd-jp-"));
    cpSync(join(JP, "scripts"), join(tmp, "scripts"), { recursive: true });
    cpSync(join(JP, "data"), join(tmp, "data"), { recursive: true });
    const vocab = all.filter((x) => x.file === "vocab").map((x) => x.item.id);
    const gram = all.filter((x) => x.file === "grammar").map((x) => x.item.id);
    // sequences that walk new → learning → known and back
    const seq = [[vocab[0], "right"], [vocab[0], "right"], [vocab[1], "wrong"], [vocab[1], "right"], [vocab[1], "right"], [vocab[1], "right"],
      [gram[0], "right"], [gram[1], "wrong"], [vocab[2], "right"], [vocab[2], "wrong"]];
    const before = Object.fromEntries(["vocab", "grammar"].map((f) => [f, readFileSync(join(tmp, "data", `${f}.yaml`), "utf-8")]));
    python(["scripts/study.py", "record", ...seq.flat()], tmp);
    const day = today();
    for (const f of ["vocab", "grammar"]) {
      const mine = applyRecords(before[f], (it) => {
        const mineSeq = seq.filter(([id]) => id === it.id);
        return mineSeq.length ? mineSeq.reduce((acc, [, r]) => record(acc, r, day), it) : null;
      }, f);
      eq(mine === readFileSync(join(tmp, "data", `${f}.yaml`), "utf-8"), true, `record: ${f}.yaml matches study.py byte for byte`);
    }
    // backdate a few items so some are due, then compare due --mode review/new
    for (const f of ["vocab", "grammar"]) {
      const p = join(tmp, "data", `${f}.yaml`);
      const t = applyRecords(readFileSync(p, "utf-8"), (it) => (it.status !== "new" ? { ...it, last_reviewed: "2026-10-01" } : null), f);
      if (t) writeFileSync(p, t);
    }
    const pool = FILES.flatMap((f) => existsSync(join(tmp, "data", `${f}.yaml`)) ? parseFile(readFileSync(join(tmp, "data", `${f}.yaml`), "utf-8"), f).map((item) => ({ file: f, item })) : []);
    for (const mode of ["review", "new"]) {
      const out = python(["scripts/study.py", "due", "-n", "12", "--mode", mode], tmp);
      const want = out.split(/\r?\n/).filter((l) => l.startsWith("[")).map((l) => l.split(" | ")[0].replace(/^\[\w+\] /, ""));
      const got = due(pool, 12, mode).pick.map((x) => x.item.id);
      eq(got, want, `due --mode ${mode} picks the same items in the same order (${want.length})`);
    }
    const mixed = due(pool, 12, "mixed");
    ok(mixed.pick.length === 12 && mixed.pick.filter((x) => isDue(x.item)).length === Math.min(mixed.due, 8), "mixed = up to 70% due reviews topped up with new");
    rmSync(tmp, { recursive: true, force: true });
  }

  // stats parity: totals and due per file
  const stats = python(["scripts/study.py", "stats"], JP);
  for (const f of FILES) {
    const m = new RegExp(`^${f}\\s+total\\s+(\\d+).*due (\\d+)`, "m").exec(stats);
    if (!m) continue;
    const mine = all.filter((x) => x.file === f);
    eq([mine.length, mine.filter((x) => isDue(x.item)).length], [Number(m[1]), Number(m[2])], `stats ${f} total/due`);
  }
  // find parity: same ids in the same order as study.py find --full
  for (const q of ["taberu", "たべます", "L05", "te-form", "日本", "ありがとう", "水", "becaus"]) {
    const out = python(["scripts/study.py", "find", q, "--full", "--limit", "100000"], JP);
    const want = out.split(/\r?\n/).filter((l) => l.startsWith("[")).map((l) => JSON.parse(l.slice(l.indexOf("] ") + 2)).id);
    const got = find(all, q).hits.map((x) => x.item.id);
    eq(got.slice(0, 200), want.slice(0, 200), `find "${q}" (${want.length} hits)`);
  }
} else console.log("skip: ../personal-japanese not found");

// lesson notes: quick-add bullets land in the right section, compatible with askSensei
{
  let md = template("2026-11-12");
  md = appendBullet(md, "Notes", "〜てしまう = regret / completion");
  md = appendBullet(md, "Ask sensei", "difference between は and が here?");
  md = appendBullet(md, "Notes", "  two\nlines ");
  eq(md, "# 2026-11-12 — Lesson with sensei\n\n**Source:** sensei lesson.\n\n## Notes\n- 〜てしまう = regret / completion\n- two lines\n\n## Ask sensei\n- difference between は and が here?\n", "appendBullet fills sections in place");
  eq(askSensei(md), ["difference between は and が here?"], "dashboard notes feed the Today 'Ask sensei' list");
  eq(appendBullet("# x\n\n## Ask sensei\n- (none yet)\n", "Ask sensei", "q1"), "# x\n\n## Ask sensei\n- q1\n", "placeholder replaced");
  eq(appendBullet("# x\r\n\r\nbody\r\n", "Notes", "n"), "# x\n\nbody\n\n## Notes\n- n\n", "missing section appended (CRLF normalized)");
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
