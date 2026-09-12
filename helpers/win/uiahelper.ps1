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

  function ReadEl($e) {
    try {
      if (-not $e.Current.HasKeyboardFocus -or -not $e.Current.IsEnabled) { return $null }
    } catch { return $null }

    $type = "?"
    try { $type = $e.Current.ControlType.ProgrammaticName -replace 'ControlType\.','' } catch {}

    try {
      $vp = $null
      if ($valPat -and $e.TryGetCurrentPattern($valPat, [ref]$vp)) {
        if ($vp.Current.IsReadOnly) { return $null }
        $v = $vp.Current.Value
        return @([string]$v, 'value')
      }
    } catch {}

    if ($type -notin @('Edit', 'Document')) { return $null }
    try {
      $tp = $null
      if ($txtPat -and $e.TryGetCurrentPattern($txtPat, [ref]$tp)) {
        $readOnly = $tp.DocumentRange.GetAttributeValue([System.Windows.Automation.TextPattern]::IsReadOnlyAttribute)
        if ($readOnly -is [bool] -and $readOnly) { return $null }
        $v = $tp.DocumentRange.GetText($CAP)
        return @([string]$v, 'text')
      }
    } catch {}
    return $null
  }

  $r = ReadEl $el
  if ($null -eq $r) {
    try {
      $cond = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::HasKeyboardFocusProperty, $true)
      $inner = $el.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
      if ($inner -and $inner -ne $el) {
        $r = ReadEl $inner
        if ($null -ne $r) { $r[1] = $r[1] + "+focus"; $el = $inner }
      }
    } catch {}
  }
  if ($null -eq $r) { return $null }

  $text = [string]$r[0]
  $src = [string]$r[1]
  if ($text.Length -gt $CAP) { $text = $text.Substring(0, $CAP) }

  $procId = 0; try { $procId = $el.Current.ProcessId } catch {}
  $type = "?"; try { $type = $el.Current.ControlType.ProgrammaticName -replace 'ControlType\.','' } catch {}
  $runtime = ""; try { $runtime = $el.GetRuntimeId() -join '.' } catch {}
  $automationId = ""; try { $automationId = $el.Current.AutomationId } catch {}
  $hwnd = [int64][FG]::GetForegroundWindow()
  $field = "$procId|$runtime"
  if ([string]::IsNullOrEmpty($runtime)) { $field = "$procId|$hwnd|$type|$automationId" }

  [pscustomobject]@{
    app  = ProcName $procId
    type = $type
    len  = $text.Length
    text = $text
    hwnd = $hwnd
    src  = $src
    field = $field
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
$lastTextByField = @{}
while ($true) {
  $r = ReadFocused
  if ($null -ne $r) {
    $field = [string]$r.field
    if (-not $lastTextByField.ContainsKey($field)) {
      $lastTextByField[$field] = [string]$r.text
      $r | Add-Member -NotePropertyName changed -NotePropertyValue $false
      Emit $r
    } elseif ([string]$lastTextByField[$field] -cne [string]$r.text) {
      $lastTextByField[$field] = [string]$r.text
      $r | Add-Member -NotePropertyName changed -NotePropertyValue $true
      Emit $r
    }
  }
  Start-Sleep -Milliseconds 250
}
