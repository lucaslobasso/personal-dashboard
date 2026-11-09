// Mock GitHub API for local previews (`python scripts/serve.py --mock`, then open /mock.html).
// Reads come from the sibling clones via /__mock/<repo>/<path>; writes stay in memory and are
// logged to the console. Nothing is committed and no token is needed.
// No static imports: the storage prefix must be set before any core module loads.
globalThis.__PD_PREFIX = "pdmock:";
try { localStorage.setItem("pdmock:token", JSON.stringify("mock-token")); } catch { /* storage blocked */ }
const b64encode = (t) => { const b = new TextEncoder().encode(t); let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const b64decode = (s) => new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));
const mem = new Map();
const commits = [];
// Test hooks (tests/e2e.mjs): inspect commits, or seed a file's content before an action.
window.__mock = { commits, offline: false, seed: (key, text) => mem.set(key, text) };
const realFetch = window.fetch.bind(window);
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

window.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (!u.startsWith("https://api.github.com")) return realFetch(url, opts);
  if (window.__mock.offline) throw new TypeError("Failed to fetch");
  const path = new URL(u).pathname;
  const method = (opts.method || "GET").toUpperCase();
  const g = /^\/repos\/[^/]+\/([^/]+)\/git\/(.+)$/.exec(path);
  if (g) return git(g[1], g[2], method, opts.body ? JSON.parse(opts.body) : null);
  const m = /^\/repos\/[^/]+\/([^/]+)\/contents\/(.+)$/.exec(path);
  if (!m) return /^\/repos\/[^/]+\/[^/]+$/.test(path) ? json({ private: true, permissions: { push: true } }) : json({ message: "Not Found" }, 404);
  const [, repo, p] = m;
  const key = `${repo}:${decodeURIComponent(p)}`;
  if (method === "PUT") {
    const body = JSON.parse(opts.body);
    mem.set(key, b64decode(body.content));
    commits.push({ key, message: body.message, text: mem.get(key) });
    console.log("[mock commit]", key, "|", body.message.replace(/\n+/g, " | "));
    return json({ content: { sha: `mem-${Date.now()}` } });
  }
  if (mem.has(key)) return json({ type: "file", encoding: "base64", content: b64encode(mem.get(key)), sha: "mem" });
  const r = await realFetch(`/__mock/${repo}/${p}`);
  if (!r.ok) return json({ message: "Not Found" }, 404);
  if (r.headers.get("X-Mock-Dir")) {
    // Include files created in memory (e.g. a new history file) in folder listings.
    const dir = decodeURIComponent(p).replace(/\/$/, "");
    const list = await r.json();
    for (const k of mem.keys()) {
      const [kr, kp] = [k.slice(0, k.indexOf(":")), k.slice(k.indexOf(":") + 1)];
      if (kr === repo && kp.startsWith(dir + "/") && !kp.slice(dir.length + 1).includes("/") && !list.some((x) => x.path === kp))
        list.push({ name: kp.split("/").pop(), path: kp, type: "file", sha: "mem" });
    }
    return json(list);
  }
  return json({ type: "file", encoding: "base64", content: b64encode(await r.text()), sha: "disk" });
};

// ---- Git Data API emulation (refs → commits → trees → blobs) for commitFiles ----
const blobs = [];   // blob id "b<n>" -> { repo, path } (read lazily) or { text }
const pendingTrees = new Map(), pendingCommits = new Map();
let head = 1;
async function git(repo, rest, method, body) {
  if (method === "GET" && rest === "ref/heads/main") return json({ object: { sha: `c${head}` } });
  if (method === "GET" && rest.startsWith("commits/")) return json({ sha: rest.slice(8), tree: { sha: `t${head}` } });
  if (method === "GET" && rest.startsWith("trees/")) {
    const files = await (await realFetch(`/__mock/${repo}/__tree`)).json().catch(() => []);
    const paths = new Set(files);
    for (const k of mem.keys()) if (k.startsWith(repo + ":")) paths.add(k.slice(repo.length + 1));
    return json({ tree: [...paths].map((p) => ({ path: p, type: "blob", sha: `b${blobs.push({ repo, path: p }) - 1}` })) });
  }
  if (method === "GET" && rest.startsWith("blobs/")) {
    const b = blobs[Number(rest.slice(7))];
    const key = `${b.repo}:${b.path}`;
    const text = mem.has(key) ? mem.get(key) : await (await realFetch(`/__mock/${b.repo}/${b.path}`)).text();
    return json({ encoding: "base64", content: b64encode(text) });
  }
  if (method === "POST" && rest === "trees") { const id = `nt${pendingTrees.size}`; pendingTrees.set(id, body.tree); return json({ sha: id }); }
  if (method === "POST" && rest === "commits") { const id = `nc${pendingCommits.size}`; pendingCommits.set(id, body); return json({ sha: id }); }
  if (method === "PATCH" && rest === "refs/heads/main") {
    if (window.__mock.rejectNextRef) { window.__mock.rejectNextRef = false; return json({ message: "Update is not a fast forward" }, 422); }
    const c = pendingCommits.get(body.sha);
    for (const e of pendingTrees.get(c.tree)) {
      const key = `${repo}:${e.path}`;
      mem.set(key, e.content);
      commits.push({ key, message: c.message, text: e.content, commit: body.sha });
    }
    console.log("[mock commit]", repo, pendingTrees.get(c.tree).map((e) => e.path).join(", "), "|", c.message.replace(/\n+/g, " | "));
    head++;
    return json({ object: { sha: body.sha } });
  }
  return json({ message: "Not Found" }, 404);
}

document.body.prepend(Object.assign(document.createElement("div"), { className: "mock-banner", textContent: "Mock mode: local data, writes are not saved" }));
await import("../app.js");
