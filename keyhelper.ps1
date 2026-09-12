# Key helper for the overlay: started once by main.js, reads one command per line on stdin.
#   copy  -> waits for the hotkey's modifiers to be released, then sends Ctrl+C to the foreground app
# Replies one line per command: "sent <proc>" | "skip <proc>" (terminal) | "busy <proc>" (modifiers still held)

Add-Type @"
using System; using System.Runtime.InteropServices;
public static class K {
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vk);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte sc, uint fl, UIntPtr ex);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
"@

# in these, Ctrl+C with nothing selected interrupts the running command, so they get Ctrl+Insert
$terminals = 'WindowsTerminal', 'cmd', 'powershell', 'pwsh', 'conhost', 'OpenConsole', 'mintty'

function Down($vk) { ([K]::GetAsyncKeyState($vk) -band 0x8000) -ne 0 }
function ForegroundProc {
  $procId = [uint32]0
  [void][K]::GetWindowThreadProcessId([K]::GetForegroundWindow(), [ref]$procId)
  $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
  if ($p) { $p.ProcessName } else { '?' }
}
function Reply($s) { [Console]::Out.WriteLine($s); [Console]::Out.Flush() }

Reply 'ready'
while ($true) {
  $cmd = [Console]::In.ReadLine()
  if ($null -eq $cmd) { break }
  if ($cmd -ne 'copy') { Reply "unknown $cmd"; continue }

  # Ctrl / Shift / Alt / Win must be up, otherwise the app sees Ctrl+Shift+C instead of Ctrl+C
  $deadline = [DateTime]::Now.AddMilliseconds(1500)
  while ((Down 0x11) -or (Down 0x10) -or (Down 0x12) -or (Down 0x5B) -or (Down 0x5C)) {
    if ([DateTime]::Now -gt $deadline) { break }
    Start-Sleep -Milliseconds 15
  }

  $name = ForegroundProc
  if ((Down 0x11) -or (Down 0x10)) { Reply "busy $name"; continue }

  # terminals: Ctrl+Insert copies the selection and is harmless without one; Ctrl+C would interrupt
  $key = 0x43; $label = 'sent'
  if ($terminals -contains $name) { $key = 0x2D; $label = 'sent-ins' }

  [K]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 10   # Ctrl down
  [K]::keybd_event($key, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 10   # C / Insert down
  [K]::keybd_event($key, 0, 2, [UIntPtr]::Zero); Start-Sleep -Milliseconds 10   # C / Insert up
  [K]::keybd_event(0x11, 0, 2, [UIntPtr]::Zero)                                 # Ctrl up
  Reply "$label $name"
}
