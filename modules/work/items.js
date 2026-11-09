// work-items: tasks, tickets and deadlines from personal-work data/items.json.
// Sections: Overdue / This week / Doing / Next / Low priority / Done (last 7 days).
// Options: compact (true = only overdue, this week and doing; used on Today).
import { h, select, empty, today, daysFrom, extLink } from "../../core/ui.js";
import { track, syncMessage } from "../../core/github.js";
import { ITEMS, KINDS, PRIORITIES, STATUSES, NEXT_STATUS, parseRows, formatRows, ITEM_KEYS, opAddItem, opUpdateItem, opRemoveItem, sections } from "./format.js";

const UNDO_MS = 5000;
const STATUS_ICON = { todo: "○", doing: "◐", waiting: "⏸", done: "●" };
const TITLES = { overdue: "Overdue", week: "This week", doing: "Doing", next: "Next", low: "Low priority", done: "Done (last 7 days)" };

function dueLabel(it) {
  if (!it.due) return null;
  const d = -daysFrom(it.due);
  const txt = d < 0 ? `${-d}d overdue` : d === 0 ? "today" : d === 1 ? "tomorrow" : d < 7 ? new Date(it.due + "T12:00").toLocaleDateString(undefined, { weekday: "short" }) : it.due.slice(5);
  return h("span", { class: "chip" + (d < 0 ? " chip-bad" : d <= 1 ? " chip-warn" : "") }, txt);
}

export default {
  type: "work-items",
  title: "Work",
  watch: [ITEMS],

  async load(ctx) {
    return parseRows((await ctx.gh.getFile(ITEMS, { optional: true }))?.text);
  },

  render(el, initial, ctx, opts) {
    let items = initial;
    let editing = null;
    let inflight = 0;
    const hidden = new Map();

    const title = h("input", { class: "input grow", placeholder: "Add a task, ticket or deadline…", "aria-label": "Title", autocomplete: "off", required: true });
    const due = h("input", { class: "input", type: "date", "aria-label": "Due date" });
    const prio = select(PRIORITIES.map((p) => [p, p]), "normal", { class: "input", "aria-label": "Priority" });
    const kind = select(KINDS.map((k) => [k, k]), "task", { class: "input", "aria-label": "Kind" });
    const project = h("input", { class: "input", placeholder: "Project", "aria-label": "Project", list: "work-projects", autocomplete: "off" });
    const projects = h("datalist", { id: "work-projects" });
    const form = h("form", { class: "add-form", onSubmit: add },
      h("div", { class: "row" }, title),
      opts.compact ? null : h("div", { class: "row two" }, kind, prio, due, project),
      h("div", { class: "row end" }, h("button", { class: "btn btn-primary", type: "submit" }, "Add")), projects);
    const body = h("div", { class: "work-sections" });
    el.append(form, body);

    function apply(op, label) {
      items = op(items);
      draw();
      inflight++;
      ctx.gh.commitFiles([{ path: ITEMS, mutate: (t) => formatRows(op(parseRows(t)), ITEM_KEYS) }], syncMessage(today(), label))
        .then((r) => { inflight--; if (!inflight && r.texts[ITEMS] != null) { items = parseRows(r.texts[ITEMS]); draw(); } ctx.changed(ITEMS); })
        .catch((e) => { inflight--; ctx.toast(`Couldn't save: ${e.message}`, { error: true }); ctx.refresh(); });
    }

    function add(e) {
      e.preventDefault();
      const t = title.value.trim();
      if (!t) return title.focus();
      apply(opAddItem({ title: t, kind: kind.value, priority: prio.value, due: due.value || null, project: project.value.trim() }), `add ${t}`);
      title.value = ""; due.value = ""; prio.value = "normal"; kind.value = "task";
      title.focus();
    }

    function remove(it) {
      editing = null;
      track(1);
      const timer = setTimeout(() => { hidden.delete(it.id); track(-1); apply(opRemoveItem(it.id), `remove ${it.title}`); }, UNDO_MS);
      hidden.set(it.id, timer);
      draw();
      ctx.toast(`Removed ${it.title}`, { action: "Undo", timeout: UNDO_MS, onAction: () => { clearTimeout(timer); hidden.delete(it.id); track(-1); draw(); } });
    }

    function draw() {
      const visible = items.filter((x) => !hidden.has(x.id));
      projects.replaceChildren(...[...new Set(visible.map((x) => x.project).filter(Boolean))].map((p) => h("option", { value: p })));
      const s = sections(visible);
      const open = visible.filter((x) => x.status !== "done").length;
      ctx.frame.setBadge(s.overdue.length ? `${s.overdue.length} overdue` : open ? String(open) : "");
      const keys = opts.compact ? ["overdue", "week", "doing"] : ["overdue", "week", "doing", "next", "low", "done"];
      body.replaceChildren(...keys.filter((k) => s[k].length).map((k) => {
        const ul = h("ul", { class: "work-list" }, s[k].map((it) => (it.id === editing ? editRow(it) : row(it))));
        return ["low", "done"].includes(k)
          ? h("details", { class: "work-sec" }, h("summary", {}, `${TITLES[k]} (${s[k].length})`), ul)
          : h("section", { class: "work-sec" + (k === "overdue" ? " sec-bad" : "") }, h("h3", {}, TITLES[k]), ul);
      }));
      if (!body.childNodes.length) body.append(empty(opts.compact ? "Nothing due this week." : "No work items yet.", "Add one above, or tell Claude in personal-work: /task …"));
    }

    function row(it) {
      return h("li", { class: "w-row" + (it.status === "done" ? " done" : "") },
        h("button", { class: `w-status st-${it.status}`, title: `${it.status} → ${NEXT_STATUS[it.status]}`, "aria-label": `Status ${it.status}, change to ${NEXT_STATUS[it.status]}`,
          onClick: () => apply(opUpdateItem(it.id, { status: NEXT_STATUS[it.status] }), `${it.title}: ${NEXT_STATUS[it.status]}`) }, STATUS_ICON[it.status]),
        h("button", { class: "g-main", title: "Edit", onClick: () => { editing = it.id; draw(); } },
          h("span", { class: "g-name" }, it.title, it.priority === "high" ? h("span", { class: "prio-high", title: "high priority" }, " !") : null),
          h("span", { class: "g-note" }, [it.kind !== "task" ? it.kind : null, it.project, it.status === "waiting" ? "waiting" : null].filter(Boolean).join(" · "))),
        it.ref && /^https:\/\//.test(it.ref) ? extLink(it.ref, "↗", "btn btn-icon") : it.ref ? h("span", { class: "muted small" }, it.ref) : null,
        it.status !== "done" ? dueLabel(it) : null);
    }

    function editRow(it) {
      const t = h("input", { class: "input grow", value: it.title, "aria-label": "Title" });
      const d = h("input", { class: "input", type: "date", value: it.due || "", "aria-label": "Due date" });
      const p = select(PRIORITIES.map((x) => [x, x]), it.priority, { class: "input", "aria-label": "Priority" });
      const st = select(STATUSES.map((x) => [x, x]), it.status, { class: "input", "aria-label": "Status" });
      const k = select(KINDS.map((x) => [x, x]), it.kind, { class: "input", "aria-label": "Kind" });
      const pr = h("input", { class: "input", value: it.project || "", placeholder: "Project", list: "work-projects", "aria-label": "Project" });
      const ref = h("input", { class: "input grow", value: it.ref || "", placeholder: "Ticket key or https link", "aria-label": "Reference" });
      const notes = h("input", { class: "input grow", value: it.notes || "", placeholder: "Notes", "aria-label": "Notes" });
      const save = (e) => {
        e.preventDefault();
        const patch = { title: t.value.trim() || it.title, due: d.value || null, priority: p.value, status: st.value, kind: k.value, project: pr.value.trim(), ref: ref.value.trim(), notes: notes.value.trim() };
        editing = null;
        if (Object.entries(patch).every(([key, v]) => (it[key] ?? null) === v || (it[key] ?? "") === v)) return draw();
        apply(opUpdateItem(it.id, patch), `edit ${it.title}`);
      };
      queueMicrotask(() => t.focus());
      return h("li", { class: "w-row editing" }, h("form", { class: "edit-form", onSubmit: save },
        h("div", { class: "row" }, t), h("div", { class: "row" }, st, p, k, d), h("div", { class: "row" }, pr, ref), h("div", { class: "row" }, notes),
        h("div", { class: "row end" },
          h("button", { class: "btn btn-ghost btn-danger", type: "button", onClick: () => remove(it) }, "Delete"),
          h("button", { class: "btn", type: "button", onClick: () => { editing = null; draw(); } }, "Cancel"),
          h("button", { class: "btn btn-primary", type: "submit" }, "Save"))));
    }

    draw();
  },
};
