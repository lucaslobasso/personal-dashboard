// media-requests: queue movie/series requests for the home PC (personal-arr state/requests.json).
// The PC runs `arr.py requests` every ~10 min: clear matches get added, ambiguous ones come back
// here as candidates to pick. Options: finished (how many finished requests to keep showing, default 8).
import { h, select, empty, today } from "../../core/ui.js";
import { syncMessage } from "../../core/github.js";

export const REQUESTS = "state/requests.json";
const KEYS = ["id", "title", "type", "quality", "status", "candidates", "pick", "result", "requestedAt", "updatedAt"];
const ACTIVE = new Set(["queued", "choose", "picked", "error"]);
const LABEL = { queued: "waiting for the PC", choose: "pick one", picked: "adding soon", added: "added", exists: "already there", "not-found": "not found", error: "error" };

// Same bytes as Python's json.dumps(v, ensure_ascii=False) for nested values, so the dashboard and
// the worker (arr.py format_requests) produce identical lines.
const py = (v) => Array.isArray(v) ? "[" + v.map(py).join(", ") + "]"
  : v && typeof v === "object" ? "{" + Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${py(x)}`).join(", ") + "}"
  : JSON.stringify(v ?? null);
const line = (r) => "{ " + [...KEYS.filter((k) => k in r), ...Object.keys(r).filter((k) => !KEYS.includes(k))]
  .map((k) => `${JSON.stringify(k)}: ${py(r[k])}`).join(", ") + " }";
export const formatRequests = (list) => (list.length ? "[\n" + list.map((r) => "  " + line(r)).join(",\n") + "\n]\n" : "[]\n");
export const parseRequests = (text) => (!text || !text.trim() ? [] : JSON.parse(text));
const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");

// Pure ops (re-applied on a conflict).
export const opQueue = (r) => (list) => [...list, r];
export const opPatch = (id, patch) => (list) => list.map((r) => (r.id === id ? { ...r, ...patch, updatedAt: nowIso() } : r));
export const opDrop = (pred) => (list) => list.filter((r) => !pred(r));

export default {
  type: "media-requests",
  title: "Movies & series",
  watch: [REQUESTS],

  async load(ctx) {
    const f = await ctx.gh.getFile(REQUESTS, { optional: true });
    return parseRequests(f?.text);
  },

  render(el, initial, ctx, opts) {
    let list = initial;
    const title = h("input", { class: "input grow", placeholder: "Title (add the year for remakes)", "aria-label": "Title", autocomplete: "off", required: true });
    const type = select([["any", "Not sure"], ["movie", "Movie"], ["series", "Series"]], "any", { class: "input", "aria-label": "Type" });
    const quality = select([["default", "Default quality"], ["4k", "4K"]], "default", { class: "input", "aria-label": "Quality" });
    const ul = h("ul", { class: "requests" });
    el.append(
      h("form", { class: "add-form", onSubmit: add },
        h("div", { class: "row" }, title),
        h("div", { class: "row" }, type, quality, h("button", { class: "btn btn-primary", type: "submit" }, "Request"))),
      ul,
      h("p", { class: "muted small" }, "Your home PC checks the queue every ~10 minutes while it's on. Clear matches are added automatically; ambiguous ones ask you here."));

    function apply(op, label) {
      list = op(list);
      draw();
      ctx.gh.commitFiles([{ path: REQUESTS, mutate: (text) => formatRequests(op(parseRequests(text))) }], syncMessage(today(), label))
        .then((r) => { if (r.texts[REQUESTS] != null) { list = parseRequests(r.texts[REQUESTS]); draw(); } ctx.changed(REQUESTS); })
        .catch((e) => { ctx.toast(`Couldn't save: ${e.message}`, { error: true }); ctx.refresh(); });
    }

    function add(e) {
      e.preventDefault();
      const t = title.value.trim();
      if (!t) return title.focus();
      const r = { id: `r-${Date.now().toString(36)}`, title: t, type: type.value, quality: quality.value, status: "queued",
        candidates: [], pick: null, result: "", requestedAt: nowIso(), updatedAt: nowIso() };
      apply(opQueue(r), `request ${t}`);
      title.value = "";
    }

    function draw() {
      const active = list.filter((r) => ACTIVE.has(r.status));
      const done = list.filter((r) => !ACTIVE.has(r.status)).slice(-(opts.finished ?? 8)).reverse();
      ctx.frame.setBadge(list.some((r) => r.status === "choose") ? "pick needed" : active.length ? `${active.length} active` : "");
      ul.replaceChildren(...[...active.slice().reverse(), ...done].map(row));
      if (!list.length) ul.append(h("li", { class: "plain" }, empty("No requests yet.")));
      if (done.length) ul.append(h("li", { class: "plain" }, h("button", { class: "btn btn-ghost small", onClick: () =>
        apply(opDrop((r) => !ACTIVE.has(r.status)), "clear finished requests") }, "Clear finished")));
    }

    function row(r) {
      const kind = r.type === "any" ? "" : ` · ${r.type}`;
      const head = h("div", { class: "req-head" },
        h("span", { class: "req-title" }, r.title),
        h("span", { class: `badge req-${r.status}` }, LABEL[r.status] || r.status));
      const body = [];
      if (r.status === "choose") {
        body.push(h("div", { class: "cands" }, (r.candidates || []).map((c) => h("button", {
          class: "cand", type: "button",
          onClick: () => apply(opPatch(r.id, { status: "picked", pick: { kind: c.kind, id: c.id } }), `pick ${c.title} (${c.year}) for ${r.title}`),
        }, h("span", { class: "cand-title" }, `${c.title} (${c.year ?? "?"})`, h("span", { class: "muted small" }, ` · ${c.kind}`)),
        c.overview ? h("span", { class: "muted small cand-ov" }, c.overview) : null))));
        body.push(h("button", { class: "btn btn-ghost small", onClick: () => apply(opDrop((x) => x.id === r.id), `cancel request ${r.title}`) }, "None of these"));
      } else if (r.status === "picked") {
        const c = (r.candidates || []).find((x) => r.pick && x.id === r.pick.id && x.kind === r.pick.kind);
        body.push(h("p", { class: "muted small" }, c ? `Will add ${c.title} (${c.year}) on the next run.` : "Will be added on the next run."));
      } else if (r.result) body.push(h("p", { class: "small" + (r.status === "error" ? " error-text" : " muted") }, r.result));
      const actions = [];
      if (r.status === "queued") actions.push(h("button", { class: "btn btn-ghost small", onClick: () => apply(opDrop((x) => x.id === r.id), `cancel request ${r.title}`) }, "Cancel"));
      if (r.status === "error" || r.status === "not-found") actions.push(h("button", { class: "btn btn-ghost small", onClick: () =>
        apply(opPatch(r.id, { status: "queued", result: "", candidates: [], pick: null }), `retry request ${r.title}`) }, "Retry"));
      return h("li", { class: "req" }, head,
        h("div", { class: "muted small" }, `${String(r.requestedAt || "").slice(0, 10)}${kind}${r.quality === "4k" ? " · 4K" : ""}`),
        body, actions.length ? h("div", { class: "row" }, actions) : null);
    }

    draw();
  },
};
