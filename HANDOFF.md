# Handoff — Crewboard (2026-09-12, end of build day)

Everything a person or an agent needs to pick this up cold. Detailed playbooks per role: [CLAUDE.md](CLAUDE.md) (desktop + web), [CODEX.md](CODEX.md) (backend/workers), [GEMINI.md](GEMINI.md) (integrations/submission). Original spike: [REPORT.md](REPORT.md). Pitch/plan: [HACKATHON.md](HACKATHON.md). `*.md` are gitignored — docs stay local by team decision.

---

## 1. What it is

**Crewboard** = your crew, at the cursor. A desktop app watches the field you're typing in, proposes a task when you write a commitment ("I'll get the Q3 numbers into a sheet by 5"), double-tap Shift opens a small composer at the cursor (title, context, attachments), and the task lands on a shared board where AI workers claim it. Results come back as a toast at the cursor, in the app's Results tab, as real files in your results folder, and on the web board.

```
type in Slack/Chrome/Notepad ──UIA──▶ overlay (Electron, Windows)
   local filter (date/time/file/promise) ──▶ /api/propose (Qwen @ hackathon, or your Claude/Codex CLI)
   pill "Create a task" → title ──⇧⇧──▶ composer (edit, attach: file/folder/region/clipboard/field/link)
   ──▶ POST /api/task ──▶ Supabase tasks (+attachments, crop)
   workers: claim_task() → running → needs-human / done (result.files → deliverables)
   ◀── overlay tracks: "codex-1 is on it" · question toast · files saved + toast + ✓
```

## 2. Live infrastructure (all IDs)

| | |
|---|---|
| Repo | github.com/mmvinfo28/cursor-overlay · branch `main` · teammates Horia (overlay UI), David (web/CopilotKit) push here — **always `git fetch` before pushing** |
| Web | https://crewboard-web.vercel.app — Vercel team `MM studios` (`mmvstudios`), project `crewboard-web` (`prj_TJPrToGorbi35UrB7HycPPEFQsID`), root dir `web`, auto-deploys on push to `main`. `vercel` CLI works with `--scope mmvstudios`; the Vercel MCP `list_projects` returns nothing — use CLI. |
| Supabase | project `crewboard`, ref `fpjbtolqyfxxrjvtubjj`, eu-central-1, org `eden`. Publishable key `sb_publishable_GKMx6kQd93PWC2OLon9ojg_urweQPbN` (public). Service role: Settings → API (set on Vercel). Project `eden` in the same org is unrelated. |
| Releases | GitHub Releases, latest **v0.1.10**. `.github/workflows/release.yml` builds `Crewboard-Setup-<v>.exe` + `Crewboard-<v>-arm64.dmg` on every push touching app files; version `0.1.<run number>`. Installed Windows copies auto-update within the hour (verified). |
| Auth | Supabase Auth: **GitHub OAuth** (works; Site URL + redirect URLs set) and email (password/magic link; default SMTP ~3 mails/h — use GitHub for demos). Auth0 was tried and dropped; code in `web/lib/auth0.ts` stays dormant unless `AUTH0_*` env is set. |
| LLM | Hackathon endpoint `https://api.aptget.nl/v1`, key `sk-eindhoven-tinkerers`, model `qwen3.8-27b` (set on Vercel as `LLM_BASE_URL/LLM_API_KEY/LLM_MODEL`; Qwen needs `chat_template_kwargs.enable_thinking=false`, handled). OpenRouter key is on Vercel under the misspelt `OPENROUTE_API_KEY` (accepted by code) but the account has **no credits (402)**. |

### Vercel env (production)
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (crop upload), `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `OPENROUTE_API_KEY` (typo, no credits). Optional: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `PROPOSE_MODEL`.

## 3. Repo map

| Path | What |
|---|---|
| `main.js` | Electron main: overlay window, PowerShell helpers, capture, tray, feed + composer windows, updater, results sync, hotkey routing |
| `crew.js` | the spine: `onField` (debounced propose), `takeProposal/fromField`, `send` (uploads attachments to Storage, POST /api/task), `track` (polls task status → toasts) |
| `llm.js` | proposals via local CLIs (`claude -p`, `codex exec`, `gemini -p`), auto-detect, timeouts, tree kill |
| `results.js` | polls `deliverables`, saves files/PR links/text into the results folder, one toast per task, `.synced.json` state |
| `zipdir.js` | dependency-free zip of a folder (attachments) |
| `overlay.html` | click-through overlay: event-only cursor indicator (Horia), "Create a task" pill, toasts (`kind`/`ttl`), drag select, debug field panel |
| `feed.html` | the panel (Ctrl+Shift+C / tray): Tasks tab (cards, answer box, add task), Results tab, results folder + change |
| `compose.html` | "Create a task" composer at the cursor: title, context, Add context from (File, Folder, Screen region, Around cursor, Clipboard, This field, Link), attachment chips |
| `helpers/win/*.ps1` | UIA field reader, Ctrl+C/Ctrl+Insert injector, double-tap Shift hook (Windows only) |
| `config.default.json` | seeded to `%APPDATA%\Crewboard\config.json` on first run: supabaseUrl, anonKey, resultsDir, apiBase, user, localPropose, proposer |
| `web/` | Next.js 16: `/` landing (public) or board (signed in), `/login`, `/results`, API: `/api/task`, `/api/task/[id]/wait`, `/api/propose`, `/api/answer`, `/api/copilotkit` (David). `lib/llm.ts` provider chain, `lib/session.ts`, `proxy.ts` auth gate, `components/Board.tsx` (Realtime + CopilotKit readable/action) |
| `.github/workflows/release.yml` | installers + GitHub Release per push |
| `start.cmd` / `start-reader.cmd` / `stop.cmd` | dev launchers (reader = field reading on; installed app always reads) |

## 4. Run / test

```bash
npm install
start-reader.cmd        # dev overlay with field reader (or the installed Crewboard.exe — not both)
stop.cmd                # kills electron + helper PowerShell processes
```
Self-tests (append to `electron.exe .`): `--selftest-feed` (screenshots both panel tabs to `captures/`), `--selftest-compose` (+ `--selftest-compose-send` attaches + sends), `--selftest-toast`, `--selftest-dtap`. Log: `overlay.log` (dev) / `%APPDATA%\Crewboard\overlay.log` (installed).

Web: `cd web && npm install && npm run dev` (env in `web/.env.local`, pull with `vercel env pull web/.env.local --scope mmvstudios`).

Simulating a worker (SQL editor): `update tasks set status='claimed', worker_id=(select id from workers limit 1) where id=…;` then `update tasks set status='done', result='{"files":[{"name":"x.csv","url":"https://…"}],"summary":"…"}'::jsonb where id=…;` — the trigger fans out `deliverables`, the overlay toasts and saves files. Run statements in **separate** calls or the overlay only sees the final state.

## 5. Schema (applied, see CODEX.md for DDL)

`workers`, `tasks` (+`attachments jsonb`, `crop_url`, `result jsonb`), `events` (`needs-human`/`human-answer`/`done`, `cost_usd`), `deliverables` (filled by trigger `tasks_done_fanout` from `result.files[]|file|pr|summary`), RPC `claim_task(worker, caps[])`, view `task_costs`. Buckets: `crops`, `deliverables`, `attachments` (all public read; `attachments` anon-writable). RLS permissive for the hackathon. Realtime on all four tables.

## 6. What works (verified today)

- Field read + local filter (Slack, Chrome, Notepad; WhatsApp/WebView2 blind) → pill → model title (Qwen ~1 s; Claude CLI ~11 s; Codex ~17 s; local fallback on any error)
- Composer with attachments (file, folder zip ≤24 MB, screen region, around-cursor crop, clipboard text/image, field text, link) → task with `attachments` + optional crop
- Overlay tracking: open → claimed (toast) → needs-human (question toast) → done (files in results folder + toast + ✓); answer from panel or board
- Panel: Tasks + Results tabs, results folder chooser (default `<OneDrive|Documents>\Crewboard Results`)
- Web: GitHub login, live board (Realtime), workers, cost, results library, CopilotKit sidebar (needs a provider key — uses the same `LLM_*`/OpenRouter env)
- Installer + auto-update (0.1.1 → 0.1.2 verified), Mac DMG (arm64) as results viewer

## 7. Not done / known gaps

- **No real workers yet** — tasks stay in Open. CODEX.md has the worker loop spec (`claim_task` → run → upload results to `deliverables/` bucket → `result` → `done`). David's swarm (`../crewboard` repo, separate) is the intended executor.
- Mac: Electron runs, but field reader / double-tap / capture are PowerShell → need Accessibility API + CGEventTap helpers (JXA or Swift). Unsigned DMG (right-click → Open); no auto-update on Mac without Apple signing.
- Ambiguous / Exa integrations: not started (GEMINI.md).
- `OPENROUTE_API_KEY` typo on Vercel, account has no credits — irrelevant while the hackathon Qwen endpoint is up; rename + fund later.
- Local CLI proposers are slow (10–17 s); the pill shows instantly, title arrives late. Fine for demo with the server proposer.
- Double-tap Shift is a global low-level hook (may trip Defender on managed laptops; collides with JetBrains Search Everywhere).
- Two test/demo tasks (`created_by='demo'`) may still be on the board — delete via SQL.

## 8. Next steps, in order

1. Workers: one OpenRouter/Qwen worker that claims, produces a file, uploads, marks done — the loop closes end-to-end.
2. Demo script per HACKATHON.md; record with the installed app (v0.1.10+) and the web board on a second screen.
3. Mac helpers; signed builds.
4. Tighten RLS; move attachments upload behind the API; per-user `created_by` from the web session.
