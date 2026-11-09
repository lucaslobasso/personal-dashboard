# personal-dashboard

A small, modular personal hub over my Claude-managed data repos: [personal-groceries](https://github.com/lucaslobasso/personal-groceries), [personal-japanese](https://github.com/lucaslobasso/personal-japanese), [personal-work](https://github.com/lucaslobasso/personal-work) and [personal-arr](https://github.com/lucaslobasso/personal-arr). It covers what doesn't need the agent. **Today** gives the day at a glance. The grocery list has one-tap usual items and "mark bought". Japanese has flashcards, lesson notes, search and stats. Work has tasks, deadlines and hours. Media queues movie/series requests for the home PC.

Static site (GitHub Pages) + GitHub API. No backend, no build, no dependencies. The data repos stay private; this repo has no data or secrets.

**Live:** https://lucaslobasso.github.io/personal-dashboard/

## Widgets

| Type | What it does | Writes |
|---|---|---|
| `groceries-list` | View the pending list. Add, change qty/unit/note, remove (5 s undo). One-tap chips for usual items (pinned ☆ or bought before) | `pending.json` (+ clears a stale `cart.json` in the same commit), `usual.json` |
| `groceries-cart` | With no cart: **Ask Claude to build the cart** (copies `/cart`, opens claude.ai/code). With one: total, lines, skipped, Open on Josimar. **Mark bought…** after delivery | Mark bought: `history/<date>.json`, `pending.json`, `products.json`, `cart.json` in one commit |
| `groceries-history` | Past purchases, newest first (`limit`) | – |
| `groceries-summary` | Today: what's pending, days since the last delivery with a nudge (`cadenceDays`), cart state | – |
| `japanese-review` | Flashcards for due + new items (`study.py due`), JP→EN or EN→JP. One commit per session (`size`) | SRS stats only |
| `japanese-notes` | Per-lesson notes with sensei in `sessions/YYYY-MM-DD.md`: quick-add to Notes / Ask sensei (creates the day's file), edit, "Process with Claude" → `/log-lesson` (`limit`) | `sessions/*.md` |
| `japanese-search` | Search term/reading/meaning/structure/tags like `study.py find`. Filter by type, lesson, status/due; item detail (`limit`, `browse`) | – |
| `japanese-stats` | Due/known/learning totals, per-file and per-lesson progress, weakest items (`weakest`, `lessons`) | – |
| `japanese-due` | Today: cards due, "Review now", and the "Ask sensei" list from the latest lesson log | – |
| `work-items` | Tasks, tickets, deadlines: Overdue / This week / Doing / Next / Low / Done. Status cycle, inline edit (`compact`) | `data/items.json` |
| `work-hours` | Log hours, Mon–Sun bars vs a weekly target, per-project totals (`weeklyHours`, `compact`) | `data/hours/YYYY-MM.json` |
| `media-requests` | Queue a movie/series; pick the right match when it's ambiguous; retry/cancel (`finished`) | `state/requests.json` |
| `media-summary` | Today: requests that need a pick, what's waiting, recent results | – |

Still done by talking to Claude in each repo: `/cart` (matching Josimar products) and partial `/bought` (groceries), `/quiz` `/explain` `/log-lesson` (Japanese), `/week` planning (work). Movie requests are processed by `arr.py requests` on the home PC every ~10 min.

## Setup (once per device)
1. Open the site → ⚙ Settings → **Create token on GitHub**. It opens a [pre-filled fine-grained token form](https://github.com/settings/personal-access-tokens/new?name=personal-dashboard&target_name=lucaslobasso&expires_in=366&contents=write) (name, 1-year expiry, Contents: read and write).
   The only manual step: Repository access → *Only select repositories* → `personal-groceries`, `personal-japanese`, `personal-work`, `personal-arr` (GitHub has no URL parameter for this). Permissions cover the whole token; what the dashboard actually writes is limited per repo (see the table). Adding a repo later: edit the existing token's repository access; no new token needed.
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
| `node tests/test.mjs` | Unit + parity tests vs `study.py` and the real data (byte-exact round trips, conflict retry, offline) |
| `node tests/e2e.mjs` | Clicks through the real UI in headless Edge/Chrome on mock data (`SHOTS=dir` for screenshots) |

Ideas and priorities: [docs/roadmap.md](docs/roadmap.md).

## How edits stay safe
- Every write is a normal commit on the data repo's `main` (`sync: <date> pending.json` / `dashboard: add yerba`). Claude sessions pull on start, so they see it.
- Writes send the file's sha. If something else changed the file in between (a Claude session, another device), the dashboard re-reads it and re-applies just its own change.
