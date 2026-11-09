// Browser end-to-end tests: drives headless Edge/Chrome over the DevTools protocol against mock
// mode (local clones, in-memory writes), so the real UI, CSP and modules are exercised.
//   node tests/e2e.mjs            (needs Python, the sibling personal-* clones, and Edge or Chrome;
//                                  set BROWSER=<path to exe> to pick one; SHOTS=<dir> saves screenshots)
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8790, DEBUG = 9339;
const BASE = `http://127.0.0.1:${PORT}/mock.html`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();

const browserPath = [process.env.BROWSER,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/microsoft-edge"].find((p) => p && existsSync(p));
if (!browserPath) { console.log("skip: no Edge/Chrome found (set BROWSER)"); process.exit(0); }

let passed = 0, failed = 0;
const check = (cond, msg) => { if (cond) { passed++; console.log("  ok  ", msg); } else { failed++; console.log("  FAIL", msg); } };

// ---- processes ----
const py = spawn(process.platform === "win32" ? "python" : "python3", ["scripts/serve.py", String(PORT), "--mock"], { cwd: ROOT, stdio: "ignore" });
const profile = mkdtempSync(join(tmpdir(), "pd-e2e-"));
const browser = spawn(browserPath, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${profile}`,
  "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });

async function until(fn, ms = 15000, step = 100) {
  const end = Date.now() + ms;
  for (;;) { try { const v = await fn(); if (v) return v; } catch { /* retry */ } if (Date.now() > end) return null; await sleep(step); }
}

// ---- minimal CDP client ----
function connect(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map(), listeners = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
    else listeners.forEach((l) => l(m));
  };
  return new Promise((resolve) => ws.onopen = () => resolve({
    send: (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }),
    on: (fn) => listeners.push(fn),
    close: () => ws.close(),
  }));
}

let page;
async function js(expression) {
  const r = await page.send("Runtime.evaluate", { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
const waitJs = (expr, ms) => until(() => js(`return (${expr});`), ms);
const commitsOf = (path) => js(`return __mock.commits.filter(c => c.key.endsWith(${JSON.stringify(path)}));`);
async function shot(name) {
  if (!process.env.SHOTS) return;
  mkdirSync(process.env.SHOTS, { recursive: true });
  const { data } = await page.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(process.env.SHOTS, `${name}.png`), Buffer.from(data, "base64"));
}
const row = (name) => `[...document.querySelectorAll('.g-row')].find(r => r.querySelector('.g-name')?.textContent === ${JSON.stringify(name)})`;

try {
  check(await until(() => fetch(BASE).then((r) => r.ok)), "dev server starts in mock mode");
  const target = await until(() => fetch(`http://127.0.0.1:${DEBUG}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json()));
  page = await connect(target.webSocketDebuggerUrl);
  const problems = [];
  page.on((m) => {
    if (m.method === "Runtime.exceptionThrown") problems.push("exception: " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") problems.push("console.error: " + m.params.args.map((a) => a.value ?? a.description).join(" "));
    if (m.method === "Log.entryAdded" && m.params.entry.level === "error") problems.push(`log(${m.params.entry.source}): ${m.params.entry.text}`);
  });
  await page.send("Runtime.enable"); await page.send("Log.enable"); await page.send("Page.enable");
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: "window.confirm = () => true;" });
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

  // ---------- groceries ----------
  console.log("groceries");
  await page.send("Page.navigate", { url: `${BASE}#/groceries` });
  const n0 = await waitJs(`document.querySelectorAll('.grocery-list .g-row').length`);
  check(n0 > 0, `list renders (${n0} items from local pending.json)`);
  await js(`__mock.seed("personal-groceries:data/cart.json", JSON.stringify({ builtAt: "${today}", url: "https://www.josimar.com.ar/checkout/cart/add?sku=1&qty=1&seller=1&sc=1", lines: [], skipped: [], estimatedTotal: 1 }) + "\\n");`);

  await js(`const f = document.querySelector('.add-form');
    f.querySelector('[aria-label=Item]').value = 'Yerba'; f.querySelector('[aria-label=Quantity]').value = '2';
    f.querySelector('[aria-label=Note]').value = 'Playadito 1 kg'; f.requestSubmit();`);
  let c = await until(async () => (await commitsOf("pending.json")).find((x) => x.message.endsWith("dashboard: add Yerba")));
  check(c && c.message.startsWith(`sync: ${today} pending.json\n\n`), "add → commit message follows the sync convention");
  check(c?.text.includes(`  { "id": "yerba", "name": "Yerba", "qty": 2, "unit": "un", "note": "Playadito 1 kg", "addedAt": "${today}" }\n]\n`), "add → exact one-line item appended in file style");
  const cart = await until(async () => (await commitsOf("cart.json"))[0]);
  check(cart?.text === "{}\n", "list change resets a built cart.json to {}");
  check(await waitJs(`document.body.textContent.includes('No cart built.')`), "cart widget refreshes to the empty state (pd:changed)");

  await js(`const f = document.querySelector('.add-form'); f.querySelector('[aria-label=Item]').value = 'yerba'; f.querySelector('[aria-label=Quantity]').value = '3'; f.requestSubmit();`);
  c = await until(async () => (await commitsOf("pending.json")).find((x) => x.message.includes("set Yerba to ×3")));
  check(c && (c.text.match(/"id": "yerba"/g) || []).length === 1 && c.text.includes(`"id": "yerba", "name": "Yerba", "qty": 3`), "duplicate add sets qty (no second entry), like /add");

  await js(`${row("frutillas")}.querySelector('.g-main').click();`);
  await waitJs(`document.querySelector('.g-row.editing')`);
  await js(`const r = document.querySelector('.g-row.editing'); r.querySelector('[aria-label=Quantity]').value = '0,5'; r.querySelector('form').requestSubmit();`);
  c = await until(async () => (await commitsOf("pending.json")).find((x) => x.message.endsWith("dashboard: edit frutillas")));
  check(c?.text.includes(`"id": "frutillas", "name": "frutillas", "qty": 0.5, "unit": "kg"`), "inline edit accepts a decimal comma (0,5 → 0.5)");

  const before = (await commitsOf("pending.json")).length;
  await js(`${row("jabón")}.querySelector('[aria-label^=Remove]').click();`);
  check(await waitJs(`!${row("jabón")}`), "remove hides the row immediately");
  await js(`[...document.querySelectorAll('.toast button')].find(b => b.textContent === 'Undo').click();`);
  check(await waitJs(`!!${row("jabón")}`), "undo brings it back");
  await sleep(5600);
  check((await commitsOf("pending.json")).length === before, "undone remove never commits");

  await js(`${row("rollo de cocina")}.querySelector('[aria-label^=Remove]').click();`);
  c = await until(async () => (await commitsOf("pending.json")).find((x) => x.message.endsWith("dashboard: remove rollo de cocina")), 9000);
  check(c && !c.text.includes("rollo-de-cocina") && c.text.endsWith("\n]\n"), "remove commits after the undo window, file stays well-formed");
  await shot("groceries-desktop");

  // ---------- japanese ----------
  console.log("japanese");
  await js(`location.hash = '#/japanese';`);
  const total = await waitJs(`parseInt((document.querySelector('.card-badge')?.textContent || '').replace(/\\D/g, '')) || 0`);
  check(total > 0, `search loads all items (${total})`);
  await js(`const q = document.querySelector('input[type=search]'); q.value = 'たべます'; q.dispatchEvent(new Event('input'));`);
  check(await waitJs(`/^1 result/.test(document.querySelector('.search-bar + p')?.textContent)`), "search たべます → 1 result (matches study.py find)");
  await js(`document.querySelector('.result').click();`);
  check(await waitJs(`!document.querySelector('.detail').hidden && document.querySelector('.detail dl, .detail .detail-foot')`), "tapping a result opens its detail");
  await js(`const q = document.querySelector('input[type=search]'); q.value = ''; q.dispatchEvent(new Event('input'));
    const s = document.querySelector('[aria-label=Lesson]'); s.value = '5'; s.dispatchEvent(new Event('change'));`);
  check(await waitJs(`/^\\d+ results?/.test(document.querySelector('.search-bar + p')?.textContent) && [...document.querySelectorAll('.result')].length > 0`), "lesson filter browses lesson 5");
  check(await waitJs(`document.querySelectorAll('.stack-bar').length >= 3 && document.querySelector('.tile-value')`), "stats card renders tiles and bars");

  // ---------- resilience ----------
  console.log("resilience");
  await js(`location.hash = '#/home';`);
  await waitJs(`document.querySelectorAll('.grocery-list .g-row').length > 0`);
  await js(`__mock.offline = true; document.querySelector('[aria-label=Refresh]').click();`);
  check(await waitJs(`[...document.querySelectorAll('.toast')].some(t => t.textContent.startsWith('Offline'))`), "offline shows a one-time toast");
  check(await waitJs(`document.querySelectorAll('.grocery-list .g-row').length > 0 && !document.querySelector('.error')`), "offline still renders the cached list, no error boxes");
  await js(`__mock.offline = false;`);
  await js(`localStorage.setItem('pdmock:tokenSavedAt', String(Date.now() - 350 * 86400000)); location.reload();`);
  check(await waitJs(`/Token expires in ~\\d+d/.test(document.querySelector('.warn-chip')?.textContent || '')`), "a token saved 350 days ago shows the expiry chip");
  await js(`localStorage.setItem('pdmock:tokenSavedAt', String(Date.now())); location.reload();`);
  check(await waitJs(`document.querySelector('.top') && !document.querySelector('.warn-chip')`), "a fresh token shows no chip");

  // ---------- settings ----------
  console.log("settings");
  await js(`location.hash = '#/settings';`);
  const href = await waitJs(`[...document.querySelectorAll('a')].find(a => a.textContent.startsWith('Create token'))?.href`);
  check(href?.includes("contents=write") && href.includes("expires_in=366") && href.includes("target_name=lucaslobasso"), "token link is pre-filled");
  await js(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Test again').click();`);
  check(await waitJs(`document.querySelectorAll('.checks .ok').length === 2`), "Test again reports both repos ✓");

  // ---------- layout ----------
  console.log("layout");
  await page.send("Emulation.setDeviceMetricsOverride", { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
  for (const p of ["home", "groceries", "japanese", "settings"]) {
    await js(`location.hash = '#/${p}';`);
    await sleep(900);
    const w = await js(`return document.documentElement.scrollWidth;`);
    check(w <= 360, `no horizontal scroll at 360px on ${p} (${w}px)`);
    await shot(`${p}-phone`);
  }
  await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await js(`location.hash = '#/home';`); await sleep(900); await shot("home-phone-light");
  await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });

  check(problems.length === 0, `no exceptions, console errors or CSP violations${problems.length ? ":\n    " + problems.join("\n    ") : ""}`);
} catch (e) {
  failed++;
  console.log("  FAIL", e.message);
} finally {
  try {
    const v = await fetch(`http://127.0.0.1:${DEBUG}/json/version`).then((r) => r.json());
    const b = await connect(v.webSocketDebuggerUrl);
    await b.send("Browser.close").catch(() => {});
  } catch { browser.kill(); }
  py.kill();
}
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
