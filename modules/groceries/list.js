// groceries-list: view and edit data/pending.json (add / edit qty, unit, note / remove).
// Building the cart and recording purchases stay with Claude (/cart, /bought).
import { h, select, empty } from "../../core/ui.js";
import { track } from "../../core/github.js";
import { parsePending, formatPending, slugify, today, fmtQty, opAdd, opEdit, opRemove, UNITS } from "./format.js";

const PENDING = "data/pending.json";
const CART = "data/cart.json";
const UNDO_MS = 5000;

const parseQty = (s) => parseFloat(String(s).trim().replace(",", "."));

export default {
  type: "groceries-list",
  title: "Groceries",
  watch: [PENDING],

  async load(ctx) {
    const f = await ctx.gh.getFile(PENDING, { optional: true });
    return parsePending(f?.text);
  },

  render(el, initial, ctx) {
    let items = initial;
    let inflight = 0;
    let editing = null;          // id of the row in edit mode
    const hidden = new Map();    // id -> undo timer, for removals not committed yet

    // ---- add form ----
    const name = h("input", { class: "input grow", placeholder: "Add item…", "aria-label": "Item", required: true, autocomplete: "off" });
    const qty = h("input", { class: "input qty", value: "1", inputmode: "decimal", "aria-label": "Quantity", autocomplete: "off" });
    const unit = select(UNITS.map((u) => [u, u]), "un", { class: "input unit", "aria-label": "Unit" });
    const note = h("input", { class: "input grow", placeholder: "Note: brand, size… (optional)", "aria-label": "Note", autocomplete: "off" });
    const form = h("form", { class: "add-form", onSubmit: onAdd },
      h("div", { class: "row" }, name, qty, unit),
      h("div", { class: "row" }, note, h("button", { class: "btn btn-primary", type: "submit" }, "Add")));
    const list = h("ul", { class: "grocery-list" });
    el.append(form, list);

    function onAdd(e) {
      e.preventDefault();
      const n = name.value.trim();
      const q = parseQty(qty.value);
      if (!n) return name.focus();
      if (!(q > 0)) return ctx.toast("Quantity must be a number above 0.", { error: true });
      const item = { id: slugify(n), name: n, qty: q, unit: unit.value, note: note.value.trim(), addedAt: today() };
      const existing = items.find((x) => x.id === item.id && !hidden.has(x.id));
      if (existing && !confirm(`"${existing.name}" is already on the list (${fmtQty(existing)}). Set it to ${fmtQty(item)}?`)) return;
      apply(opAdd(item), existing ? `set ${existing.name} to ${fmtQty(item)}` : `add ${n}`);
      form.reset();
      qty.value = "1";
      unit.value = "un";
      name.focus();
    }

    // ---- writes ----
    function apply(op, label) {
      items = op(items); // optimistic
      draw();
      inflight++;
      ctx.gh.updateFile(PENDING, (text) => formatPending(op(parsePending(text))), `sync: ${today()} pending.json\n\ndashboard: ${label}`)
        .then(async (r) => {
          inflight--;
          if (inflight === 0 && r.text != null) { items = parsePending(r.text); draw(); }
          if (r.changed) {
            ctx.changed(PENDING);
            await resetCart();
          }
        })
        .catch((e) => {
          inflight--;
          ctx.toast(`Couldn't save "${label}": ${e.message}`, { error: true });
          ctx.refresh();
        });
    }

    // Like /remove step 4: a list change makes a built cart stale, so clear it.
    async function resetCart() {
      const r = await ctx.gh.updateFile(CART, (text) => {
        try { return JSON.parse(text || "{}")?.url ? "{}\n" : null; } catch { return null; }
      }, `sync: ${today()} cart.json\n\ndashboard: list changed, cart needs rebuilding`);
      if (r.changed) {
        ctx.changed(CART);
        ctx.toast("The saved cart was cleared because the list changed. Ask Claude to rebuild it (/cart).");
      }
    }

    function remove(it) {
      editing = null;
      track(1);
      const timer = setTimeout(() => {
        hidden.delete(it.id);
        track(-1);
        apply(opRemove(it.id), `remove ${it.name}`);
      }, UNDO_MS);
      hidden.set(it.id, timer);
      draw();
      ctx.toast(`Removed ${it.name}`, {
        action: "Undo", timeout: UNDO_MS,
        onAction: () => { clearTimeout(timer); hidden.delete(it.id); track(-1); draw(); },
      });
    }

    // ---- rendering ----
    function draw() {
      const visible = items.filter((x) => !hidden.has(x.id));
      ctx.frame.setBadge(visible.length ? String(visible.length) : "");
      list.replaceChildren(...visible.map((it) => (it.id === editing ? editRow(it) : viewRow(it))));
      if (!visible.length) list.append(h("li", { class: "plain" }, empty("Nothing pending.", "Add items here, or tell Claude “anotá …”.")));
    }

    function viewRow(it) {
      return h("li", { class: "g-row" },
        h("button", { class: "g-main", title: "Edit", onClick: () => { editing = it.id; draw(); } },
          h("span", { class: "g-name" }, it.name),
          it.note ? h("span", { class: "g-note" }, it.note) : null),
        h("span", { class: "chip" }, fmtQty(it)),
        h("button", { class: "btn btn-icon", title: `Remove ${it.name}`, "aria-label": `Remove ${it.name}`, onClick: () => remove(it) }, "×"));
    }

    function editRow(it) {
      const q = h("input", { class: "input qty", value: String(it.qty), inputmode: "decimal", "aria-label": "Quantity" });
      const u = select(UNITS.map((x) => [x, x]), it.unit || "un", { class: "input unit", "aria-label": "Unit" });
      const n = h("input", { class: "input grow", value: it.note || "", placeholder: "Note", "aria-label": "Note" });
      const save = (e) => {
        e.preventDefault();
        const qv = parseQty(q.value);
        if (!(qv > 0)) return ctx.toast("Quantity must be a number above 0.", { error: true });
        const patch = { qty: qv, unit: u.value, note: n.value.trim() };
        editing = null;
        if (patch.qty === it.qty && patch.unit === it.unit && patch.note === (it.note || "")) return draw();
        apply(opEdit(it.id, patch), `edit ${it.name}`);
      };
      const row = h("li", { class: "g-row editing" },
        h("form", { class: "edit-form", onSubmit: save },
          h("span", { class: "g-name" }, it.name),
          h("div", { class: "row" }, q, u, n),
          h("div", { class: "row end" },
            h("button", { class: "btn", type: "button", onClick: () => { editing = null; draw(); } }, "Cancel"),
            h("button", { class: "btn btn-primary", type: "submit" }, "Save"))));
      queueMicrotask(() => q.focus());
      return row;
    }

    draw();
  },
};
