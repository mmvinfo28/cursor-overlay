# Double-tap Shift detector for the overlay: started once by main.js.
# Prints "ready" once, then "dtap" every time Shift is tapped twice in a row:
#   a tap  = Shift down and up within 300ms with no other key pressed while it was held
#   double = two taps at most 350ms apart, with no other key pressed in between

Add-Type -ReferencedAssemblies System.Windows.Forms @"
using System; using System.Runtime.InteropServices; using System.Windows.Forms;
public static class ShiftTap {
  delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SetWindowsHookEx(int id, HookProc cb, IntPtr mod, uint tid);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h, int code, IntPtr wParam, IntPtr lParam);
  [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string name);

  const int TAP_MAX = 300, GAP_MAX = 350;
  static HookProc proc = Callback;   // kept alive so the GC does not collect the delegate
  static IntPtr hook;
  static bool shiftDown, dirty;
  static long downAt, lastTap;

  public static void Run() {
    hook = SetWindowsHookEx(13, proc, GetModuleHandle(null), 0);   // 13 = WH_KEYBOARD_LL
    if (hook == IntPtr.Zero) { Say("hook failed " + Marshal.GetLastWin32Error()); return; }
    Say("ready");
    Application.Run();   // message loop, required for low-level hooks
  }

  static void Say(string s) { Console.Out.WriteLine(s); Console.Out.Flush(); }

  static IntPtr Callback(int code, IntPtr wParam, IntPtr lParam) {
    if (code >= 0) {
      int vk = Marshal.ReadInt32(lParam);                 // KBDLLHOOKSTRUCT.vkCode
      int msg = (int)wParam;
      bool down = msg == 0x100 || msg == 0x104;           // WM_KEYDOWN / WM_SYSKEYDOWN
      bool shift = vk == 0x10 || vk == 0xA0 || vk == 0xA1;
      long now = Environment.TickCount;
      if (shift) {
        if (down) {
          if (!shiftDown) { shiftDown = true; dirty = false; downAt = now; }
        } else {
          shiftDown = false;
          bool tap = !dirty && now - downAt <= TAP_MAX;
          if (tap && lastTap != 0 && now - lastTap <= GAP_MAX) { lastTap = 0; Say("dtap"); }
          else lastTap = tap ? now : 0;
        }
      } else if (down) {
        dirty = true;      // a real key while Shift is held: that was typing, not a tap
        lastTap = 0;       // and any key between taps breaks the double
      }
    }
    return CallNextHookEx(hook, code, wParam, lParam);
  }
}
"@
[ShiftTap]::Run()
