// groceries-cart: the cart Claude built with /cart (data/cart.json), the handoff to ask Claude to
// build it, and "Mark bought" after delivery.
import { h, extLink, empty, handoff } from "../../core/ui.js";
import { ars, parsePending } from "./format.js";
import { boughtPanel } from "./bought.js";

const CART = "data/cart.json";
const PENDING = "data/pending.json";

export const askCart = () => handoff("/cart", { repo: "personal-groceries" });

export default {
  type: "groceries-cart",
  title: "Cart",
  watch: [CART, PENDING],

  async load(ctx) {
    const [c, p] = await Promise.all([ctx.gh.getFile(CART, { optional: true }), ctx.gh.getFile(PENDING, { optional: true })]);
    let cart;
    try { cart = c?.text?.trim() ? JSON.parse(c.text) : {}; } catch { throw new Error("data/cart.json is not valid JSON."); }
    return { cart, pending: parsePending(p?.text) };
  },

  render(el, { cart, pending }, ctx) {
    const show = (node) => el.replaceChildren(node);
    const markBought = h("button", { class: "btn", onClick: () => show(boughtPanel(ctx, cart, pending, () => ctx.refresh(), () => ctx.refresh())) }, "Mark bought…");

    if (!cart.url) {
      el.append(
        empty("No cart built.", pending.length ? `${pending.length} item${pending.length === 1 ? "" : "s"} on the list.` : "The list is empty."),
        h("div", { class: "row center" },
          pending.length ? h("button", { class: "btn btn-primary", onClick: askCart }, "Ask Claude to build the cart") : null,
          pending.length ? markBought : null),
        pending.length ? h("p", { class: "muted small center" }, "Claude matches each item on Josimar, asks about doubtful ones and gives you the cart link.") : null);
      return;
    }
    const lines = cart.lines || [];
    const skipped = cart.skipped || [];
    el.append(
      h("div", { class: "cart-head" },
        h("div", {},
          h("div", { class: "tile-value" }, ars(cart.estimatedTotal)),
          h("div", { class: "muted small" }, `est. · ${lines.length} line${lines.length === 1 ? "" : "s"} · built ${String(cart.builtAt || "").slice(0, 10)}`)),
        h("div", { class: "row" }, extLink(cart.url, "Open cart on Josimar ↗", "btn btn-primary"), markBought)),
      h("details", {},
        h("summary", {}, "Lines"),
        h("ul", { class: "cart-lines" }, lines.map((l) => h("li", {},
          h("span", {}, `${l.productName} `, h("span", { class: "muted" }, `×${l.qty}`)),
          h("span", { class: "num" }, ars(l.lineTotal)))))),
      skipped.length ? h("div", { class: "skipped" },
        h("h4", {}, `Skipped (${skipped.length})`),
        h("ul", {}, skipped.map((s) => h("li", {}, `${s.id}: `, h("span", { class: "muted" }, s.reason || ""))))) : null,
      h("p", { class: "muted small" }, "Prices are estimates; you check out on Josimar yourself. After delivery, Mark bought."));
  },
};
