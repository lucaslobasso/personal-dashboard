// groceries-cart: the last cart Claude built (data/cart.json). Read-only.
import { h, extLink, empty } from "../../core/ui.js";
import { ars } from "./format.js";

const CART = "data/cart.json";

export default {
  type: "groceries-cart",
  title: "Cart",
  watch: [CART],

  async load(ctx) {
    const f = await ctx.gh.getFile(CART, { optional: true });
    try { return f?.text?.trim() ? JSON.parse(f.text) : {}; } catch { throw new Error("data/cart.json is not valid JSON."); }
  },

  render(el, cart) {
    if (!cart.url) {
      el.append(empty("No cart built.", "When the list is ready, ask Claude: “armá el carrito” (/cart)."));
      return;
    }
    const lines = cart.lines || [];
    const skipped = cart.skipped || [];
    el.append(
      h("div", { class: "cart-head" },
        h("div", {},
          h("div", { class: "tile-value" }, ars(cart.estimatedTotal)),
          h("div", { class: "muted small" }, `est. · ${lines.length} line${lines.length === 1 ? "" : "s"} · built ${String(cart.builtAt || "").slice(0, 10)}`)),
        extLink(cart.url, "Open cart on Josimar ↗", "btn btn-primary")),
      h("details", {},
        h("summary", {}, "Lines"),
        h("ul", { class: "cart-lines" }, lines.map((l) => h("li", {},
          h("span", {}, `${l.productName} `, h("span", { class: "muted" }, `×${l.qty}`)),
          h("span", { class: "num" }, ars(l.lineTotal)))))),
      skipped.length ? h("div", { class: "skipped" },
        h("h4", {}, `Skipped (${skipped.length})`),
        h("ul", {}, skipped.map((s) => h("li", {}, `${s.id}: `, h("span", { class: "muted" }, s.reason || ""))))) : null,
      h("p", { class: "muted small" }, "Prices are estimates; you check out on Josimar yourself."));
  },
};
