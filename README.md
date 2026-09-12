# Cursor Overlay

Crewboard desktop helper: create tasks with context and files, follow active work, and open completed results. On Windows, a cursor overlay reads editable fields via UI Automation and opens a screenshot selection on double-tap Shift when no task proposal is visible.

Download the installer for your computer from [GitHub Releases](https://github.com/mmvinfo28/cursor-overlay/releases/latest).

## Using the helper

- Open Crewboard from its tray/menu bar icon, or press **Ctrl+Shift+C** on Windows / **Cmd+Shift+C** on Mac.
- Click **Add** to write a task and context, or drag files from Explorer/Finder into the helper. Review the draft, then click **Send to crew**.
- **Tasks** contains unfinished work; completed tasks move to **Done** and their deliverables appear in **Results**. Files also sync to the Crewboard Results folder under OneDrive, when available, or Documents.
- On Windows, double-tap **Shift** to select a screenshot region. Drag a rectangle, or double-tap Shift again to capture around the cursor. **Esc** cancels. A visible task proposal opens its draft instead; double-tap Shift in an open draft sends it.
- **Control+Shift+Space** is the screenshot shortcut on either platform. Capture currently uses the primary display.

## Mac installation and current support

1. Download `Crewboard-<version>-arm64.dmg` for an Apple Silicon Mac (M-series), or `Crewboard-<version>-x64.dmg` for an Intel Mac.
2. Open the DMG and copy Crewboard to Applications, then open it. Current builds are unsigned. If macOS blocks the app and you trust this download, use **System Settings → Privacy & Security → Open Anyway**, following [Apple's instructions](https://support.apple.com/guide/mac-help/mh40616/mac).
3. Use the menu bar icon or **Cmd+Shift+C** to open the helper. For screenshots, grant Crewboard screen recording access when macOS requests it, then reopen the app if prompted.

Task creation, file drop, context, and result sync are available on Mac. Double-Shift detection and automatic reading of focused fields currently use Windows helpers and are not implemented on Mac; use **Control+Shift+Space** or the composer's **Region** button for screenshots. Mac capture needs verification on a Mac; it cannot be verified by the Windows tests.

Mac updates currently require downloading the new DMG and replacing the app in Applications. Automatic Mac updates require a signed app and ZIP update payload, as described in the [electron-builder update requirements](https://www.electron.build/docs/features/auto-update/). Windows checks for updates at startup and hourly, downloads them automatically, and restarts after the current draft or screenshot finishes. The tray menu also has **Check for updates**.

## Development

```bash
npm install
start.cmd          # overlay
start-reader.cmd   # overlay + live field reader
stop.cmd           # kill everything
```

- [HANDOFF.md](HANDOFF.md) — start here: status, architecture, next steps
- [REPORT.md](REPORT.md) — feasibility spike report
- [HACKATHON.md](HACKATHON.md) — build-day plan
