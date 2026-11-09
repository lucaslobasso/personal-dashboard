// japanese-stats: progress overview, ported from study.py `stats` (+ is_due). Read-only.
// Options: weakest (how many weak items to list, default 8), lessons (show per-lesson bars, default true).
import { h } from "../../core/ui.js";
import { loadAll, lesson, isDue, errRate, FILES, STATUSES } from "./data.js";

const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);

function stackedBar(c, label) {
  const total = c.new + c.learning + c.known;
  const bar = h("div", { class: "stack-bar", role: "img", "aria-label": `${label}: ${c.known} known, ${c.learning} learning, ${c.new} new` });
  for (const s of ["known", "learning", "new"]) {
    if (!c[s]) continue;
    const seg = h("span", { class: `seg seg-${s}`, title: `${label} · ${s}: ${c[s]} (${pct(c[s], total)}%)` });
    seg.style.flexGrow = String(c[s]); // CSSOM, allowed by the CSP (no inline style attributes)
    bar.append(seg);
  }
  return bar;
}

export default {
  type: "japanese-stats",
  title: "Study progress",
  watch: FILES.map((f) => `data/${f}.yaml`),

  async load(ctx) {
    return loadAll(ctx.gh);
  },

  render(el, all, ctx, opts) {
    const count = (xs) => {
      const c = { total: xs.length, new: 0, learning: 0, known: 0, due: 0 };
      for (const { item } of xs) {
        const s = STATUSES.includes(item.status) ? item.status : "new";
        c[s]++;
        if (isDue(item)) c.due++;
      }
      return c;
    };
    const perFile = FILES.map((f) => [f, count(all.filter((x) => x.file === f))]).filter(([, c]) => c.total);
    const tot = count(all);

    el.append(
      h("div", { class: "tiles" },
        tile("Due now", tot.due),
        tile("Known", tot.known, `${pct(tot.known, tot.total)}%`),
        tile("Learning", tot.learning),
        tile("Total", tot.total)),
      h("div", { class: "legend", "aria-hidden": "true" },
        ["known", "learning", "new"].map((s) => h("span", {}, h("i", { class: `swatch seg-${s}` }), s))),
      h("div", { class: "bars" }, perFile.map(([f, c]) => h("div", { class: "bar-row" },
        h("span", { class: "bar-label" }, f), stackedBar(c, f), h("span", { class: "bar-value" }, c.total.toLocaleString())))),
      h("details", { class: "table-view" },
        h("summary", {}, "Table"),
        h("table", { class: "num-table" },
          h("thead", {}, h("tr", {}, ["", "total", "new", "learning", "known", "due"].map((t) => h("th", {}, t)))),
          h("tbody", {}, perFile.map(([f, c]) => h("tr", {}, h("th", {}, f), [c.total, c.new, c.learning, c.known, c.due].map((n) => h("td", {}, n.toLocaleString()))))))));

    const weakest = all.filter(({ item }) => (item.times_wrong || 0) > 0)
      .sort((a, b) => errRate(b.item) - errRate(a.item) || b.item.times_wrong - a.item.times_wrong)
      .slice(0, opts.weakest ?? 8);
    if (weakest.length) {
      el.append(h("h3", {}, "Weakest"), h("ul", { class: "weak" }, weakest.map(({ item }) => h("li", {},
        h("span", { lang: "ja" }, item.term), " ", h("span", { class: "muted" }, item.meaning || ""),
        h("span", { class: "muted small" }, ` ${item.times_wrong}/${item.times_seen} wrong`)))));
    }

    if (opts.lessons !== false) {
      const byLesson = new Map();
      for (const x of all) {
        const L = lesson(x.item);
        if (L < 999) (byLesson.get(L) || byLesson.set(L, []).get(L)).push(x);
      }
      const rows = [...byLesson.entries()].sort((a, b) => a[0] - b[0]).map(([L, xs]) => {
        const c = count(xs);
        return h("div", { class: "bar-row" }, h("span", { class: "bar-label" }, `L${L}`), stackedBar(c, `Lesson ${L}`),
          h("span", { class: "bar-value" }, `${pct(c.known + c.learning, c.total)}%`));
      });
      if (rows.length) el.append(h("details", { class: "lessons" },
        h("summary", {}, "By lesson (% studied)"), h("div", { class: "bars" }, rows)));
    }
  },
};

const tile = (label, value, sub) =>
  h("div", { class: "tile" }, h("span", { class: "tile-label" }, label), h("span", { class: "tile-value" }, value.toLocaleString()), sub && h("span", { class: "tile-sub" }, sub));
