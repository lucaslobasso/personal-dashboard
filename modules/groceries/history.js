// groceries-history: past purchases (data/history/YYYY-MM-DD.json), newest first. Read-only.
// Options: limit (how many purchases to list, default 8).
import { h, empty, errorBox } from "../../core/ui.js";
import { ars } from "./format.js";

export default {
  type: "groceries-history",
  title: "Past purchases",
  watch: ["data/pending.json"], // Mark bought changes pending + writes history in one commit

  async load(ctx, opts) {
    const files = (await ctx.gh.listDir("data/history")).filter((f) => f.type === "file" && f.name.endsWith(".json"));
    return files.sort((a, b) => b.name.localeCompare(a.name)).slice(0, opts.limit || 8);
  },

  render(el, files, ctx) {
    if (!files.length) {
      el.append(empty("No purchases recorded yet.", "After checking out, tell Claude what arrived (/bought)."));
      return;
    }
    el.append(h("div", { class: "history" }, files.map((f) => {
      const body = h("div", { class: "loading" }, "Loading…");
      const d = h("details", {}, h("summary", {}, f.name.replace(/\.json$/, "")), body);
      d.addEventListener("toggle", async () => {
        if (!d.open || d.dataset.loaded) return;
        d.dataset.loaded = "1";
        try {
          const p = JSON.parse((await ctx.gh.getFile(f.path)).text);
          const bought = p.bought || [];
          const total = bought.reduce((s, b) => s + (Number(b.qty) || 0) * (Number(b.unitPrice) || 0), 0);
          body.replaceWith(h("div", {},
            h("ul", { class: "cart-lines" }, bought.map((b) => h("li", {},
              h("span", {}, `${b.productName || b.name} `, h("span", { class: "muted" }, `×${b.qty}`)),
              h("span", { class: "num" }, ars((Number(b.qty) || 0) * (Number(b.unitPrice) || 0)))))),
            total ? h("p", { class: "small" }, "Total ≈ ", h("strong", {}, ars(total))) : null,
            (p.missing || []).length ? h("p", { class: "muted small" }, "Missing: " + p.missing.map((m) => m.name).join(", ")) : null));
        } catch (e) {
          delete d.dataset.loaded;
          body.replaceChildren(errorBox(e));
        }
      });
      return d;
    })));
  },
};
