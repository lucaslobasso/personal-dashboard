// japanese-due (Today): cards due, a link to start reviewing, and the "Ask sensei" list from the
// latest session log (sessions/YYYY-MM-DD.md, written by Claude's /log-lesson). Read-only.
import { h, empty } from "../../core/ui.js";
import { loadAll, due, FILES } from "./data.js";

/** Bullets under "## Ask sensei" in a session log, skipping placeholders like "(none yet)". */
export function askSensei(md) {
  const out = [];
  let inSec = false;
  for (const line of String(md).split(/\r?\n/)) {
    if (/^##\s/.test(line)) { inSec = /^##\s+ask sensei/i.test(line); continue; }
    const m = inSec && /^\s*[-*]\s+(?:\[[ x]\]\s*)?(.+)$/.exec(line);
    if (m && !/^\(.*\)$/.test(m[1].trim())) out.push(m[1].trim());
  }
  return out;
}

export default {
  type: "japanese-due",
  title: "Japanese",
  watch: FILES.map((f) => `data/${f}.yaml`),

  async load(ctx) {
    const [all, sessions] = await Promise.all([loadAll(ctx.gh), ctx.gh.listDir("sessions").catch(() => [])]);
    const latest = sessions.filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f.name)).sort((a, b) => b.name.localeCompare(a.name))[0];
    const md = latest ? (await ctx.gh.getFile(latest.path, { optional: true }))?.text || "" : "";
    return { all, ask: askSensei(md), session: latest?.name.slice(0, 10) };
  },

  render(el, { all, ask, session }, ctx, opts) {
    const c = due(all, 0, "review");
    ctx.frame.setBadge(c.due ? `${c.due} due` : "");
    el.append(h("div", { class: "summary-row" },
      h("div", {}, h("div", { class: "tile-value" }, c.due ? `${c.due} due` : "All caught up"),
        h("div", { class: "muted small" }, `${c.fresh.toLocaleString()} not practiced yet`)),
      h("a", { class: "btn btn-primary", href: opts.reviewPage || "#/japanese" }, c.due ? "Review now" : "Practice")));
    if (ask.length) {
      el.append(h("h3", {}, `Ask sensei${session ? ` · from ${session}` : ""}`), h("ul", { class: "ask" }, ask.map((q) => h("li", { lang: "ja" }, q))));
    } else if (session) {
      el.append(h("p", { class: "muted small" }, `No open questions for sensei (last lesson log ${session}).`));
    }
    if (!all.length) el.replaceChildren(empty("No study data found."));
  },
};
