# personal-dashboard

A modular static dashboard (loosely inspired by Glance) for the user's Claude-managed personal-* data repos, for day-to-day use without the agent. **Today** gives the overview. Groceries: edit the list, one-tap usual items, mark what was bought. Japanese: flashcard reviews, per-lesson notes with sensei, search, stats. Work: tasks/deadlines and hours. Media: queue movie/series requests for the home PC. Anything that needs judgment (matching Josimar products for the cart, explanations, quizzes with feedback) stays with Claude in those repos, via a "copy prompt + open claude.ai/code" handoff.
It runs entirely in the browser: GitHub Pages serves the files, and widgets talk straight to the GitHub API with a fine-grained token kept in the browser's localStorage. No backend, no build step, no dependencies.
Skills: none (code repo, edited deliberately).

## Hard rules
- **Never put data or secrets in this repo.** It is public. Data lives in the private personal-* repos; the token lives only in each browser.
- **Writes are limited by design.** Each must follow the target repo's CLAUDE.md schema and file style exactly (diffs should look like Claude's own edits), with byte-parity tests against that repo's scripts:
  - groceries: `pending.json` (add/edit/remove; a list change also resets a built `cart.json` to `{}`, like /remove), `usual.json` (pins). **Mark bought** writes `history/<date>.json`, `pending.json`, `products.json` (`confirmed: true` only) and `cart.json`, like /bought. Never match products or build carts (Claude's /cart).
  - japanese: **SRS stat fields only** (`times_seen`, `times_wrong`, `streak`, `status`, `last_reviewed`, plus missing stat keys) via the `record` port. Never notes, examples, terms or anything from `source: sensei`.
    Plus the user's own lesson notes in `sessions/YYYY-MM-DD.md` (`japanese-notes`: append a bullet under `## Notes`/`## Ask sensei`, or save an edit that is refused if the file changed since it was opened). /log-lesson turns them into items.
  - work: `data/items.json` and `data/hours/YYYY-MM.json`, in `work.py`'s format.
  - arr: `state/requests.json` only (queue, pick, cancel, retry). Adding to Radarr/Sonarr is the home PC worker's job (`arr.py requests`).
- Multi-file changes go through `commitFiles` (one atomic commit, re-applied if `main` moved). Data commits: `sync: <date> <files>` with a `dashboard: …` body line (`syncMessage`).
- Render repo data with `h()`/`textContent` only, never `innerHTML`. No third-party scripts or CDNs (the CSP in `index.html` blocks them; keep it that way). External links: https only, via `extLink()`.
- Keep ports in sync with their source, and run the tests when either side changes:
  - `modules/japanese/yaml.js` and `data.js` mirror `personal-japanese/scripts/study.py` (parser, `q()` writer, `norm`, `find`, `due`, `record`, `is_due`).
  - `modules/work/format.js` mirrors `personal-work/scripts/work.py` (formats, slug).
  - `modules/media/requests.js` mirrors `personal-arr/scripts/arr.py` `format_requests`.
- Reply in English, briefly.

## Sync
None. This is a code repo: make normal commits with a short sentence-case message once the user agrees to a change, then push to `main` (GitHub Pages redeploys on push).

## Layout
- `index.html` (CSP, manifest), `app.js` (loads `config.json`, renders pages → columns → widgets, hash routing `#/<page>`, per-widget error boundary, `pd:changed` events, offline toast, token-expiry chip), `styles.css` (tokens; light/dark via `prefers-color-scheme`).
- `config.json`: `sources` (name → `owner/repo`) and `pages[].columns[]` (`size: small|full`) `.widgets[]` (`{ type, source, title?, …options }`). Pages: Today, Groceries, Japanese, Work, Media.
- `core/github.js`:
  - `getFile` (ETag cache, offline fallback), `listDir`, `updateFile` (single file, re-applies on 409).
  - `commitFiles` (Git Data API, atomic multi-file, re-applies when `main` moved), `syncMessage`, `gitBlobSha`, `serial`, `client(repo)`.
- `core/ui.js`: `h`, `card`, `toast`, `select`, `extLink`, `empty`, `handoff`, `today`, `daysFrom`, `debounce`. `core/store.js`: guarded localStorage. `core/settings.js`: token screen.
- `modules/index.js`: registry type → lazy import.
  - `modules/groceries/`: list, cart, bought, history, summary, format.
  - `modules/japanese/`: review, notes, search, stats, due, data, yaml.
  - `modules/work/`: items, hours, format.
  - `modules/media/`: requests, summary.
- `mock.html` + `tests/mock.js`: offline preview on the sibling clones (`serve.py --mock`), emulating the Contents and Git Data APIs. Writes stay in memory.

## Adding a module
1. `modules/<area>/<name>.js` exporting `default { type, title, watch?: [paths], async load(ctx, opts), render(el, data, ctx, opts) }`.
   `ctx`: `gh` (repo-bound client), `repo`, `source`, `frame` (`setBadge`, `setTitle`, `actions`), `toast`, `refresh()`, `changed(path)` (tells widgets that `watch` that path to reload).
2. One line in `modules/index.js`. 3. Widget entries in `config.json` (add the repo to `sources`; the user then adds it to their token's repository access). 4. Document options in a comment at the top of the module and in README.

## Helper scripts
- `python scripts/serve.py [port] [--mock]`: local server (stdlib, correct MIME types, no caching). With `--mock`, open `/mock.html` to run on the local personal-* clones without a token.
- `node tests/test.mjs`: unit + parity tests against the sibling clones:
  - JS ports vs real `study.py` record/due/find/stats, `work.py` and `arr.py` output, all byte for byte.
  - YAML/pending round trips, `commitFiles` retry, mark-bought, usual ranking, offline fallback.
  Run after touching `modules/` or `core/`.
- `node tests/e2e.mjs`: browser end-to-end over mock mode via headless Edge/Chrome (DevTools protocol, no deps). Covers every widget's main flow with exact committed bytes and atomic commits, offline, the token chip, 360px layout on every page, and zero console/CSP errors. `SHOTS=<dir>` saves screenshots. Run before pushing UI changes.
- `docs/roadmap.md`: prioritized growth ideas and the constraints they must respect.
