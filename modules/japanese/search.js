// japanese-search: search and browse vocab/verbs/grammar/kanji. Read-only.
// Options: limit (results per page, default 30); browse (list items before typing, default true).
import { h, select, extLink, empty, debounce } from "../../core/ui.js";
import { loadAll, find, lesson, isDue, FILES, STATUSES } from "./data.js";

const ja = (text, cls) => h("span", { lang: "ja", class: cls }, text);

const DETAIL_FIELDS = [
  ["type", "Type"], ["group", "Group"], ["transitivity", "Transitivity"],
  ["masu_form", "ます form", true], ["te_form", "て form", true], ["nai_form", "ない form", true],
  ["structure", "Structure", true], ["onyomi", "On'yomi", true], ["kunyomi", "Kun'yomi", true], ["strokes", "Strokes"],
];

export default {
  type: "japanese-search",
  title: "Japanese",
  watch: FILES.map((f) => `data/${f}.yaml`), // refresh after a review session saves

  async load(ctx) {
    return loadAll(ctx.gh);
  },

  render(el, all, ctx, opts) {
    const pageSize = opts.limit || 30;
    const byId = new Map(all.map((x) => [x.item.id, x]));
    const lessons = [...new Set(all.map((x) => lesson(x.item)).filter((n) => n < 999))].sort((a, b) => a - b);
    const counts = Object.fromEntries(FILES.map((f) => [f, all.filter((x) => x.file === f).length]));
    ctx.frame.setBadge(all.length.toLocaleString());

    const q = h("input", { type: "search", class: "input", placeholder: "Search kana, kanji, meaning, tag…", "aria-label": "Search", autocomplete: "off", spellcheck: "false" });
    const fFile = select([["", "All types"], ...FILES.filter((f) => counts[f]).map((f) => [f, `${f} (${counts[f]})`])], "", { class: "input", "aria-label": "Type" });
    const fLesson = select([["", "All lessons"], ...lessons.map((n) => [String(n), `Lesson ${n}`])], "", { class: "input", "aria-label": "Lesson" });
    const fStatus = select([["", "Any status"], ...STATUSES.map((s) => [s, s]), ["due", "due for review"]], "", { class: "input", "aria-label": "Status" });
    const meta = h("p", { class: "muted small" });
    const list = h("ul", { class: "results" });
    const more = h("button", { class: "btn btn-ghost more" }, "Show more");
    let shown = pageSize;
    let current = [];

    el.append(
      h("div", { class: "search-bar" }, q, h("div", { class: "filters" }, fFile, fLesson, fStatus)),
      meta, list, more);

    function filtered() {
      const L = fLesson.value ? Number(fLesson.value) : null;
      return all.filter(({ file, item }) =>
        (!fFile.value || file === fFile.value) &&
        (L == null || lesson(item) === L) &&
        (!fStatus.value || (fStatus.value === "due" ? isDue(item) : (item.status || "new") === fStatus.value)));
    }

    function run() {
      const pool = filtered();
      const text = q.value.trim();
      const idle = !text && !fFile.value && !fLesson.value && !fStatus.value;
      let relaxed = false;
      if (text) ({ hits: current, relaxed } = find(pool, text));
      else if (idle && opts.browse === false) current = [];
      else current = pool.slice().sort((a, b) => lesson(a.item) - lesson(b.item));
      shown = pageSize;
      meta.textContent = idle
        ? `${all.length.toLocaleString()} items. Type to search, or filter to browse.`
        : `${current.length.toLocaleString()} result${current.length === 1 ? "" : "s"}` +
          (relaxed ? ` (no exact match; matched "${text.slice(0, -1)}")` : "");
      draw();
    }

    function draw() {
      list.replaceChildren(...current.slice(0, shown).map(row));
      if (!current.length && (q.value.trim() || fFile.value || fLesson.value || fStatus.value)) list.append(h("li", {}, empty("Nothing found. Try the dictionary form, kana, or fewer filters.")));
      more.hidden = current.length <= shown;
    }

    function row({ file, item }) {
      const detail = h("div", { class: "detail", hidden: true });
      const head = h("button", { class: "result", "aria-expanded": "false", onClick: () => {
        const open = detail.hidden;
        if (open && !detail.firstChild) detail.append(...renderDetail(file, item, byId));
        detail.hidden = !open;
        head.setAttribute("aria-expanded", String(open));
      } },
      h("span", { class: "result-main" },
        ja(item.term, "term"),
        item.reading && item.reading !== item.term ? ja(item.reading, "reading") : null,
        h("span", { class: "meaning" }, item.meaning || "")),
      h("span", { class: "badges" },
        h("span", { class: `badge badge-${file}` }, file),
        h("span", { class: `badge status-${item.status || "new"}` }, item.status || "new")));
      return h("li", {}, head, detail);
    }

    q.addEventListener("input", debounce(run, 150));
    [fFile, fLesson, fStatus].forEach((s) => s.addEventListener("change", run));
    more.addEventListener("click", () => { shown += pageSize; draw(); });
    run();
  },
};

function renderDetail(file, item, byId) {
  const rows = [];
  const add = (label, value) => rows.push(h("dt", {}, label), h("dd", {}, value));
  for (const [k, label, isJa] of DETAIL_FIELDS) {
    const v = item[k];
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) continue;
    const text = Array.isArray(v) ? v.join("、") : String(v);
    add(label, isJa ? ja(text) : text);
  }
  if (item.pair) {
    const p = byId.get(item.pair);
    add("Pair", p ? ja(`${p.item.term}${p.item.meaning ? " — " + p.item.meaning : ""}`) : item.pair);
  }
  const nodes = [h("dl", { class: "fields" }, rows)];

  if (item.notes) nodes.push(h("p", { class: "notes" }, item.notes));
  if (item.examples?.length) nodes.push(h("h4", {}, "Examples"), h("ul", { class: "examples" }, item.examples.map((e) => h("li", {}, ja(e)))));
  if (item.phrases?.length) nodes.push(h("h4", {}, "Phrases"), h("ul", { class: "examples" }, item.phrases.map((e) => h("li", {}, ja(e)))));

  const due = isDue(item);
  nodes.push(h("div", { class: "detail-foot" },
    h("span", { class: `badge source-${item.source || "self"}` }, item.source || "self"),
    (item.tags || []).map((t) => h("span", { class: "tag" }, t)),
    h("span", { class: "muted small srs" },
      `seen ${item.times_seen || 0} · wrong ${item.times_wrong || 0} · streak ${item.streak || 0}` +
      ` · last ${item.last_reviewed || "never"}${due ? " · due" : ""}`),
    item.ref ? extLink(item.ref, "jlptsensei ↗", "small") : null,
    h("code", { class: "muted small id" }, item.id)));
  return nodes;
}
