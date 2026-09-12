# UI Automation reader for the overlay: reads the text of whatever field has keyboard focus.
#   once  -> read the focused field now, print one JSON line, exit
#   loop  -> poll ~4x/s, print a JSON line whenever the focused field or its text changes
# JSON: {"app":"slack","type":"Edit","len":42,"text":"...","hwnd":123,"src":"value"}

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class FG {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@

$AE   = [System.Windows.Automation.AutomationElement]
# Access the static ::Pattern via the literal type (forces the lazy static ctor to run;
# caching the type in a variable and using $var::Pattern yields $null in a fresh process).
$valPat = [System.Windows.Automation.ValuePattern]::Pattern
$txtPat = [System.Windows.Automation.TextPattern]::Pattern
$CAP  = 4000

function ProcName($procId) {
  $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
  if ($p) { $p.ProcessName } else { "?" }
}

function ReadFocused {
  try {
    $el = $AE::FocusedElement
  } catch { return $null }
  if ($null -eq $el) { return $null }

  # Read text from an element via ValuePattern (edits) or TextPattern (rich/multiline)
  function ReadEl($e) {
    try {
      $vp = $null
      if ($valPat -and $e.TryGetCurrentPattern($valPat, [ref]$vp)) {
        $v = $vp.Current.Value
        if (-not [string]::IsNullOrEmpty($v)) { return @($v, 'value') }
      }
    } catch {}
    try {
      $tp = $null
      if ($txtPat -and $e.TryGetCurrentPattern($txtPat, [ref]$tp)) {
        $v = $tp.DocumentRange.GetText($CAP)
        if (-not [string]::IsNullOrEmpty($v)) { return @($v, 'text') }
      }
    } catch {}
    return $null
  }

  $text = $null; $src = "none"
  $r = ReadEl $el
  if ($r) { $text = $r[0]; $src = $r[1] }

  # Fallback for WebView2/Chromium containers: FocusedElement returns the outer Pane, so
  # look for the descendant that actually holds keyboard focus and read that.
  if ([string]::IsNullOrEmpty($text)) {
    try {
      $cond = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::HasKeyboardFocusProperty, $true)
      $inner = $el.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
      if ($inner -and $inner -ne $el) {
        $r = ReadEl $inner
        if ($r) { $text = $r[0]; $src = $r[1] + "+focus"; $el = $inner }
      }
    } catch {}
  }
  # Name as last resort (some controls expose the typed text only as Name)
  if ($null -eq $text) {
    try { $text = $el.Current.Name; $src = "name" } catch {}
  }
  if ($null -eq $text) { $text = "" }
  if ($text.Length -gt $CAP) { $text = $text.Substring(0, $CAP) }

  $procId = 0; try { $procId = $el.Current.ProcessId } catch {}
  $type = "?"; try { $type = $el.Current.ControlType.ProgrammaticName -replace 'ControlType\.','' } catch {}

  [pscustomobject]@{
    app  = ProcName $procId
    type = $type
    len  = $text.Length
    text = $text
    hwnd = [int64][FG]::GetForegroundWindow()
    src  = $src
  }
}

function Emit($o) {
  if ($null -eq $o) { return }
  [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
}

if ($args -contains 'once') {
  $r = ReadFocused
  if ($null -eq $r) { [Console]::Out.WriteLine('{"app":"?","type":"?","len":0,"text":"","src":"nofocus"}') }
  else { Emit $r }
  return
}

[Console]::Out.WriteLine('ready'); [Console]::Out.Flush()
$lastKey = ""
while ($true) {
  $r = ReadFocused
  if ($null -ne $r) {
    $key = "$($r.hwnd)|$($r.type)|$($r.text)"
    if ($key -ne $lastKey) { $lastKey = $key; Emit $r }
  }
  Start-Sleep -Milliseconds 250
}
