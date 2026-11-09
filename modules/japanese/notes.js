// japanese-notes: per-lesson notes with sensei, one file per lesson in sessions/YYYY-MM-DD.md (the same
// log Claude's /log-lesson writes). Quick-add appends a bullet under "## Notes" or "## Ask sensei"
// (creating the file from a template); the full text can be edited; "Process with Claude" hands the
// file to /log-lesson so it becomes study items. Writes: sessions/*.md only (the user's own text).
// Options: limit (how many older lessons to list, default 12).
import { h, empty, today, handoff } from "../../core/ui.js";
import { store } from "../../core/store.js";
import { syncMessage } from "../../core/github.js";

export const SESSIONS = "sessions";
export const SECTIONS = ["Notes", "Ask sensei"];
const FILE_RE = /^\d{4}-\d{2}-\d{2}(?:-[\w-]+)?\.md$/;
export const pathFor = (date) => `${SESSIONS}/${date}.md`;

export const template = (date) => `# ${date} — Lesson with sensei\n\n**Source:** sensei lesson.\n\n## Notes\n\n## Ask sensei\n`;

/** Append "- text" at the end of "## section" (created at the end of the file if missing). Pure. */
export function appendBullet(md, section, text) {
  const lines = String(md).replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
  const bullet = `- ${String(text).trim().replace(/\s*\n\s*/g, " ")}`;
  const start = lines.findIndex((l) => new RegExp(`^##\\s+${section}\\s*$`, "i").test(l));
  if (start < 0) return `${lines.join("\n")}\n\n## ${section}\n${bullet}\n`;
  let end = lines.findIndex((l, i) => i > start && /^#{1,2}\s/.test(l));
  if (end < 0) end = lines.length;
  let last = end - 1;
  while (last > start && !lines[last].trim()) last--;
  // Drop a lone placeholder like "- (none yet)".
  if (last > start && /^\s*[-*]\s+\(.*\)\s*$/.test(lines[last]) && last === start + 1) { lines.splice(last, 1); last--; end--; }
  lines.splice(last + 1, 0, bullet);
  return lines.join("\n") + "\n";
}

/** Light markdown → DOM (headings, bullets, paragraphs, **bold**, `code`). Text only, no innerHTML. */
export function renderMd(md) {
  const out = [];
  let ul = null;
  const inline = (s) => s.split(/(\*\*[^*]+\*\*|`[^`]+`)/).filter(Boolean).map((p) =>
    p.startsWith("**") && p.endsWith("**") ? h("strong", {}, p.slice(2, -2)) : p.startsWith("`") && p.endsWith("`") ? h("code", {}, p.slice(1, -1)) : p);
  for (const raw of String(md).split(/\r?\n/)) {
    const line = raw.trimEnd();
    const li = /^(\s*)[-*]\s+(.*)$/.exec(line);
    if (li) {
      ul ||= out[out.push(h("ul", { class: "md-list" })) - 1];
      ul.append(h("li", { class: li[1].length >= 2 ? "md-sub" : null }, inline(li[2])));
      continue;
    }
    ul = null;
    if (!line.trim()) continue;
    const hd = /^(#{1,4})\s+(.*)$/.exec(line);
    if (hd) out.push(h(hd[1].length === 1 ? "h4" : "h5", { class: "md-h" }, inline(hd[2])));
    else out.push(h("p", {}, inline(line)));
  }
  return h("div", { class: "md", lang: "ja" }, out);
}

const draftKey = (repo, path) => `notes-draft:${repo}:${path}`;

export default {
  type: "japanese-notes",
  title: "Lesson notes",

  async load(ctx) {
    const files = (await ctx.gh.listDir(SESSIONS)).filter((f) => f.type === "file" && FILE_RE.test(f.name))
      .sort((a, b) => b.name.localeCompare(a.name));
    return { files };
  },

  render(el, { files: initial }, ctx, opts) {
    let files = initial.map((f) => f.path);
    let open = files.includes(pathFor(today())) ? pathFor(today()) : files[0] || null;
    const texts = new Map(); // path → text as last read/written

    const date = h("input", { class: "input", type: "date", value: today(), "aria-label": "Lesson date" });
    const section = h("select", { class: "input", "aria-label": "Section" }, SECTIONS.map((s) => h("option", { value: s }, s)));
    const note = h("input", { class: "input grow", placeholder: "Add a note… (word, grammar, correction)", "aria-label": "Note", autocomplete: "off", lang: "ja" });
    const list = h("ul", { class: "lessons-list" });
    const view = h("div", { class: "lesson-view" });

    el.append(
      h("form", { class: "add-form", onSubmit: quickAdd },
        h("div", { class: "row" }, note),
        h("div", { class: "row" }, date, section, h("button", { class: "btn btn-primary", type: "submit" }, "Add"))),
      view, list);

    async function read(path) {
      if (!texts.has(path)) texts.set(path, (await ctx.gh.getFile(path, { optional: true }))?.text ?? "");
      return texts.get(path);
    }

    function saved(path, text) {
      texts.set(path, text);
      if (!files.includes(path)) files = [...files, path].sort((a, b) => b.localeCompare(a));
      ctx.changed(path);
    }

    async function quickAdd(e) {
      e.preventDefault();
      const t = note.value.trim();
      if (!t) return note.focus();
      const d = date.value || today();
      const path = pathFor(d);
      note.value = "";
      try {
        const r = await ctx.gh.updateFile(path, (cur) => appendBullet(cur ?? template(d), section.value, t),
          `sync: ${today()} ${d}.md\n\ndashboard: lesson note (${section.value.toLowerCase()})`);
        saved(path, r.text);
        open = path;
        draw();
        note.focus();
      } catch (err) {
        note.value = t;
        ctx.toast(`Couldn't save: ${err.message}`, { error: true });
      }
    }

    async function show() {
      view.replaceChildren();
      if (!open) return;
      const path = open, name = path.split("/").pop().replace(/\.md$/, "");
      const draft = store.get(draftKey(ctx.repo, path));
      if (draft != null) return edit(path, name, draft);
      view.append(h("div", { class: "loading" }, "Loading…"));
      let text;
      try { text = await read(path); } catch (err) { view.replaceChildren(h("p", { class: "error-text small" }, err.message)); return; }
      if (open !== path) return;
      view.replaceChildren(
        h("div", { class: "lesson-head" }, h("strong", {}, name),
          h("div", { class: "row" },
            h("button", { class: "btn btn-ghost small", onClick: () => edit(path, name, text) }, "Edit"),
            h("button", { class: "btn btn-ghost small", onClick: () =>
              handoff(`/log-lesson process my notes in ${path}`, { repo: "personal-japanese" }) }, "Process with Claude"))),
        text.trim() ? renderMd(text) : empty("Empty lesson file."));
    }

    function edit(path, name, text) {
      const ta = h("textarea", { class: "input notes-text", rows: 14, "aria-label": `Notes for ${name}`, lang: "ja", spellcheck: "false" });
      ta.value = text;
      ta.addEventListener("input", () => store.set(draftKey(ctx.repo, path), ta.value));
      const close = () => { store.del(draftKey(ctx.repo, path)); show(); };
      const save = async (btn) => {
        btn.disabled = true;
        const base = texts.get(path);
        try {
          const r = await ctx.gh.updateFile(path, (cur) => {
            // Someone else (e.g. /log-lesson) changed the file since we opened it: don't overwrite.
            if (base != null && (cur ?? "") !== base) throw Object.assign(new Error("changed elsewhere"), { stale: cur ?? "" });
            return ta.value.replace(/\r\n/g, "\n").replace(/\n*$/, "\n");
          }, `sync: ${today()} ${path.split("/").pop()}\n\ndashboard: edit lesson notes`);
          saved(path, r.text);
          close();
          ctx.toast("Saved");
        } catch (err) {
          btn.disabled = false;
          if (err.stale != null) {
            texts.set(path, err.stale);
            ctx.toast("This lesson changed elsewhere. Your draft is kept: copy what you need, then Discard to see the new version.", { error: true, timeout: 8000 });
          } else ctx.toast(`Couldn't save: ${err.message}`, { error: true });
        }
      };
      view.replaceChildren(
        h("div", { class: "lesson-head" }, h("strong", {}, `${name} · editing`)),
        ta,
        h("div", { class: "row end" },
          h("button", { class: "btn btn-ghost", onClick: close }, "Discard"),
          h("button", { class: "btn btn-primary", onClick: (e) => save(e.currentTarget) }, "Save")));
      if (!texts.has(path)) read(path).catch(() => {}); // remember the base for the conflict check
    }

    function draw() {
      ctx.frame.setBadge(files.length ? `${files.length} lesson${files.length === 1 ? "" : "s"}` : "");
      const others = files.filter((p) => p !== open).slice(0, opts.limit ?? 12);
      list.replaceChildren(...others.map((p) => h("li", {}, h("button", { class: "btn btn-ghost small", onClick: () => { open = p; draw(); } },
        p.split("/").pop().replace(/\.md$/, "")))));
      if (!files.length) view.replaceChildren(empty("No lessons yet.", "Add a note above during your next lesson."));
      else show();
    }

    draw();
  },
};
