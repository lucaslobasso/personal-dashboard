// work-hours: log hours and see this week (Mon–Sun) against a weekly target.
// Options: weeklyHours (target, default 40), compact (true = quick log + total only; used on Today).
import { h, today, empty } from "../../core/ui.js";
import { syncMessage } from "../../core/github.js";
import { hoursPath, HOUR_KEYS, parseRows, formatRows, opLogHours, opRemoveHours, weekStats, weekOf, parseHours } from "./format.js";

const fmt = (x) => (Math.round(x * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });

export async function loadWeek(gh, ymd = today()) {
  const { start, end } = weekOf(ymd);
  const months = [...new Set([hoursPath(start), hoursPath(end)])];
  const rows = (await Promise.all(months.map((p) => gh.getFile(p, { optional: true })))).flatMap((f) => parseRows(f?.text));
  const items = parseRows((await gh.getFile("data/items.json", { optional: true }))?.text);
  return { rows, projects: [...new Set([...rows.map((r) => r.project), ...items.map((i) => i.project)].filter(Boolean))] };
}

export function logForm(ctx, projects, onLogged) {
  const date = h("input", { class: "input", type: "date", value: today(), "aria-label": "Date" });
  const hours = h("input", { class: "input qty", inputmode: "decimal", placeholder: "h", "aria-label": "Hours", autocomplete: "off" });
  const project = h("input", { class: "input grow", placeholder: "Project", list: "hours-projects", "aria-label": "Project", autocomplete: "off", value: projects[0] || "" });
  const note = h("input", { class: "input grow", placeholder: "Note (optional)", "aria-label": "Note", autocomplete: "off" });
  async function submit(e) {
    e.preventDefault();
    const v = parseHours(hours.value);
    if (!(v > 0 && v <= 24)) return ctx.toast("Hours must be a number between 0 and 24.", { error: true });
    const row = { date: date.value || today(), hours: v, project: project.value.trim(), note: note.value.trim() };
    const path = hoursPath(row.date);
    hours.value = ""; note.value = "";
    try {
      await ctx.gh.commitFiles([{ path, mutate: (t) => formatRows(opLogHours(row)(parseRows(t)), HOUR_KEYS) }], syncMessage(today(), `log ${fmt(v)}h ${row.project}`));
      ctx.toast(`Logged ${fmt(v)} h${row.project ? " on " + row.project : ""}.`);
      ctx.changed(path);
      onLogged?.();
    } catch (err) { ctx.toast(`Couldn't save: ${err.message}`, { error: true }); }
  }
  return h("form", { class: "add-form", onSubmit: submit },
    h("div", { class: "row" }, hours, project, h("datalist", { id: "hours-projects" }, projects.map((p) => h("option", { value: p })))),
    h("div", { class: "row" }, date, note, h("button", { class: "btn btn-primary", type: "submit" }, "Log")));
}

export default {
  type: "work-hours",
  title: "Hours",
  get watch() { const { start, end } = weekOf(); return [...new Set([hoursPath(start), hoursPath(end)])]; },

  async load(ctx) {
    return loadWeek(ctx.gh);
  },

  render(el, { rows, projects }, ctx, opts) {
    const target = opts.weeklyHours ?? 40;
    const w = weekStats(rows);
    ctx.frame.setBadge(`${fmt(w.total)} / ${target} h`);
    el.append(logForm(ctx, projects, () => ctx.refresh()));
    const pct = Math.min(100, (w.total / target) * 100);
    const progress = h("div", { class: "meter", role: "img", "aria-label": `${fmt(w.total)} of ${target} hours this week` }, h("span", {}));
    progress.firstChild.style.width = `${pct}%`;
    el.append(h("div", { class: "hours-total" },
      h("span", { class: "tile-value" }, `${fmt(w.total)} h`), h("span", { class: "muted small" }, ` of ${target} this week · ${fmt(Math.max(0, target - w.total))} left`)), progress);
    if (opts.compact) return;

    // Mon–Sun bars: one series, so no legend; values labeled under each bar, hover shows the detail.
    const max = Math.max(8, ...w.days.map((d) => d.hours));
    const t = today();
    el.append(h("div", { class: "day-bars", role: "img", "aria-label": "Hours per day this week" }, w.days.map((d) => {
      const bar = h("span", { class: "day-bar", title: `${d.date}: ${fmt(d.hours)} h` });
      bar.style.height = `${(d.hours / max) * 100}%`;
      return h("div", { class: "day" + (d.date === t ? " today" : "") },
        h("div", { class: "day-track" }, bar),
        h("span", { class: "day-val" }, d.hours ? fmt(d.hours) : "–"),
        h("span", { class: "day-name" }, new Date(d.date + "T12:00").toLocaleDateString(undefined, { weekday: "narrow" })));
    })));
    if (w.projects.length) el.append(h("table", { class: "num-table" }, h("tbody", {}, w.projects.map(([p, x]) => h("tr", {}, h("th", {}, p), h("td", {}, `${fmt(x)} h`))))));
    el.append(h("details", {}, h("summary", {}, `Entries this week (${w.entries.length})`), w.entries.length
      ? h("ul", { class: "cart-lines" }, w.entries.slice().reverse().map((r) => h("li", {},
        h("span", {}, `${r.date.slice(5)} · ${r.project || "(none)"}`, r.note ? h("span", { class: "muted" }, ` · ${r.note}`) : null),
        h("span", { class: "row" }, h("span", { class: "num" }, `${fmt(r.hours)} h`),
          h("button", { class: "btn btn-icon", "aria-label": `Delete ${r.hours} h on ${r.date}`, title: "Delete entry", onClick: async () => {
            try {
              await ctx.gh.commitFiles([{ path: hoursPath(r.date), mutate: (txt) => formatRows(opRemoveHours(r)(parseRows(txt)), HOUR_KEYS) }],
                syncMessage(today(), `delete ${fmt(r.hours)}h ${r.project} ${r.date}`));
              ctx.refresh();
            } catch (e) { ctx.toast(`Couldn't delete: ${e.message}`, { error: true }); }
          } }, "×")))))
      : empty("Nothing logged this week.")));
  },
};
