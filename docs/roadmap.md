# Roadmap: from dashboard to daily hub

Written 2026-11-09 after the first test pass (v1 live on phone and PC). Ordered by daily value per unit of effort.

## Constraints every idea must keep
- **Static + GitHub as the only transport.** No backend, no secrets in this repo, nothing that needs the home PC unless it degrades gracefully.
- **Judgment stays with Claude.** No LLM calls from the browser (API key exposure, cost). Agent-only work (build the cart, explanations, quizzes with feedback) gets a *handoff*, not a reimplementation.
- **Writes look like Claude's.** Same schema, same one-line-per-item style, `sync: <date> <file>` commits, tested byte for byte before shipping.
- **Token-cheap for Claude.** Small modules, tests that catch regressions so sessions don't need to re-read code.

## What the test pass found (2026-11-09)
| Area | Result |
|---|---|
| Real dashboard commit (`55f2f13`, "add fuyi") | Clean: one added line plus the trailing comma on the previous last line, the same diff Claude makes |
| GitHub API | Conditional requests return 304 and **don't use rate limit**. ETag is exposed to browsers. Token-expiry header is **not** exposed, hence the saved-date warning |
| Payload | First load ≈ 1 MB (vocab.yaml is 657 KB as base64 JSON). Later loads are 304s |
| Parity | 2,260 YAML lines round-trip byte for byte; `find`/`stats` match `study.py` |
| Browser e2e | 28 checks: add/edit/undo/remove with exact bytes, cart reset, search, offline, 360px, zero console/CSP errors |
| Accessibility | Light-mode muted text failed AA (4.21:1 → fixed to 5.39:1); dark mode passes |
| Fixed in this pass | Muted contrast, narrow-screen tabs, offline fallback to the last copy, token-expiry chip, "Open Settings" on 401/403, search placeholder |

## Now: small, high daily value
1. **Japanese flashcards for due items** *(M, the biggest daily-habit win)*. A "Review" widget: show the term, tap to reveal, mark right/wrong. Writes only the SRS stats, using a port of `study.py record` (`scripts/study.py:188`: seen+1, streak/status rules, `last_reviewed`). One commit per session, never per card. The writer is already proven by the byte-exact round-trip test. This needs a deliberate rule change in CLAUDE.md: "Japanese: stats fields only, never notes/sensei content".
2. **Speak button** *(S)*. `speechSynthesis` with a `ja-JP` voice on terms, readings and examples. Offline, free, no CSP change.
3. **Today page** *(S–M)*. One glance: due-review count, pending groceries, days since the last delivery from `history/` (you shop every 2–3 weeks, so nudge from day 14), the latest "Ask sensei" items. Pure composition of data already loaded.
4. **Sensei sessions widget** *(S–M)*. Render `sessions/*.md` read-only: latest lesson notes and the `## Ask sensei` checklist to bring to class. Needs a tiny markdown-to-DOM renderer (headings, lists, bold, using `textContent` only).
5. **Usual-items quick add** *(S, once history exists)*. One-tap chips for staples from `history/` + `products.json`, plus "recently removed" to undo across sessions.
6. **Claude handoff buttons** *(S)*. "Build cart" or "Explain this" copy a ready prompt (`armá el carrito`, `/explain <id>`) and open claude.ai/code. This bridges agent-only features with no API key and no cost.
7. **Chores** *(S)*. PNG icons (192/512 + apple-touch-icon) for proper home-screen install on Android/iOS. Fetch read-only Japanese files in raw format (−25% first-load data).

## Next: medium, extends reach
8. **Arr via a status branch** *(L)*. A Windows scheduled task on the PC runs `arr.py health/queue` (+ Plex recently added, disk free) and force-pushes one `status.json` to an orphan branch `dashboard-status` in personal-arr every ~15 min, so git history doesn't grow. The dashboard reads it with `?ref=`. This works away from home and opens nothing on the LAN, and it shows a "stale since …" note when the PC is off. Media requests become a queue: the dashboard appends to `requests.json` on that branch, the PC job runs `arr.py lookup/add` and writes back candidates when a title is ambiguous. The token needs personal-arr added; the job only ever adds.
9. **Service worker app shell** *(S–M)*. Instant open and fully offline, pairing with the new cached-data fallback. Use a versioned cache name bumped on deploy.
10. **CI** *(S)*. A GitHub Action running the unit tests on push (the parity/e2e parts skip without the private clones).
11. **One commit per action** *(S–M)*. Commit pending.json + the cart reset together through the Git Data API (tree → commit → ref) instead of two Contents API commits.

## Later: nice-to-have
12. Android **share target**: share text from any app → groceries list (needs the service worker plus manifest `share_target`).
13. Glance-style **utility widgets**: weather (Open-Meteo, add it to `connect-src`), clock, a bookmarks widget (Josimar, jlptsensei, claude.ai/code; LAN links such as Seerr/Plex flagged "home only").
14. **Spending chart** from `history/` once there are ≥3 purchases (load the dataviz skill).
15. **Shared groceries** with someone else: they'd need collaborator access to the private repo and their own fine-grained token.

## Deliberately not doing
- Browser-side LLM features (key exposure, cost; that's what Claude sessions are for).
- A backend or always-on server just for the dashboard.
- A framework or build step: the vanilla, no-build setup is what keeps it cheap to maintain.
