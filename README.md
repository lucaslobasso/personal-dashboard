# personal-dashboard

A small, modular personal hub over my Claude-managed data repos: [personal-groceries](https://github.com/lucaslobasso/personal-groceries) and [personal-japanese](https://github.com/lucaslobasso/personal-japanese). It covers what doesn't need the agent: editing the grocery list, and searching and browsing what I've studied.

Static site (GitHub Pages) + GitHub API. No backend, no build, no dependencies. The data repos stay private; this repo has no data or secrets.

**Live:** https://lucaslobasso.github.io/personal-dashboard/

## Widgets

| Type | What it does | Writes |
|---|---|---|
| `groceries-list` | View the pending list; add, change qty/unit/note, remove (5 s undo) | `data/pending.json` (+ clears a stale `cart.json`) |
| `groceries-cart` | Last cart Claude built: total, lines, skipped, "Open cart on Josimar" | – |
| `groceries-history` | Past purchases, newest first (`limit`) | – |
| `japanese-search` | Search term/reading/meaning/structure/tags like `study.py find`; filter by type, lesson, status/due; item detail (`limit`, `browse`) | – |
| `japanese-stats` | Due/known/learning totals, per-file and per-lesson progress, weakest items (`weakest`, `lessons`) | – |

Still done by talking to Claude in each repo: `/cart`, `/bought` (groceries); `/quiz`, `/explain`, `/review`, `/log-lesson` (Japanese).

## Setup (once per device)
1. Open the site → ⚙ Settings → **Create token on GitHub**. It opens a [pre-filled fine-grained token form](https://github.com/settings/personal-access-tokens/new?name=personal-dashboard&target_name=lucaslobasso&expires_in=366&contents=write) (name, 1-year expiry, Contents: read and write).
   The only manual step: Repository access → *Only select repositories* → `personal-groceries`, `personal-japanese` (GitHub has no URL parameter for this). Permissions cover the whole token, so Japanese gets write access too, but the dashboard never writes there.
2. **Generate token**, paste it under ⚙ Settings, then **Save & test**.
3. Phone: browser menu → *Add to Home screen*.

## Layout and config
`config.json` defines pages → columns (`small` | `full`) → widgets, Glance-style:
```json
{ "sources": { "groceries": "lucaslobasso/personal-groceries" },
  "pages": [{ "name": "Home", "columns": [{ "size": "small", "widgets": [{ "type": "groceries-list", "source": "groceries" }] }] }] }
```
New modules: see "Adding a module" in [CLAUDE.md](CLAUDE.md).

## Development

| Command | What it does |
|---|---|
| `python scripts/serve.py` | Serve at http://127.0.0.1:8765 (uses your real token and data) |
| `python scripts/serve.py --mock` | Then open `/mock.html`: runs on the local `../personal-*` clones, no token, writes not saved |
| `node tests/test.mjs` | Parity tests vs `study.py` and the real `pending.json`, plus the conflict-retry path |

## How edits stay safe
- Every write is a normal commit on the data repo's `main` (`sync: <date> pending.json` / `dashboard: add yerba`). Claude sessions pull on start, so they see it.
- Writes send the file's sha. If something else changed the file in between (a Claude session, another device), the dashboard re-reads it and re-applies just its own change.
