# personal-dashboard

A modular static dashboard (loosely inspired by Glance) for reading and lightly editing the user's Claude-managed personal-* data repos without the agent: edit the grocery list, search the Japanese study DB. Anything that needs judgment (building the cart, explanations, quizzes) stays with Claude in those repos.
It runs entirely in the browser: GitHub Pages serves the files, and widgets talk straight to the GitHub API with a fine-grained token kept in the browser's localStorage. No backend, no build step, no dependencies.
Skills: none (code repo, edited deliberately).

## Hard rules
- **Never put data or secrets in this repo.** It is public. Data lives in the private personal-* repos; the token lives only in each browser.
- **Writes are limited by design.** groceries: `data/pending.json` (add/edit/remove), plus resetting `data/cart.json` to `{}` when the list changes (same rule as that repo's /remove). Never write `products.json`, `history/` or anything in personal-japanese. New write features must follow the target repo's CLAUDE.md schema and file style exactly (diffs should look like Claude's own edits).
- Respect each data repo's conventions: data commits are `sync: <date> <file>` with a `dashboard: …` body line.
- Render repo data with `h()`/`textContent` only, never `innerHTML`. No third-party scripts or CDNs (the CSP in `index.html` blocks them; keep it that way). External links: https only, via `extLink()`.
- Keep ports in sync with their source: `modules/japanese/yaml.js` and `data.js` mirror `personal-japanese/scripts/study.py` (parser, `norm`, `find`, `is_due`). If study.py changes, update the port and run the tests.
- Reply in English, briefly.

## Sync
None. This is a code repo: make normal commits with a short sentence-case message once the user agrees to a change, then push to `main` (GitHub Pages redeploys on push).

## Layout
- `index.html` (CSP, manifest), `app.js` (loads `config.json`, renders pages → columns → widgets, hash routing `#/<page>`, per-widget error boundary, `pd:changed` events), `styles.css` (tokens; light/dark via `prefers-color-scheme`).
- `config.json`: `sources` (name → `owner/repo`) and `pages[].columns[]` (`size: small|full`) `.widgets[]` (`{ type, source, title?, …options }`).
- `core/github.js`: `getFile` (ETag cache), `listDir`, `updateFile` (read-modify-write, re-applies on 409), `serial` queue, `client(repo)`. `core/ui.js`: `h`, `card`, `toast`, `select`, `extLink`, `empty`, `debounce`. `core/store.js`: guarded localStorage. `core/settings.js`: token screen.
- `modules/index.js`: registry type → lazy import. `modules/groceries/` (list, cart, history, format), `modules/japanese/` (search, stats, data, yaml).
- `mock.html` + `tests/mock.js`: offline preview on the sibling clones (`serve.py --mock`); writes stay in memory.

## Adding a module
1. `modules/<area>/<name>.js` exporting `default { type, title, watch?: [paths], async load(ctx, opts), render(el, data, ctx, opts) }`.
   `ctx`: `gh` (repo-bound client), `repo`, `source`, `frame` (`setBadge`, `setTitle`, `actions`), `toast`, `refresh()`, `changed(path)` (tells widgets that `watch` that path to reload).
2. One line in `modules/index.js`. 3. Widget entries in `config.json`. 4. Document options in a comment at the top of the module and in README.

## Helper scripts
- `python scripts/serve.py [port] [--mock]`: local server (stdlib, correct MIME types, no caching). With `--mock`, open `/mock.html` to run on the local personal-* clones without a token.
- `node tests/test.mjs`: unit + parity tests against the sibling clones (JS ports vs `study.py stats/find`, byte-exact YAML and pending.json round trips, conflict retry, offline fallback). Run after touching `modules/` or `core/`.
- `node tests/e2e.mjs`: browser end-to-end over mock mode via headless Edge/Chrome (DevTools protocol, no deps): add/edit/undo/remove with exact committed bytes, cart reset, search, settings, offline, token chip, 360px layout, zero console/CSP errors. `SHOTS=<dir>` saves screenshots. Run before pushing UI changes.
- `docs/roadmap.md`: prioritized growth ideas and the constraints they must respect.
