// groceries-summary (Today): what's pending, days since the last delivery (with a nudge when it's
// been a while), and the cart's state with the right next step. Options: cadenceDays (default 14).
import { h, daysFrom, extLink } from "../../core/ui.js";
import { parsePending, ars } from "./format.js";
import { askCart } from "./cart.js";

export default {
  type: "groceries-summary",
  title: "Groceries",
  watch: ["data/pending.json", "data/cart.json"],

  async load(ctx) {
    const [p, c, hist] = await Promise.all([
      ctx.gh.getFile("data/pending.json", { optional: true }),
      ctx.gh.getFile("data/cart.json", { optional: true }),
      ctx.gh.listDir("data/history"),
    ]);
    let cart = {};
    try { cart = c?.text?.trim() ? JSON.parse(c.text) : {}; } catch { /* shown as no cart */ }
    const last = hist.map((f) => f.name).filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort().pop();
    return { pending: parsePending(p?.text), cart, lastDelivery: last?.slice(0, 10) || null };
  },

  render(el, { pending, cart, lastDelivery }, ctx, opts) {
    const cadence = opts.cadenceDays ?? 14;
    const since = daysFrom(lastDelivery);
    ctx.frame.setBadge(pending.length ? String(pending.length) : "");
    const names = pending.slice(0, 6).map((p) => p.name).join(", ") + (pending.length > 6 ? ` +${pending.length - 6}` : "");
    el.append(h("div", { class: "summary-row" },
      h("div", {},
        h("div", { class: "tile-value" }, pending.length ? `${pending.length} to buy` : "List empty"),
        pending.length ? h("div", { class: "muted small" }, names) : null),
      h("a", { class: "btn", href: "#/groceries" }, "Open list")));
    el.append(h("p", { class: "small" + (since != null && since >= cadence ? " nudge" : " muted") },
      since == null ? "No delivery recorded yet." : since >= cadence ? `${since} days since the last delivery: time to shop?` : `Last delivery ${since === 0 ? "today" : `${since} day${since === 1 ? "" : "s"} ago`}.`));
    if (cart.url) {
      el.append(h("div", { class: "row" }, h("span", { class: "small" }, `Cart ready · ${ars(cart.estimatedTotal)}`), extLink(cart.url, "Open on Josimar ↗", "btn btn-primary")));
    } else if (pending.length && since != null && since >= cadence - 2) {
      el.append(h("div", { class: "row" }, h("button", { class: "btn btn-primary", onClick: askCart }, "Ask Claude to build the cart")));
    }
  },
};
