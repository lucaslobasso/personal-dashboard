# Roadmap: from dashboard to daily hub

Started 2026-11-09 after the first test pass (v1 live on phone and PC). Ordered by daily value per unit of effort.

## Constraints every idea must keep
- **Static + GitHub as the only transport.** No backend, no secrets in this repo, nothing that needs the home PC unless it degrades gracefully.
- **Judgment stays with Claude.** No LLM calls from the browser (API key exposure, cost). Agent-only work (matching products for the cart, explanations, quizzes with feedback) gets a *handoff*, not a reimplementation.
- **Writes look like Claude's.** Same schema, same one-line-per-item style, `sync: <date> <files>` commits, tested byte for byte against the repo's own script before shipping.
- **Token-cheap for Claude.** Small modules, tests that catch regressions so sessions don't need to re-read code.

## Done
- **v1 (2026-11-09):** grocery list editing, cart/history views, Japanese search + stats. Test pass: e2e suite, AA contrast, offline fallback, token-expiry chip.
- **Round 2 (2026-11-09):**
  - Today page.
  - Japanese flashcards (`due`/`record` ports, byte parity with `study.py`).
  - Usual items (pins + purchase history).
  - Cart: Ask Claude handoff + **Mark bought** (atomic 4-file commit, like /bought).
  - Movie/series **request queue** (`arr.py requests` worker on the PC).
  - New `personal-work` repo with work items + hours.
  - Atomic multi-file commits (`commitFiles`) everywhere a change spans files.

## Phase 2: next
1. **Google Calendar (read-only)** *(M)*. A scheduled GitHub Action in a private repo (e.g. `personal-life`) fetches the calendar's *secret iCal address* (stored as an Actions secret) every ~30 min, then writes `data/calendar.json` (next 14 days, title/time/location only). No Google sign-in, no third-party script, no CSP change. Widget: today/tomorrow agenda on Today, a week view on its own page.
2. **Pending activities + free-day planner** *(M–L, builds on 1)*. `personal-life` also holds `data/activities.json`: `{ id, title, kind: appointment|errand|hobby, durationMin, where, when (weekday hours / opening times), cadenceDays, lastDone, due, priority }`, edited by Claude skills (`/todo "turno dentista"`) and the dashboard. A **"What can I do today?"** widget takes the free slots from the calendar and ranks activities deterministically (overdue recurring > deadline soon > fits the slot and opening hours > priority > longest since last done). Tap "Done" to set `lastDone`. No LLM: the ranking rules are transparent.
3. **Arr status branch** *(L)*. The PC worker also publishes `status.json` (queue, disk, recently added) to an orphan branch `dashboard-status`, force-pushed so history doesn't grow. It's shown on Media/Today with a "stale since…" note when the PC is off.
4. **Service worker app shell** *(S–M)*. Instant open and fully offline, pairing with the cached-data fallback. Use a versioned cache name bumped on deploy.

## Later
- Speak button (`speechSynthesis` ja-JP) on flashcards and search results.
- Sensei sessions page: render `sessions/*.md` read-only (tiny markdown-to-DOM renderer, `textContent` only).
- PNG icons (192/512 + apple-touch-icon) for a proper home-screen install. Fetch the read-only Japanese files raw (−25% first-load data).
- CI: a GitHub Action running the unit tests on push (parity/e2e skip without the private clones).
- Android share target: share text from any app → groceries list (needs the service worker plus manifest `share_target`).
- Utility widgets (weather via Open-Meteo, add it to `connect-src`), bookmarks (Josimar, jlptsensei, claude.ai/code; LAN links flagged "home only").
- Spending chart from `history/` once there are ≥3 purchases (load the dataviz skill).
- Shared groceries with someone else (collaborator access + their own token).

## Deliberately not doing
- Browser-side LLM features (key exposure, cost; that's what Claude sessions are for).
- Automating `/cart` through GitHub Actions + Claude (considered in round 2; the user chose the handoff).
- A backend or always-on server just for the dashboard. A framework or build step.
