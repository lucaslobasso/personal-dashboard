// Parity tests against the real data in the sibling repos (../personal-japanese, ../personal-groceries).
//   node tests/test.mjs
// Checks the JS ports match study.py and that pending.json round-trips byte for byte.
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseFile } from "../modules/japanese/yaml.js";
import { find, isDue, FILES } from "../modules/japanese/data.js";
import { parsePending, formatPending, slugify, opAdd, opEdit, opRemove } from "../modules/groceries/format.js";

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
}

// ---- japanese ----
if (existsSync(join(JP, "scripts/study.py"))) {
  const all = [];
  for (const f of FILES) {
    const p = join(JP, "data", `${f}.yaml`);
    if (existsSync(p)) all.push(...parseFile(readFileSync(p, "utf-8"), f).map((item) => ({ file: f, item })));
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

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
