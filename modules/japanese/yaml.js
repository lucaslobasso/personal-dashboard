// Port of personal-japanese/scripts/study.py's flow-mapping parser (class P + Store loading).
// Data format: one item per line, `- {key: value, ...}` with JSON-quoted strings. Read-only:
// the dashboard never writes these files.

export function parseLine(s) {
  let i = 0;
  const ws = () => { while (i < s.length && (s[i] === " " || s[i] === "\t")) i++; };

  function value() {
    ws();
    const c = s[i];
    if (c === '"') {
      let j = i + 1;
      while (s[j] !== '"') {
        if (j >= s.length) throw new Error("unterminated string");
        j += s[j] === "\\" ? 2 : 1;
      }
      const v = JSON.parse(s.slice(i, j + 1));
      i = j + 1;
      return v;
    }
    if (c === "[") {
      i++;
      const out = [];
      ws();
      if (s[i] === "]") { i++; return out; }
      for (;;) {
        out.push(value());
        ws();
        if (s[i] === ",") { i++; continue; }
        if (s[i] === "]") { i++; return out; }
        throw new Error("bad list");
      }
    }
    let j = i;
    while (j < s.length && !",}]".includes(s[j])) j++;
    const raw = s.slice(i, j).trim();
    i = j;
    if (raw === "null" || raw === "~" || raw === "") return null;
    if (raw === "true" || raw === "false") return raw === "true";
    if (/^-?\d+$/.test(raw)) return parseInt(raw, 10);
    return raw.replace(/^'+|'+$/g, "");
  }

  function mapping() {
    ws();
    if (s[i] !== "{") throw new Error("expected {");
    i++;
    const out = {};
    for (;;) {
      ws();
      if (s[i] === "}") { i++; return out; }
      const j = s.indexOf(":", i);
      if (j < 0) throw new Error("expected key:");
      const key = s.slice(i, j).trim().replace(/^"+|"+$/g, "");
      i = j + 1;
      out[key] = value();
      ws();
      if (s[i] === ",") i++;
    }
  }

  return mapping();
}

// Port of study.py's q(): value serializer used by Store.save(). Byte-exact on all data lines
// (tests/test.mjs re-serializes every line and compares).
export const q = (v) => v == null ? "null" : typeof v === "boolean" ? String(v) : Number.isInteger(v) ? String(v)
  : Array.isArray(v) ? "[" + v.map(q).join(", ") + "]" : JSON.stringify(String(v));

export const formatLine = (item) => "- {" + Object.entries(item).map(([k, v]) => `${k}: ${q(v)}`).join(", ") + "}";

/**
 * Rewrite only the item lines `update(item)` changes (returns a new item, or null to keep the
 * line); every other line stays byte-identical. Returns the new text, or null if nothing changed.
 */
export function applyRecords(text, update, name = "data") {
  let changed = false;
  const out = text.split("\n").map((line, n) => {
    if (!line.startsWith("- {")) return line;
    let item;
    try { item = parseLine(line.slice(2)); } catch (e) { throw new Error(`${name}.yaml:${n + 1}: cannot parse (${e.message})`); }
    const next = update(item);
    if (!next) return line;
    const s = formatLine(next);
    if (s !== line) changed = true;
    return s;
  });
  return changed ? out.join("\n") : null;
}

export function parseFile(text, name = "data") {
  const items = [];
  text.split(/\r?\n/).forEach((line, n) => {
    if (!line.startsWith("- {")) return;
    try {
      items.push(parseLine(line.slice(2)));
    } catch (e) {
      throw new Error(`${name}.yaml:${n + 1}: cannot parse (${e.message})`);
    }
  });
  return items;
}
