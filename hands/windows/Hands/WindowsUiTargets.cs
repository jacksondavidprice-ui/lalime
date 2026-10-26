using System.Runtime.InteropServices;
using System.Text;
using FlaUI.Core.AutomationElements;
using FlaUI.UIA3;

namespace Lalime.Hands;

internal static class WindowsUiTargets
{
    internal sealed record Window(string Title, AutomationElement Root);

    internal static List<Window> Enumerate(UIA3Automation automation)
    {
        var result = new List<Window>();
        EnumWindows((handle, _) =>
        {
            if (!IsWindowVisible(handle)) return true;
            try
            {
                var outer = automation.FromHandle(handle);
                var title = outer.Name ?? "";
                if (string.IsNullOrWhiteSpace(title)) return true;
                // ApplicationFrameHost can own the outer HWND while the controls
                // belong to a child CoreWindow in the Settings process.
                var hosted = new List<IntPtr>();
                EnumChildWindows(handle, (child, _) =>
                {
                    var className = new StringBuilder(256);
                    GetClassName(child, className, className.Capacity);
                    if (IsWindowVisible(child) && className.ToString() == "Windows.UI.Core.CoreWindow") hosted.Add(child);
                    return true;
                }, IntPtr.Zero);
                var root = hosted.Count == 1 ? automation.FromHandle(hosted[0]) : outer;
                result.Add(new Window(title, root));
            }
            catch { /* A window can close during enumeration. */ }
            return true;
        }, IntPtr.Zero);
        return result;
    }

    private delegate bool WindowCallback(IntPtr handle, IntPtr parameter);
    [DllImport("user32.dll")]
    private static extern bool EnumWindows(WindowCallback callback, IntPtr parameter);
    [DllImport("user32.dll")]
    private static extern bool EnumChildWindows(IntPtr parent, WindowCallback callback, IntPtr parameter);
    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr handle);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr handle, StringBuilder className, int maximum);
}
