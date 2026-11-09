// Settings page: paste/test/clear the GitHub token, clear cached data.
import { h, toast } from "./ui.js";
import { token, checkRepo } from "./github.js";
import { store } from "./store.js";

// GitHub's template URL pre-fills everything except the repository picker (no parameter exists for it).
// Permissions apply to the whole token, so all sources get Contents read/write; the dashboard only
// writes where CLAUDE.md allows (groceries).
function newTokenUrl(config) {
  const repos = Object.values(config.sources || {});
  const owner = (repos[0] || "").split("/")[0];
  const p = new URLSearchParams({
    name: "personal-dashboard",
    description: `personal-dashboard (${location.host || "local"}): ${repos.join(", ")}`.slice(0, 1024),
    expires_in: "366",
    contents: "write",
  });
  if (owner) p.set("target_name", owner);
  return `https://github.com/settings/personal-access-tokens/new?${p}`;
}

export function renderSettings(main, config, onSaved) {
  const input = h("input", { type: "password", class: "input", placeholder: "github_pat_…", autocomplete: "off", spellcheck: "false", value: token.get() });
  const results = h("ul", { class: "checks" });

  async function test() {
    results.replaceChildren();
    for (const [name, repo] of Object.entries(config.sources || {})) {
      const li = results.appendChild(h("li", {}, `${name} (${repo}): checking…`));
      const r = await checkRepo(repo);
      li.textContent = r.ok
        ? `${name} (${repo}): ✓ ${r.push ? "read & write" : "read-only"}`
        : `${name} (${repo}): ✗ ${r.error}`;
      li.className = r.ok ? "ok" : "bad";
    }
  }

  async function save(e) {
    e.preventDefault();
    if (!input.value.trim()) return toast("Paste a token first.", { error: true });
    if (!token.set(input.value)) return toast("This browser blocks local storage, so the token can't be saved.", { error: true });
    await test();
    onSaved?.();
  }

  main.replaceChildren(h("div", { class: "settings" },
    h("section", { class: "card" },
      h("header", { class: "card-head" }, h("h2", {}, "GitHub access")),
      h("div", { class: "card-body stack" },
        h("p", {}, "The dashboard reads and writes the data repos straight through the GitHub API. The token stays in this browser and is only sent to api.github.com."),
        h("ol", { class: "steps" },
          h("li", {}, h("a", { href: newTokenUrl(config), class: "btn", target: "_blank", rel: "noopener noreferrer" }, "Create token on GitHub ↗"),
            " opens a pre-filled form (name, 1-year expiry, Contents: read and write)."),
          h("li", {}, "Under ", h("strong", {}, "Repository access"), " choose ", h("em", {}, "Only select repositories"), " and pick:",
            h("div", { class: "sub" }, Object.values(config.sources || {}).map((r) => h("div", {}, h("code", {}, r))))),
          h("li", {}, "Click ", h("strong", {}, "Generate token"), ", copy it, and paste it below. Once per device.")),
        h("form", { class: "row", onSubmit: save },
          input,
          h("button", { class: "btn btn-primary", type: "submit" }, "Save & test")),
        results,
        h("div", { class: "row" },
          h("button", { class: "btn", onClick: test }, "Test again"),
          h("button", { class: "btn", onClick: () => { store.clear("gh:"); toast("Cached data cleared."); } }, "Clear cached data"),
          h("button", { class: "btn btn-danger", onClick: () => { token.clear(); input.value = ""; results.replaceChildren(); toast("Token removed from this browser."); } }, "Remove token"))))));
}
