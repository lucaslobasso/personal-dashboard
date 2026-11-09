// media-summary (Today): requests that need you to pick, what's waiting, and recent results.
import { h } from "../../core/ui.js";
import { REQUESTS, parseRequests } from "./requests.js";

export default {
  type: "media-summary",
  title: "Movies & series",
  watch: [REQUESTS],

  async load(ctx) {
    return parseRequests((await ctx.gh.getFile(REQUESTS, { optional: true }))?.text);
  },

  render(el, list, ctx) {
    const choose = list.filter((r) => r.status === "choose");
    const waiting = list.filter((r) => r.status === "queued" || r.status === "picked");
    const recent = list.filter((r) => ["added", "exists", "not-found", "error"].includes(r.status))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 3);
    ctx.frame.setBadge(choose.length ? "pick needed" : "");
    if (choose.length) el.append(h("p", { class: "nudge small" }, `Pick the right match for: ${choose.map((r) => r.title).join(", ")}`));
    if (waiting.length) el.append(h("p", { class: "muted small" }, `Waiting for the PC: ${waiting.map((r) => r.title).join(", ")}`));
    if (recent.length) el.append(h("ul", { class: "weak" }, recent.map((r) => h("li", { class: "small" }, r.result || `${r.title}: ${r.status}`))));
    if (!list.length) el.append(h("p", { class: "muted small" }, "Nothing requested."));
    el.append(h("a", { class: "btn" + (choose.length ? " btn-primary" : ""), href: "#/media" }, choose.length ? "Pick now" : "Request something"));
  },
};
