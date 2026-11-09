// "Mark bought" panel: the dashboard's /bought. Tick what arrived; only those leave the list,
// the rest stays pending and is recorded as missing. One atomic commit: history, pending,
// products (confirm bought SKUs) and cart reset. Partial quantities stay with Claude's /bought.
import { h, today } from "../../core/ui.js";
import { syncMessage } from "../../core/github.js";
import { boughtChanges, fmtQty, ars } from "./format.js";

/**
 * cart: parsed cart.json ({} when none), pending: parsed pending.json.
 * onDone(): called after a successful commit.
 */
export function boughtPanel(ctx, cart, pending, onDone, onCancel) {
  const byId = new Map(pending.map((p) => [p.id, p]));
  const rows = [];
  if (cart.url) {
    for (const l of cart.lines || []) {
      rows.push({ id: l.id, name: byId.get(l.id)?.name || l.id, label: l.productName, sub: `×${l.qty} · ${ars(l.lineTotal)}`,
        checked: true, line: { id: l.id, name: byId.get(l.id)?.name || l.id, sku: l.sku, productName: l.productName, qty: l.qty, unitPrice: l.unitPrice } });
    }
    const inCart = new Set((cart.lines || []).map((l) => l.id));
    for (const p of pending.filter((x) => !inCart.has(x.id))) {
      const skip = (cart.skipped || []).find((s) => s.id === p.id);
      rows.push({ id: p.id, name: p.name, label: p.name, sub: skip ? `not in cart: ${skip.reason}` : "not in cart", checked: false,
        reason: skip?.reason || "not in cart", line: { id: p.id, name: p.name, qty: p.qty } });
    }
  } else {
    for (const p of pending) rows.push({ id: p.id, name: p.name, label: p.name, sub: fmtQty(p) + (p.note ? ` · ${p.note}` : ""), checked: false,
      reason: "not bought", line: { id: p.id, name: p.name, qty: p.qty } });
  }

  const boxes = rows.map((r) => h("input", { type: "checkbox", checked: r.checked, "aria-label": `Bought ${r.label}` }));
  const count = h("span");
  const go = h("button", { class: "btn btn-primary", type: "submit" }, "Mark bought");
  const refresh = () => {
    const n = boxes.filter((b) => b.checked).length;
    count.textContent = `${n} of ${rows.length}`;
    go.disabled = n === 0;
  };
  boxes.forEach((b) => b.addEventListener("change", refresh));

  async function submit(e) {
    e.preventDefault();
    const bought = rows.filter((_, i) => boxes[i].checked).map((r) => r.line);
    const missing = rows.filter((r, i) => !boxes[i].checked).map((r) => ({ name: r.name, reason: r.reason || "not delivered" }));
    go.disabled = true;
    go.textContent = "Saving…";
    try {
      await ctx.gh.commitFiles(boughtChanges({ date: today(), bought, missing }),
        syncMessage(today(), `bought ${bought.length}${missing.length ? `, ${missing.length} still pending` : ""}`));
      ctx.toast(`Recorded ${bought.length} bought.${missing.length ? ` ${missing.length} stay on the list.` : ""}`);
      ctx.changed("data/pending.json");
      onDone();
    } catch (err) {
      ctx.toast(`Couldn't save: ${err.message}`, { error: true });
      go.disabled = false;
      go.textContent = "Mark bought";
    }
  }

  refresh();
  return h("form", { class: "bought", onSubmit: submit },
    h("p", { class: "muted small" }, cart.url
      ? "Untick anything that didn't arrive: it stays on the list for next time."
      : "No cart was built: tick what you bought."),
    h("ul", { class: "bought-list" }, rows.map((r, i) => h("li", {},
      h("label", {}, boxes[i], h("span", { class: "bought-main" }, h("span", {}, r.label), h("span", { class: "muted small" }, r.sub)))))),
    h("p", { class: "muted small" }, "Got a partial amount? Use /bought in Claude for that."),
    h("div", { class: "row end" }, count, h("button", { class: "btn", type: "button", onClick: onCancel }, "Cancel"), go));
}
