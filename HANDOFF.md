# Handoff — Cursor Overlay (`project 1`)

Single-page handoff for whoever picks this up next. Combines the spike report, the hackathon plan, and the code as it stands today (2026-09-12). Detailed docs stay separate:

- [REPORT.md](REPORT.md) — feasibility spike: the UIA gate, build log, verified numbers, known limits
- [HACKATHON.md](HACKATHON.md) — AI Tinkerers Build Day plan: pitch, team split, timeline, cut order, video script

---

## 1. What this is

A Windows 11 Electron overlay that sits transparent over every app, follows the cursor, reads the text field you're typing in (via UI Automation), runs a cheap local filter for "actionable" text (dates, times, filenames, promise verbs — EN + RO), and lets you fire an action with **double-tap Shift**: grab the selected text, or drag a rectangle and capture a DPI-correct PNG crop. Result shows as a toast beside the cursor.

It is the **capture end** of Crewboard: intent captured at the cursor → `POST /task` to the swarm backend (`crewboard` repo, separate) → workers execute → result toasts back at the cursor.

## 2. Status

| Piece | State |
|---|---|
| Click-through transparent overlay, excluded from own captures | done, verified (`0x8080028`) |
| Cursor companion ring (spring follow) | done |
| Double-tap Shift via `WH_KEYBOARD_LL` hook (PowerShell) | done, `Ctrl+Shift+Space` fallback |
| Selected-text grab (clipboard save/restore, `Ctrl+Insert` in terminals) | done |
| Drag-region / quick-click screenshot crop, physical-px | done |
| Passive UIA field read + local filter + live panel (`--reader`) | done — **gate passed** (Slack, Chrome, native OK; WhatsApp/WebView2 blind) |
| OpenRouter call on filter PASS → proposal toast | **not started** |
| `POST /task` to swarm on double-tap, WS `task:done` → toast | **not started** |
| Proposal auto-dismiss after 5 s | not started |

Blocked on: which model / API key for the proposal call (see HACKATHON.md "Risks").

## 3. Run

Requires Windows 11, Node ≥ 18, PowerShell 5.1 (ships with Windows).

```bash
npm install
```

| Command | What |
|---|---|
| `start.cmd` | overlay only (companion + capture + double-tap) |
| `start-reader.cmd` | overlay + UIA field reader + live panel |
| `stop.cmd` | kills electron + all helper PowerShell processes |
| `npm start` | same as `start.cmd` but attached to the console (dies with it) |

Self-test flags (append to the electron command line): `--selftest` (auto crop at cursor), `--selftest-toast`, `--selftest-text`, `--selftest-dtap` (log double-tap, don't fire).

Runtime output: `overlay.log` (every event, timestamps), `captures/` (`crop-*.png`, `text-*.txt`). Both gitignored.

## 4. Architecture

```
main.js (Electron main)
 ├─ createOverlay()      transparent fullscreen BrowserWindow, ignoreMouseEvents(forward)
 ├─ startHelpers()       spawns long-lived PowerShell processes, 1 line stdout = 1 event
 │    ├─ keyhelper.ps1      stdin "copy" → injects Ctrl+C / Ctrl+Insert, replies "sent ..."
 │    ├─ shifthelper.ps1    global low-level keyboard hook → emits "dtap"
 │    └─ uiahelper.ps1      (--reader) polls focused UIA element → JSON {app,type,text,len,src}
 ├─ localFilter(text)    regex signals: date/time/file/promise → pass|silent
 ├─ onHotkey()           dtap → try text grab → else drag-select → captureRect()
 ├─ captureRect()        hideUi() (2 frames) → desktopCapturer at physical res → crop → PNG
 └─ IPC → overlay.html   cursor, select-start/end, hide/show, toast, fired, field

overlay.html (renderer, nodeIntegration on)
 ├─ #buddy    amber ring, spring-follows cursor
 ├─ #dim/#sel drag rectangle UI (Esc / right-click cancels)
 ├─ #toast    result popup at cursor
 └─ #panel    live field reader: app, type, badge PASS/silent, signals, text
```

Key gotchas already solved (full list in REPORT.md §03): don't use `setContentProtection` on transparent windows; capture at `size × scaleFactor`; launch detached (`start ""`); UIA pattern IDs must be literal `::Pattern`, not cached vars; `%~dp0` trailing backslash escapes quotes in `.cmd`.

## 5. Next steps (in order)

1. **Debounce 600–800 ms after filter PASS** → call OpenRouter with field text + app name. Model answers `{propose: bool, text}`; usually silent.
2. Proposal → toast beside cursor; dies after 5 s if ignored.
3. **Double-tap on a live proposal** → `POST http://localhost:7379/task` `{title, context, source_app, crop?}`.
4. WebSocket client → on `task:done` `{file, pr, summary}` → toast at cursor.
5. WhatsApp / WebView2: field read is blind → fall back to image crop path (already exists).

## 6. Known limits

- Overlay is 912 px tall on the dev laptop — nothing selectable over the taskbar
- `desktopCapturer.getSources` costs ~0.8 s per capture
- Clipboard restore covers text/html/image, not files
- Global keyboard hook may trip Defender on managed laptops
- Double-tap Shift collides with JetBrains Search Everywhere
- Windows-only; demo recorded on A's laptop

## 7. Files

| File | Role |
|---|---|
| `main.js` | overlay window, helpers, filter, capture, IPC |
| `overlay.html` | ring, drag select, toast, reader panel |
| `uiahelper.ps1` | UIA focused-field reader (JSON lines) |
| `keyhelper.ps1` | Ctrl+C / Ctrl+Insert injector |
| `shifthelper.ps1` | double-tap Shift hook |
| `start.cmd` / `start-reader.cmd` / `stop.cmd` | launchers |
| `REPORT.md` | spike report |
| `HACKATHON.md` | build-day plan |
