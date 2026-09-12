# Crewboard — AI Tinkerers Build Day, 2026-09-12

## Pitch

Intent is captured at the cursor, in any app. A team of AI agents executes it.
The result lands in the team's workspace — doc, sheet, chat message — where
people already work. Nobody opens a separate chat window.

**Two places from the brief:** in the room (cursor overlay) + at work (Ambiguous).

## Flow

1. You type in Slack: "I'll get the Q3 numbers into a sheet by 5"
2. Overlay (`project 1`) reads the focused field via UIA, local filter passes
3. OpenRouter model decides: propose or stay quiet → toast beside cursor
4. Double-tap Shift → `POST /task` to swarm server
5. Lead splits if big, workers claim by capability (Codex / Claude / Gemini / OpenRouter)
6. Progress → Ambiguous Chat. Blocked → `needs-human` → human answers in Chat
7. Done → deliverable in Ambiguous Docs/Sheets + WS `task:done` → toast at cursor

## Team — 3 humans, 3 AIs

| | A — Claude Code | B — Codex | C — Gemini |
|---|---|---|---|
| Owns | Overlay (`project 1`, Electron, Windows) | Swarm backend (`crewboard`, Node) | Integrations + submission |
| 11:15–12:30 | On filter PASS → OpenRouter call with field text → propose or silent. Toast with proposal. | `POST /task` on dash server (7379): `{title, context, source_app, crop?}`. OpenRouter worker: claim → LLM w/ tools (read/write file, shell, exa_search) → done. | Ambiguous account + MCP/CLI. One message into Chat from CLI. **If not working by 11:45 → drop Ambiguous, go to plain delivery.** |
| 12:30–14:00 | Double-tap → `POST /task` with text + app + screenshot crop. Listen WS `task:done` → toast with result. | `task:done` → WS broadcast `{file, pr, summary}`. Auto-split on capability. Exa tool in worker. | Delivery: result → Ambiguous Doc/Sheet + Chat message. Each swarm worker = Ambiguous AI coworker identity. E2E test ×3. |
| 14:00–15:00 | Proposal dies after 5s if ignored. UIA blind (WhatsApp) → image crop fallback. | Dead worker → task reassigned. Cost per task logged. | Video 2 min, README, social post tagging sponsors. Landing page 1 screen (Auth0 login only if time). |
| 15:00–15:30 | **Freeze. Submit.** | | |

Meta: the team uses crewboard to coordinate its own 3 AIs while building. Dashboard with 3 live workers goes in the video.

## Sponsor coverage

| Sponsor | Where | Owner |
|---|---|---|
| OpenAI | Codex worker (primary) | B |
| OpenRouter | Generic worker + overlay decision model | B / A |
| Ambiguous | Team workspace: coworker identities, Chat, Docs/Sheets delivery | C |
| Exa | `web_search` tool in OpenRouter worker | B |
| Auth0 | Landing login — only if time | C |
| CopilotKit, Trigger.dev, Mozilla | skip | — |

## Cut order if behind

Exa → Auth0 → Ambiguous Docs (keep Chat) → auto-split.
**Never cut:** overlay → swarm → toast back. That's the spine.

## Video script (2:00)

| t | Shot |
|---|---|
| 0:00 | Slack open. Type "I'll get the Q3 numbers into a sheet by 5". Toast appears at cursor. |
| 0:20 | Double-tap Shift. Cut to dashboard: task created, Codex claims. Ambiguous Chat: "Cara: on it". |
| 0:50 | Worker runs. Split in 2 (parse CSV / build xlsx). OpenRouter worker claims #2. |
| 1:20 | Ambiguous: sheet appears. Toast at cursor: "q3-numbers.xlsx ready". Paste link in Slack. |
| 1:40 | Dashboard: 3 workers, cost, timeline. "Built by 3 humans + 3 AIs, coordinated by the same tool." |

## Submission checklist

- [ ] Title
- [ ] Written description (what, who, why context matters)
- [ ] Public repo — this one + `project 1` merged in as `overlay/`
- [ ] 2-min video
- [ ] Social post tagging OpenAI, CopilotKit, OpenRouter, Ambiguous, Exa

## Risks

- Overlay is Windows-only. Demo runs on A's laptop, recorded.
- Global keyboard hook may trip Defender on managed laptop — test in first 15 min.
- Ambiguous API unknown until we see docs. Timeboxed to 30 min.
- OpenRouter key — who has it?

## Rubric mapping

| Criterion | Target | How |
|---|---|---|
| Functionality | 4 | One spine flow, tested 3× |
| Innovation | 5 | Agent at the cursor + team workspace; impossible in a chatbox |
| Technical | 4 | Existing orchestration, failure handling, split, 4 real integrations |
| Usefulness | 4 | Capture where you work, deliver where the team works, human in loop via Chat |
