// Mock GitHub API for local previews (`python scripts/serve.py --mock`, then open /mock.html).
// Reads come from the sibling clones via /__mock/<repo>/<path>; writes stay in memory and are
// logged to the console. Nothing is committed and no token is needed.
// No static imports: the storage prefix must be set before any core module loads.
globalThis.__PD_PREFIX = "pdmock:";
try { localStorage.setItem("pdmock:token", JSON.stringify("mock-token")); } catch { /* storage blocked */ }
const b64encode = (t) => { const b = new TextEncoder().encode(t); let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const b64decode = (s) => new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));
const mem = new Map();
const realFetch = window.fetch.bind(window);
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

window.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (!u.startsWith("https://api.github.com")) return realFetch(url, opts);
  const path = new URL(u).pathname;
  const method = (opts.method || "GET").toUpperCase();
  const m = /^\/repos\/[^/]+\/([^/]+)\/contents\/(.+)$/.exec(path);
  if (!m) return /^\/repos\/[^/]+\/[^/]+$/.test(path) ? json({ private: true, permissions: { push: true } }) : json({ message: "Not Found" }, 404);
  const [, repo, p] = m;
  const key = `${repo}:${decodeURIComponent(p)}`;
  if (method === "PUT") {
    const body = JSON.parse(opts.body);
    mem.set(key, b64decode(body.content));
    console.log("[mock commit]", key, "|", body.message.replace(/\n+/g, " | "));
    return json({ content: { sha: `mem-${Date.now()}` } });
  }
  if (mem.has(key)) return json({ type: "file", encoding: "base64", content: b64encode(mem.get(key)), sha: "mem" });
  const r = await realFetch(`/__mock/${repo}/${p}`);
  if (!r.ok) return json({ message: "Not Found" }, 404);
  if (r.headers.get("X-Mock-Dir")) return json(await r.json());
  return json({ type: "file", encoding: "base64", content: b64encode(await r.text()), sha: "disk" });
};

document.body.prepend(Object.assign(document.createElement("div"), { className: "mock-banner", textContent: "Mock mode: local data, writes are not saved" }));
await import("../app.js");
