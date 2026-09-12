# Cursor Overlay Spike

**Feasibility spike · Windows 11 · Electron overlay**

A desktop overlay that watches the cursor, reads the field you're typing in, and proposes an action you confirm with a gesture. This report is the go/no-go on the one piece everything else hangs from: **can it read the field?**

> **The gate holds.** UI Automation reads the focused text field live — character by character — in Slack, Chrome, and native editors. WhatsApp (WebView2) stays blind.
>
> **Status: GATE PASSED.**

---

## 01 · The gate — reading the field

The passive loop (watch what you type, propose only when it matters) needs one thing: read the focused input from any app via UI Automation. The result splits cleanly by rendering engine.

| Engine | Apps | Result |
|---|---|---|
| **Native** (Win32 / WinUI) | Notepad, Word, system dialogs | ✓ ValuePattern |
| **Electron** | Slack — 53 live reads, `src=value` | ✓ reads live |
| **Chromium browser** | Chrome — Document / Edit, `src=value·text` | ✓ reads live |
| **WebView2** (Edge-Chromium embed) | WhatsApp — `WhatsApp.Root` Pane, 0 ch | ✗ blind |

WhatsApp isn't lost — it falls to the image path already built (double-tap → drag → crop). Forcing WebView2 accessibility needs launch env vars a Store app doesn't expose, so it's out of scope. Slack, the real target, behaves like the Claude desktop app: both Electron, both read.

---

## 02 · What's built

**Capabilities**

- **Click-through overlay** — transparent, always-on-top, excluded from its own captures (`0x8080028`)
- **Spring companion** — amber ring trailing the cursor, bouncy follow
- **Double-tap Shift** — modifier-only trigger via low-level keyboard hook
- **Region capture** — drag a box, DPI-correct PNG at physical resolution
- **Text grab** — copies selection, restores clipboard, `Ctrl+Insert` in terminals
- **Passive read + local filter + live panel** — the gate, visualized

**Files**

| File | Role |
|---|---|
| `main.js` | overlay, capture, helpers, local filter |
| `overlay.html` | companion, ring, drag select, toast, reader panel |
| `uiahelper.ps1` | UIA focused-field reader |
| `keyhelper.ps1` | injects `Ctrl+C` / `Ctrl+Insert` |
| `shifthelper.ps1` | `WH_KEYBOARD_LL` double-tap Shift watch |
| `start.cmd` · `start-reader.cmd` · `stop.cmd` | launchers |

---

## 03 · Build log — eight walls, eight fixes

1. **Overlay vanished under content-protection** → `setContentProtection` kills a transparent layered window. Hide the UI two frames before each capture instead.
2. **Crops came out blurry** → capture was in DIP. Request thumbnail at `size × scaleFactor`, map the cursor at 1.25×.
3. **App "kept stopping"** → not Windows — it was a child of a background task that got killed. Launch detached.
4. **`Ctrl+C` killed the running command in terminals** → send `Ctrl+Insert` there — copies a selection, harmless without one.
5. **Modifier-only hotkey impossible via `globalShortcut`** → low-level keyboard hook in PowerShell, clean double-tap detection.
6. **UIA patterns returned null in the spawned process** → a cached `$var::Pattern` skips the static init. Use the literal `::Pattern`.
7. **Launcher path corrupted — `node_modules□lectron`** → `printf` turned `\e` into an ESC byte. Write the file directly.
8. **Launcher failed — path ended in a stray quote** → `%~dp0` trailing `\` escaped the closing quote. Strip it: `%DIR:~0,-1%`.

---

## 04 · Verified, not assumed

- window ex-styles — **`0x8080028`**
- hit-test → app below **passes** (click-through confirmed)
- ring in crop — **0 px** (overlay excluded from capture)
- clipboard — **restored** after grab
- double-tap Shift — **2 hit / 2 miss** on injected patterns
- local filter — **10 / 10** sample strings classified correctly
- Slack — **53 live reads**, `src=value`
- helper stderr — **0**

---

## 05 · Known limits

- Overlay is 912 px tall — nothing selectable over the taskbar
- Clipboard restore covers text / html / image, not copied files
- `getSources` adds ~0.8 s latency per capture
- WebView2 apps are blind to passive read → image path
- Global keyboard hook may trip Defender on a managed laptop
- Double-tap Shift collides with JetBrains Search Everywhere

---

## 06 · Next — wiring over the gate

The gate is passed, so the rest is wiring over what already exists: the read, the filter, the toast, the gesture.

1. **Debounce** 600–800 ms after a filter PASS → call the model with the field text
2. Model decides if there's anything to propose — **usually nothing**, screen stays quiet
3. If yes → a short **proposal in the toast** beside the cursor
4. **Double-tap** executes · ignore it and it dies in a few seconds

**Blocked on one input:** which model / API and key to call.

---

*project 1 · Electron 32 · Windows 11 · spike complete, gate green*
