// Lalime Hands.exe — Windows sidecar (stdio JSON lines).
// Build on Windows: pwsh scripts/build-hands-windows.ps1

using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Windows.Forms;
using FlaUI.Core.AutomationElements;
using FlaUI.Core.Conditions;
using FlaUI.UIA3;

namespace Lalime.Hands;

internal static class Program
{
    private static readonly Dictionary<string, Action> Journal = new();

    [STAThread]
    private static void Main(string[] args)
    {
        if (args.Contains("--stdio") || args.Length == 0)
        {
            RunStdio();
            return;
        }
        Console.WriteLine("Lalime Hands — pass --stdio for JSON lines");
    }

    private static void RunStdio()
    {
        string? line;
        while ((line = Console.ReadLine()) != null)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            try
            {
                using var doc = JsonDocument.Parse(line);
                var root = doc.RootElement;
                var id = root.GetProperty("id").GetString() ?? "";
                var method = root.GetProperty("method").GetString() ?? "";
                var paramsEl = root.TryGetProperty("params", out var p) ? p : default;
                var response = Dispatch(method, paramsEl);
                response["id"] = id;
                Console.WriteLine(JsonSerializer.Serialize(response));
            }
            catch (Exception ex)
            {
                Console.WriteLine(JsonSerializer.Serialize(new { id = "", ok = false, output = ex.Message }));
            }
        }
    }

    private static Dictionary<string, object?> Dispatch(string method, JsonElement paramsEl) =>
        method switch
        {
            "powershell.astCheck" => AstCheck(Str(paramsEl, "command")),
            "powershell.run" => RunPowerShell(Str(paramsEl, "command"), Str(paramsEl, "summary")),
            "files.recycle" => Recycle(paramsEl),
            "settings.open" => OpenSettings(Str(paramsEl, "uri")),
            "screen.capture" => CaptureScreen(),
            "uia.listWindows" => ListWindows(),
            "uia.list" => ListElements(Str(paramsEl, "windowTitle")),
            "uia.click" => Click(Str(paramsEl, "name"), Str(paramsEl, "windowTitle")),
            "uia.type" => TypeText(Str(paramsEl, "text")),
            "journal.undo" => Undo(Str(paramsEl, "journalId")),
            "stop" => Ok("stopped"),
            _ => Fail($"Unknown method: {method}")
        };

    private static Dictionary<string, object?> AstCheck(string command)
    {
        // JACKSON: Replace with System.Management.Automation.Language.Parser (see PowerShellAstGuard.cs).
        var lower = command.ToLowerInvariant();
        if (Regex.IsMatch(lower, @"-encodedcommand|\s-enc\s") ||
            (lower.Contains("iex") && lower.Contains("download")) ||
            (lower.Contains("invoke-expression") && lower.Contains("download")) ||
            lower.Contains("frombase64string"))
        {
            return Fail("Encoded or download-and-run PowerShell is blocked by Hands.");
        }
        return Ok("Pre-check passed");
    }

    private static Dictionary<string, object?> RunPowerShell(string command, string summary)
    {
        var check = AstCheck(command);
        if (check["ok"] is false) return check;

        var psi = new System.Diagnostics.ProcessStartInfo
        {
            FileName = "powershell.exe",
            Arguments = "-NoProfile -NonInteractive -Command " + Quote(command),
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };
        using var proc = System.Diagnostics.Process.Start(psi);
        if (proc is null) return Fail("Could not start PowerShell");
        var stdout = proc.StandardOutput.ReadToEnd();
        var stderr = proc.StandardError.ReadToEnd();
        proc.WaitForExit(60_000);
        var jid = "j_" + Guid.NewGuid().ToString("N")[..8];
        Journal[jid] = () => { };
        return new Dictionary<string, object?>
        {
            ["ok"] = proc.ExitCode == 0,
            ["output"] = string.IsNullOrWhiteSpace(stdout) ? stderr : stdout,
            ["journalId"] = jid
        };
    }

    private static Dictionary<string, object?> Recycle(JsonElement paramsEl)
    {
        var paths = new List<string>();
        if (paramsEl.TryGetProperty("paths", out var arr) && arr.ValueKind == JsonValueKind.Array)
        {
            foreach (var x in arr.EnumerateArray())
            {
                if (x.ValueKind == JsonValueKind.String) paths.Add(x.GetString()!);
            }
        }
        var shell = new RecycleBin();
        foreach (var path in paths) shell.Send(path);
        var jid = "j_" + Guid.NewGuid().ToString("N")[..8];
        Journal[jid] = () => { };
        return new Dictionary<string, object?>
        {
            ["ok"] = true,
            ["output"] = $"Moved {paths.Count} item(s) to Recycle Bin",
            ["journalId"] = jid
        };
    }

    private static Dictionary<string, object?> OpenSettings(string uri)
    {
        System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
        {
            FileName = uri,
            UseShellExecute = true
        });
        return Ok($"Opened {uri}");
    }

    private static Dictionary<string, object?> CaptureScreen()
    {
        var bounds = Screen.PrimaryScreen?.Bounds ?? new Rectangle(0, 0, 1280, 720);
        using var bmp = new Bitmap(bounds.Width, bounds.Height);
        using (var g = Graphics.FromImage(bmp))
        {
            g.CopyFromScreen(bounds.Location, Point.Empty, bounds.Size);
        }
        using var ms = new MemoryStream();
        bmp.Save(ms, ImageFormat.Png);
        var b64 = Convert.ToBase64String(ms.ToArray());
        return new Dictionary<string, object?>
        {
            ["ok"] = true,
            ["output"] = "screenshot captured",
            ["imageDataUrl"] = "data:image/png;base64," + b64
        };
    }

    private static Dictionary<string, object?> ListWindows()
    {
        using var automation = new UIA3Automation();
        var desktop = automation.GetDesktop();
        var windows = desktop.FindAllChildren()
            .Select(w => new { title = w.Name ?? "", pid = w.Properties.ProcessId.ValueOrDefault })
            .Where(w => !string.IsNullOrWhiteSpace(w.title))
            .Take(40)
            .Cast<object>()
            .ToList();
        return new Dictionary<string, object?> { ["ok"] = true, ["windows"] = windows, ["output"] = "ok" };
    }

    private static Dictionary<string, object?> ListElements(string windowTitle)
    {
        using var automation = new UIA3Automation();
        var root = FindWindow(automation, windowTitle) ?? automation.GetDesktop();
        var elements = root.FindAllDescendants()
            .Select(e => new
            {
                name = e.Name ?? "",
                controlType = e.ControlType.ToString(),
                automationId = e.AutomationId ?? ""
            })
            .Where(e => !string.IsNullOrWhiteSpace(e.name))
            .Take(80)
            .Cast<object>()
            .ToList();
        return new Dictionary<string, object?> { ["ok"] = true, ["elements"] = elements, ["output"] = "ok" };
    }

    private static Dictionary<string, object?> Click(string name, string windowTitle)
    {
        using var automation = new UIA3Automation();
        var root = FindWindow(automation, windowTitle) ?? automation.GetDesktop();
        var el = root.FindFirstDescendant(cf => cf.ByName(name));
        if (el is null) return Fail($"Element not found: {name}");
        el.Click();
        return Ok($"Clicked {name}");
    }

    private static Dictionary<string, object?> TypeText(string text)
    {
        SendKeys.SendWait(text);
        return Ok("Typed text");
    }

    private static Dictionary<string, object?> Undo(string journalId)
    {
        if (!Journal.TryGetValue(journalId, out var action)) return Fail("Nothing to undo.");
        action();
        Journal.Remove(journalId);
        return Ok("Undone");
    }

    private static AutomationElement? FindWindow(UIA3Automation automation, string title)
    {
        if (string.IsNullOrWhiteSpace(title)) return null;
        return automation.GetDesktop().FindFirstChild(cf => cf.ByName(title));
    }

    private static string Str(JsonElement el, string name)
    {
        if (el.ValueKind == JsonValueKind.Undefined) return "";
        return el.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString() ?? ""
            : "";
    }

    private static Dictionary<string, object?> Ok(string output) =>
        new() { ["ok"] = true, ["output"] = output };

    private static Dictionary<string, object?> Fail(string output) =>
        new() { ["ok"] = false, ["output"] = output };

    private static string Quote(string s) => "\"" + s.Replace("\"", "\\\"") + "\"";
}

internal sealed class RecycleBin
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct SHFILEOPSTRUCT
    {
        public IntPtr hwnd;
        public uint wFunc;
        public string pFrom;
        public string pTo;
        public ushort fFlags;
        public bool fAnyOperationsAborted;
        public IntPtr hNameMappings;
        public string lpszProgressTitle;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SHFileOperation(ref SHFILEOPSTRUCT fileOp);

    public void Send(string path)
    {
        var op = new SHFILEOPSTRUCT
        {
            wFunc = 3,
            pFrom = path + "\0\0",
            fFlags = 0x0040 | 0x0010 | 0x0200
        };
        SHFileOperation(ref op);
    }
}
