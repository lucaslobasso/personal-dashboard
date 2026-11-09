// App shell: loads config.json, renders pages → columns → widgets, routes by hash.
import { h, card, errorBox, toast } from "./core/ui.js";
import { store } from "./core/store.js";
import { client, token, isBusy } from "./core/github.js";
import { renderSettings } from "./core/settings.js";
import { registry } from "./modules/index.js";

const slug = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

let config;
const mounted = []; // { source, watch[], remount } for widgets on the current page

async function main() {
  try {
    const res = await fetch("./config.json", { cache: "no-store" });
    config = await res.json();
  } catch (e) {
    document.body.replaceChildren(errorBox(new Error("config.json is missing or invalid: " + e.message)));
    return;
  }
  document.title = config.title || "Dashboard";
  renderHeader();
  window.addEventListener("hashchange", route);
  let offlineShown = false;
  window.addEventListener("pd:offline", () => {
    if (offlineShown) return;
    offlineShown = true;
    toast("Offline: showing the last saved data. Edits won't save until you're back online.", { timeout: 8000 });
  });
  window.addEventListener("beforeunload", (e) => { if (isBusy()) { e.preventDefault(); e.returnValue = ""; } });
  // A widget changed a file: refresh the other widgets on the page that watch it.
  window.addEventListener("pd:changed", (e) => {
    for (const w of mounted) {
      if (w.source === e.detail.source && w.watch.includes(e.detail.path) && w.id !== e.detail.from) w.remount();
    }
  });
  route();
}

function renderHeader() {
  const nav = h("nav", { class: "tabs" }, config.pages.map((p) => h("a", { href: `#/${slug(p.name)}`, dataset: { page: slug(p.name) } }, p.name)));
  const header = h("header", { class: "top" },
    h("a", { class: "brand", href: "#/" }, config.title || "Dashboard"),
    nav,
    tokenWarning(),
    h("div", { class: "top-actions" },
      h("button", { class: "btn btn-icon", title: "Refresh", "aria-label": "Refresh", onClick: () => mounted.forEach((w) => w.remount()) }, "↻"),
      h("a", { class: "btn btn-icon", href: "#/settings", title: "Settings", "aria-label": "Settings", dataset: { page: "settings" } }, "⚙")));
  document.getElementById("app").replaceChildren(header, h("main", { id: "main" }));
}

// Fine-grained tokens from the Settings link expire after 366 days; GitHub doesn't expose the
// expiry to browsers, so warn from the date the token was saved here.
function tokenWarning() {
  if (!token.get()) return null;
  let saved = store.get("tokenSavedAt");
  if (!saved) { saved = Date.now(); store.set("tokenSavedAt", saved); }
  const left = 366 - Math.floor((Date.now() - saved) / 86400000);
  return left <= 30 ? h("a", { class: "warn-chip", href: "#/settings", title: "Create a new token and paste it in Settings" }, left > 0 ? `Token expires in ~${left}d` : "Token may have expired") : null;
}

function route() {
  const main = document.getElementById("main");
  const want = location.hash.replace(/^#\/?/, "");
  mounted.length = 0;
  let pageSlug = want;
  if (want === "settings" || !token.get()) {
    pageSlug = "settings";
    renderSettings(main, config, () => { if (want !== "settings") route(); });
  } else {
    const page = config.pages.find((p) => slug(p.name) === want) || config.pages[0];
    pageSlug = slug(page.name);
    renderPage(main, page);
  }
  document.querySelectorAll("[data-page]").forEach((a) => a.classList.toggle("active", a.dataset.page === pageSlug));
}

function renderPage(main, page) {
  const cols = page.columns.map((col) => {
    const el = h("div", { class: `col col-${col.size === "small" ? "small" : "full"}` });
    for (const w of col.widgets || []) el.append(mountWidget(w));
    return el;
  });
  main.replaceChildren(h("div", { class: "columns" }, cols));
}

let nextId = 0;
function mountWidget(w) {
  const frame = card(w.title || "");
  const id = ++nextId;
  const repo = config.sources?.[w.source];
  const entry = { id, source: w.source, watch: [], remount: () => {} };
  mounted.push(entry);

  const load = async () => {
    frame.body.replaceChildren(h("div", { class: "loading" }, "Loading…"));
    frame.actions.replaceChildren();
    try {
      if (!registry[w.type]) throw new Error(`Unknown widget type "${w.type}". Register it in modules/index.js.`);
      if (w.source && !repo) throw new Error(`Unknown source "${w.source}". Add it to "sources" in config.json.`);
      const mod = (await registry[w.type]()).default;
      if (!w.title) frame.setTitle(mod.title || w.type);
      entry.watch = mod.watch || [];
      const ctx = {
        gh: repo ? client(repo) : null,
        repo,
        source: w.source,
        frame,
        toast,
        refresh: load,
        changed: (path) => window.dispatchEvent(new CustomEvent("pd:changed", { detail: { source: w.source, path, from: id } })),
      };
      const data = await mod.load(ctx, w);
      frame.body.replaceChildren();
      mod.render(frame.body, data, ctx, w);
    } catch (e) {
      console.error(e);
      frame.body.replaceChildren(errorBox(e, load));
    }
  };
  entry.remount = load;
  load();
  return frame.el;
}

main();
