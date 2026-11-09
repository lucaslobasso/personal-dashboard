// japanese-review: flashcards for due items (study.py `due` + `record`, ported). Answers are kept
// locally and saved as ONE commit at the end (or on "End & save"); only SRS stat fields change.
// Options: size (default 20).
import { h, select, today } from "../../core/ui.js";
import { track, syncMessage } from "../../core/github.js";
import { loadAll, due, record, FILES } from "./data.js";
import { applyRecords } from "./yaml.js";

const ja = (text, cls) => h("span", { lang: "ja", class: cls }, text);
const pathOf = (f) => `data/${f}.yaml`;

export default {
  type: "japanese-review",
  title: "Review",
  watch: FILES.map(pathOf),

  async load(ctx) {
    return loadAll(ctx.gh);
  },

  render(el, all, ctx, opts) {
    const counts = due(all, 0, "review");
    ctx.frame.setBadge(counts.due ? `${counts.due} due` : "");
    let session = null; // { cards, i, results: [{ file, id, result }], revealed, saved }

    // ---------- start screen ----------
    function start() {
      const size = select([10, 20, 30].map((n) => [String(n), `${n} cards`]), String(opts.size || 20), { class: "input", "aria-label": "Cards" });
      const mode = select([["mixed", "Due + new"], ["review", "Due only"], ["new", "New only"]], counts.due ? "mixed" : "new", { class: "input", "aria-label": "Mode" });
      const file = select([["", "All types"], ...FILES.map((f) => [f, f])], "", { class: "input", "aria-label": "Type" });
      const dir = select([["jp", "Japanese → English"], ["en", "English → Japanese"]], "jp", { class: "input", "aria-label": "Direction" });
      el.replaceChildren(h("div", { class: "review-start" },
        h("div", { class: "tiles tiles-2" },
          h("div", { class: "tile" }, h("span", { class: "tile-label" }, "Due now"), h("span", { class: "tile-value" }, counts.due.toLocaleString())),
          h("div", { class: "tile" }, h("span", { class: "tile-label" }, "Not practiced yet"), h("span", { class: "tile-value" }, counts.fresh.toLocaleString()))),
        h("div", { class: "filters" }, size, mode, file, dir),
        h("button", { class: "btn btn-primary wide", onClick: () => {
          const pool = all.filter((x) => !file.value || x.file === file.value);
          const { pick } = due(pool, Number(size.value), mode.value);
          if (!pick.length) return ctx.toast(mode.value === "review" ? "Nothing is due right now." : "No cards match.", { error: true });
          session = { cards: pick, i: 0, results: [], revealed: false, saved: false, dir: dir.value };
          card();
        } }, "Start review")));
    }

    // ---------- card ----------
    function card() {
      const s = session;
      const { file, item } = s.cards[s.i];
      const front = s.dir === "jp"
        ? h("div", { class: "fc-front" }, ja(item.term, "fc-term"), file === "grammar" && item.structure ? h("div", { class: "muted" }, ja(item.structure)) : null)
        : h("div", { class: "fc-front" }, h("span", { class: "fc-term fc-en" }, item.meaning || "(no meaning)"));
      const ex = (item.examples || [])[0];
      const back = h("div", { class: "fc-back", hidden: !s.revealed },
        h("div", {}, ja(item.term, "fc-term-sm"), item.reading && item.reading !== item.term ? ja(` （${item.reading}）`, "muted") : null),
        h("div", { class: "fc-meaning" }, item.meaning || ""),
        file === "grammar" && item.structure ? h("div", { class: "muted small" }, ja(item.structure)) : null,
        ex ? h("div", { class: "fc-example" }, ja(ex)) : null,
        item.notes ? h("div", { class: "muted small fc-notes" }, String(item.notes).slice(0, 220)) : null);
      const reveal = h("button", { class: "btn btn-primary wide", hidden: s.revealed, onClick: show }, "Show answer");
      const grade = h("div", { class: "row fc-grade", hidden: !s.revealed },
        h("button", { class: "btn fc-wrong", onClick: () => answer("wrong") }, "✗ Again"),
        h("button", { class: "btn fc-right", onClick: () => answer("right") }, "✓ Got it"));
      el.replaceChildren(h("div", { class: "fc" },
        h("div", { class: "fc-top" },
          h("span", { class: "muted small" }, `${s.i + 1} / ${s.cards.length}`),
          h("span", { class: `badge badge-${file}` }, file),
          h("button", { class: "btn btn-ghost small", onClick: finish }, s.results.length ? "End & save" : "Quit")),
        h("div", { class: "fc-progress" }, h("span", { style: null })),
        h("div", { class: "fc-card", onClick: () => { if (!s.revealed) show(); } }, front, back),
        reveal, grade,
        h("p", { class: "muted small center" }, "Space: show · 1: again · 2: got it")));
      el.querySelector(".fc-progress span").style.width = `${(s.i / s.cards.length) * 100}%`;
      function show() { s.revealed = true; back.hidden = false; reveal.hidden = true; grade.hidden = false; }
    }

    function answer(result) {
      const s = session;
      if (!s.results.length) track(1); // unsaved results: warn before closing the tab
      const { file, item } = s.cards[s.i];
      s.results.push({ file, id: item.id, result });
      s.i++;
      s.revealed = false;
      if (s.i >= s.cards.length) finish(); else card();
    }

    // ---------- save ----------
    async function save() {
      const s = session;
      if (!s.results.length || s.saved) return;
      const byFile = new Map();
      for (const r of s.results) (byFile.get(r.file) || byFile.set(r.file, []).get(r.file)).push(r);
      const right = s.results.filter((r) => r.result === "right").length;
      const day = today();
      await ctx.gh.commitFiles([...byFile.entries()].map(([file, rs]) => ({
        path: pathOf(file),
        mutate: (text) => text == null ? null : applyRecords(text, (it) => {
          const mine = rs.filter((r) => r.id === it.id);
          return mine.length ? mine.reduce((acc, r) => record(acc, r.result, day), it) : null;
        }, file),
      })), syncMessage(day, `review ${s.results.length} (${right} right, ${s.results.length - right} wrong)`));
      s.saved = true;
      track(-1);
      for (const f of byFile.keys()) ctx.changed(pathOf(f));
    }

    async function finish() {
      const s = session;
      if (!s.results.length) { session = null; return start(); }
      const right = s.results.filter((r) => r.result === "right").length;
      const wrongIds = new Set(s.results.filter((r) => r.result === "wrong").map((r) => r.id));
      const missed = s.cards.filter((c) => wrongIds.has(c.item.id));
      const status = h("p", { class: "muted small center" }, "Saving…");
      const again = h("button", { class: "btn btn-primary", onClick: () => ctx.refresh() }, "Another round");
      el.replaceChildren(h("div", { class: "fc-done" },
        h("div", { class: "tiles tiles-2" },
          h("div", { class: "tile" }, h("span", { class: "tile-label" }, "Got it"), h("span", { class: "tile-value" }, right)),
          h("div", { class: "tile" }, h("span", { class: "tile-label" }, "Again"), h("span", { class: "tile-value" }, s.results.length - right))),
        missed.length ? h("div", {}, h("h3", {}, "To revisit"), h("ul", { class: "weak" }, missed.map(({ item }) =>
          h("li", {}, ja(item.term), " ", h("span", { class: "muted" }, item.meaning || ""))))) : null,
        status, h("div", { class: "row center" }, again)));
      try {
        await save();
        status.textContent = "Saved ✓ (one commit to personal-japanese)";
      } catch (e) {
        status.textContent = "";
        status.append(h("span", { class: "error-text" }, `Couldn't save: ${e.message} `), h("button", { class: "btn", onClick: finish }, "Retry"));
      }
    }

    // keyboard: Space reveals, 1 = again, 2 = got it (only while a card is on screen)
    function keys(e) {
      if (!el.isConnected) return document.removeEventListener("keydown", keys);
      if (!session || session.i >= session.cards.length || /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) return;
      if (e.key === " " && !session.revealed) { e.preventDefault(); el.querySelector(".fc-card")?.click(); }
      else if (session.revealed && e.key === "1") answer("wrong");
      else if (session.revealed && e.key === "2") answer("right");
    }
    document.addEventListener("keydown", keys);
    // Leaving the page mid-session saves what was answered so far.
    window.addEventListener("hashchange", () => { if (session && !session.saved && session.results.length) save().catch(() => {}); }, { once: true });

    start();
  },
};
