// Minimal GitHub REST client for reading and writing files in the personal-* data repos.
// Reads use ETags (a 304 is fast and doesn't count against the rate limit); writes use the
// file's blob sha, so a concurrent change (Claude session, other device) is detected and
// the edit is re-applied on top of the fresh file instead of overwriting it.
import { store } from "./store.js";

const API = "https://api.github.com";

export class GitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const token = {
  get: () => store.get("token", ""),
  set: (t) => store.set("token", t.trim()),
  clear: () => store.del("token"),
};

// ---- busy tracking (warn before closing the tab while a write is in flight) ----
let busy = 0;
export const isBusy = () => busy > 0;
export function track(delta) { busy = Math.max(0, busy + delta); }

// ---- low level ----
function explain(status, msg) {
  if (status === 401) return "GitHub token missing or invalid. Open Settings.";
  if (status === 403) return `GitHub refused the request (${msg || "forbidden"}). Check the token's repository permissions, or wait if it's the rate limit.`;
  if (status === 404) return "Not found. Check the repo name in config.json and that the token can access it.";
  if (status === 409) return "The file changed on GitHub at the same time. Try again.";
  return `GitHub error ${status}${msg ? ": " + msg : ""}`;
}

async function request(method, path, { body, etag, accept } = {}) {
  const headers = {
    Accept: accept || "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const t = token.get();
  if (t) headers.Authorization = `Bearer ${t}`;
  if (etag) headers["If-None-Match"] = etag;
  if (body) headers["Content-Type"] = "application/json";
  let res;
  try {
    // no-store: we keep our own ETag cache, so the browser must pass 304s through to us.
    res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  } catch {
    throw new GitHubError(0, "Can't reach GitHub (offline?).");
  }
  if (res.status === 304) return { status: 304, res };
  if (!res.ok) {
    let msg = "";
    try { msg = (await res.json()).message || ""; } catch { /* not json */ }
    throw new GitHubError(res.status, explain(res.status, msg));
  }
  if (accept && accept.includes("raw")) return { status: res.status, res, text: await res.text() };
  return { status: res.status, res, json: await res.json() };
}

export function b64decode(b64) {
  const bin = atob(b64.replace(/\s/g, ""));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function b64encode(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const encPath = (p) => p.split("/").map(encodeURIComponent).join("/");
const cacheKey = (repo, path) => `gh:${repo}:${path}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- public API ----

/** Read a file. Returns { text, sha }, or null when optional and missing. */
export async function getFile(repo, path, { optional = false } = {}) {
  const key = cacheKey(repo, path);
  const cached = store.get(key);
  const url = `/repos/${repo}/contents/${encPath(path)}`;
  try {
    const r = await request("GET", url, { etag: cached?.etag });
    if (r.status === 304 && cached) return { text: cached.text, sha: cached.sha };
    const j = r.json;
    if (Array.isArray(j)) throw new GitHubError(0, `${path} is a folder, not a file.`);
    // Files over 1 MB come back without inline content: fetch the raw bytes instead.
    const text = j.encoding === "base64"
      ? b64decode(j.content)
      : (await request("GET", url, { accept: "application/vnd.github.raw+json" })).text;
    store.set(key, { etag: r.res.headers.get("ETag"), sha: j.sha, text });
    return { text, sha: j.sha };
  } catch (e) {
    if (optional && e.status === 404) return null;
    // Offline: fall back to the last copy we saw, so the dashboard still opens (writes will fail loudly).
    if (e.status === 0 && cached) {
      globalThis.dispatchEvent?.(new Event("pd:offline"));
      return { text: cached.text, sha: cached.sha, stale: true };
    }
    throw e;
  }
}

/** List a folder: [{ name, path, type, sha }]. A missing folder is []. */
export async function listDir(repo, path) {
  try {
    const r = await request("GET", `/repos/${repo}/contents/${encPath(path)}`);
    return Array.isArray(r.json) ? r.json.map(({ name, path, type, sha }) => ({ name, path, type, sha })) : [];
  } catch (e) {
    if (e.status === 404) return [];
    throw e;
  }
}

/** Create/replace a file. `sha` is the blob being replaced (omit when creating). Returns the new sha. */
export async function putFile(repo, path, text, sha, message) {
  const body = { message, content: b64encode(text) };
  if (sha) body.sha = sha;
  const r = await request("PUT", `/repos/${repo}/contents/${encPath(path)}`, { body });
  const newSha = r.json.content.sha;
  store.set(cacheKey(repo, path), { etag: null, sha: newSha, text });
  return newSha;
}

/**
 * Read-modify-write with conflict retry. `mutate(text|null)` returns the new text, or
 * null/unchanged to skip the write. On a sha conflict it re-reads and re-applies `mutate`.
 * Returns { changed, text }.
 */
export async function updateFile(repo, path, mutate, message) {
  track(1);
  try {
    for (let attempt = 0; ; attempt++) {
      const cur = await getFile(repo, path, { optional: true });
      const next = mutate(cur ? cur.text : null);
      if (next == null || next === cur?.text) return { changed: false, text: cur?.text ?? null };
      try {
        await putFile(repo, path, next, cur?.sha, message);
        return { changed: true, text: next };
      } catch (e) {
        const conflict = e.status === 409 || e.status === 422;
        if (!conflict || attempt >= 2) throw e;
        store.del(cacheKey(repo, path));
        await sleep(600 * (attempt + 1));
      }
    }
  } finally {
    track(-1);
  }
}

// One write at a time per file, so quick successive edits never race each other.
const queues = new Map();
export function serial(key, fn) {
  const prev = queues.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  queues.set(key, next);
  return next;
}

/** Check what the token can do on a repo: { ok, push, error }. */
export async function checkRepo(repo) {
  try {
    const r = await request("GET", `/repos/${repo}`);
    return { ok: true, push: !!r.json.permissions?.push, private: r.json.private };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** A repo-bound client handed to modules as ctx.gh. */
export function client(repo) {
  return {
    repo,
    getFile: (path, opts) => getFile(repo, path, opts),
    listDir: (path) => listDir(repo, path),
    updateFile: (path, mutate, message) => serial(`${repo}:${path}`, () => updateFile(repo, path, mutate, message)),
  };
}
