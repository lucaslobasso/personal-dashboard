// groceries-list: view and edit data/pending.json (add / edit qty, unit, note / remove), plus
// one-tap "usual items" (pinned in data/usual.json, or bought before per data/history/).
// Building the cart stays with Claude (/cart); marking bought lives in the cart widget.
import { h, select, empty } from "../../core/ui.js";
import { track, syncMessage } from "../../core/github.js";
import { parsePending, formatPending, slugify, today, fmtQty, opAdd, opEdit, opRemove, UNITS,
  parseUsual, formatUsual, rankUsual } from "./format.js";

const PENDING = "data/pending.json";
const CART = "data/cart.json";
const USUAL = "data/usual.json";
const UNDO_MS = 5000;
const HISTORY_FILES = 12;

const parseQty = (s) => parseFloat(String(s).trim().replace(",", "."));

/** Last purchases (for usual items). Shared with the summary widget. */
export async function loadHistories(gh, n = HISTORY_FILES) {
  const files = (await gh.listDir("data/history")).filter((f) => f.type === "file" && /^\d{4}-\d{2}-\d{2}\.json$/.test(f.name))
    .sort((a, b) => b.name.localeCompare(a.name)).slice(0, n);
  const out = await Promise.all(files.map(async (f) => {
    try { return { date: f.name.slice(0, 10), ...JSON.parse((await gh.getFile(f.path)).text) }; } catch { return null; }
  }));
  return out.filter(Boolean);
}

// Like /remove step 4: a list change makes a built cart stale, so clear it in the same commit.
const cartReset = { path: CART, mutate: (text) => { try { return JSON.parse(text || "{}")?.url ? "{}\n" : null; } catch { return null; } } };

export default {
  type: "groceries-list",
  title: "Groceries",
  watch: [PENDING, USUAL],

  async load(ctx, opts) {
    const [p, u, histories] = await Promise.all([
      ctx.gh.getFile(PENDING, { optional: true }),
      ctx.gh.getFile(USUAL, { optional: true }),
      opts.usual === false ? [] : loadHistories(ctx.gh).catch(() => []),
    ]);
    return { items: parsePending(p?.text), usual: parseUsual(u?.text), histories };
  },

  render(el, data, ctx, opts) {
    let { items, usual } = data;
    const { histories } = data;
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
    const chips = h("div", { class: "usual", "aria-label": "Usual items" });
    const list = h("ul", { class: "grocery-list" });
    el.append(form, chips, list);

    function add(item, verb = "add") {
      const existing = items.find((x) => x.id === item.id && !hidden.has(x.id));
      if (existing && !confirm(`"${existing.name}" is already on the list (${fmtQty(existing)}). Set it to ${fmtQty(item)}?`)) return false;
      apply(opAdd(item), existing ? `set ${existing.name} to ${fmtQty(item)}` : `${verb} ${item.name}`);
      return true;
    }

    function onAdd(e) {
      e.preventDefault();
      const n = name.value.trim();
      const q = parseQty(qty.value);
      if (!n) return name.focus();
      if (!(q > 0)) return ctx.toast("Quantity must be a number above 0.", { error: true });
      if (!add({ id: slugify(n), name: n, qty: q, unit: unit.value, note: note.value.trim(), addedAt: today() })) return;
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
      ctx.gh.commitFiles([{ path: PENDING, mutate: (text) => formatPending(op(parsePending(text))) }, cartReset], syncMessage(today(), label))
        .then((r) => {
          inflight--;
          if (inflight === 0 && r.texts[PENDING] != null) { items = parsePending(r.texts[PENDING]); draw(); }
          if (r.changed) {
            ctx.changed(PENDING);
            if (r.texts[CART] === "{}\n") ctx.changed(CART);
          }
        })
        .catch((e) => {
          inflight--;
          ctx.toast(`Couldn't save "${label}": ${e.message}`, { error: true });
          ctx.refresh();
        });
    }

    function togglePin(it) {
      const id = it.id;
      const pinned = usual.some((u) => slugify(u.name) === id);
      const next = (list) => (pinned ? list.filter((u) => slugify(u.name) !== id) : [...list.filter((u) => slugify(u.name) !== id),
        { name: it.name, qty: it.qty, unit: it.unit || "un", note: it.note || "" }]);
      usual = next(usual);
      draw();
      ctx.gh.commitFiles([{ path: USUAL, mutate: (text) => formatUsual(next(parseUsual(text))) }],
        syncMessage(today(), `${pinned ? "unpin" : "pin"} ${it.name} as usual`))
        .then((r) => { if (r.texts[USUAL] != null) usual = parseUsual(r.texts[USUAL]); draw(); })
        .catch((e) => { ctx.toast(`Couldn't save: ${e.message}`, { error: true }); ctx.refresh(); });
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
      const ranked = opts.usual === false ? [] : rankUsual(usual, histories, visible);
      chips.replaceChildren(...ranked.map((u) => h("button", {
        class: "chip chip-add" + (u.pinned ? " pinned" : ""), type: "button",
        title: `Add ${u.name} (${fmtQty(u)}${u.note ? ", " + u.note : ""})`,
        onClick: () => add({ id: slugify(u.name), name: u.name, qty: u.qty || 1, unit: u.unit || "un", note: u.note || "", addedAt: today() }, "add usual"),
      }, "+ ", u.name)));
      chips.hidden = !ranked.length;
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
      const pinned = usual.some((x) => slugify(x.name) === it.id);
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
            h("button", { class: "btn btn-ghost pin", type: "button", "aria-pressed": String(pinned), title: "Show as a one-tap usual item",
              onClick: () => togglePin(it) }, pinned ? "★ Usual" : "☆ Usual"),
            h("button", { class: "btn", type: "button", onClick: () => { editing = null; draw(); } }, "Cancel"),
            h("button", { class: "btn btn-primary", type: "submit" }, "Save"))));
      queueMicrotask(() => q.focus());
      return row;
    }

    draw();
  },
};
