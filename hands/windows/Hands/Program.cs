// Lalime Hands.exe — Windows sidecar (stdio JSON lines).
// Build on Windows: pwsh scripts/build-hands-windows.ps1

using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
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
    [STAThread]
    private static void Main(string[] args)
    {
        WindowsProcessLifetime.ContainCurrentProcess();
        if (args.Contains("--elevated-worker"))
        {
            Environment.ExitCode = ElevatedCommandBroker.RunWorker(args, ExecutePowerShell);
            return;
        }
        if (args.Contains("--powershell-worker"))
        {
            RunPowerShellWorker();
            return;
        }
        if (args.Contains("--stdio") || args.Length == 0)
        {
            RunStdio();
            return;
        }
        Console.WriteLine("Lalime Hands — pass --stdio for JSON lines");
    }

    private static void RunStdio()
    {
        using var requests = new System.Collections.Concurrent.BlockingCollection<string>(128);
        _ = Task.Run(() =>
        {
            try
            {
                string? request;
                while ((request = Console.ReadLine()) is not null)
                    if (!requests.TryAdd(request)) Environment.Exit(1);
            }
            finally
            {
                // EOF means the host is gone, even if Dispatch is still running.
                // Exit closes this process's job and any elevated-worker pipe.
                Environment.Exit(0);
            }
        });
        foreach (var line in requests.GetConsumingEnumerable())
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            var id = "";
            try
            {
                using var doc = JsonDocument.Parse(line);
                var root = doc.RootElement;
                id = root.GetProperty("id").GetString() ?? "";
                var method = root.GetProperty("method").GetString() ?? "";
                var paramsEl = root.TryGetProperty("params", out var p) ? p : default;
                var response = Dispatch(method, paramsEl);
                response["id"] = id;
                Console.WriteLine(JsonSerializer.Serialize(response));
            }
            catch (Exception ex)
            {
                Console.WriteLine(JsonSerializer.Serialize(new { id, ok = false, output = ex.Message }));
            }
        }
    }

    private static Dictionary<string, object?> Dispatch(string method, JsonElement paramsEl) =>
        method switch
        {
            "powershell.astCheck" => AstCheck(Str(paramsEl, "command")),
            "powershell.run" => RunPowerShell(Str(paramsEl, "command"), Str(paramsEl, "summary"),
                paramsEl.TryGetProperty("admin", out var admin) && admin.ValueKind == JsonValueKind.True),
            "settings.open" => OpenSettings(Str(paramsEl, "uri")),
            "screen.capture" => CaptureScreen(),
            "uia.listWindows" => ListWindows(),
            "uia.list" => ListElements(Str(paramsEl, "windowTitle")),
            "uia.click" => Click(Str(paramsEl, "name"), Str(paramsEl, "windowTitle")),
            "uia.type" => TypeText(Str(paramsEl, "text"), Str(paramsEl, "windowTitle")),
            "uia.setValue" => SetElementValue(Str(paramsEl, "name"), Str(paramsEl, "value"), Str(paramsEl, "windowTitle")),
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

    private static Dictionary<string, object?> RunPowerShell(string command, string summary, bool admin = false)
    {
        var check = AstCheck(command);
        if (check["ok"] is false) return check;

        if (admin) return ElevatedCommandBroker.Run(command, System.Diagnostics.Process.Start);

        // A separate job must end with each action, even when its shell exits first.
        var psi = new System.Diagnostics.ProcessStartInfo
        {
            FileName = Environment.ProcessPath ?? throw new InvalidOperationException("Hands executable path is unavailable."),
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };
        psi.ArgumentList.Add("--powershell-worker");
        using var worker = System.Diagnostics.Process.Start(psi);
        if (worker is null) return Fail("Could not start the PowerShell worker.");
        try
        {
            var stdout = worker.StandardOutput.ReadToEndAsync();
            var stderr = worker.StandardError.ReadToEndAsync();
            worker.StandardInput.WriteLine(JsonSerializer.Serialize(command));
            worker.StandardInput.Close();
            worker.WaitForExit();
            if (!Task.WaitAll(new Task[] { stdout, stderr }, 1_000))
                return Fail("PowerShell worker output did not close.");
            if (worker.ExitCode != 0) return Fail("PowerShell worker failed. Its child processes were stopped.");
            return JsonSerializer.Deserialize<Dictionary<string, object?>>(stdout.Result)
                ?? Fail("PowerShell worker returned no result.");
        }
        finally
        {
            if (!worker.HasExited)
            {
                worker.Kill(entireProcessTree: true);
                worker.WaitForExit(1_000);
            }
        }
    }

    private static void RunPowerShellWorker()
    {
        Dictionary<string, object?> response;
        try
        {
            var command = JsonSerializer.Deserialize<string>(Console.ReadLine() ?? "")
                ?? throw new InvalidOperationException("PowerShell command is required.");
            response = ExecutePowerShell(command);
        }
        catch (Exception ex)
        {
            response = Fail(ex.Message);
        }
        Console.WriteLine(JsonSerializer.Serialize(response));
        // Main returns immediately. The OS then closes this worker's job handle.
    }

    private static Dictionary<string, object?> ExecutePowerShell(string command)
    {
        var check = AstCheck(command);
        if (check["ok"] is false) return check;
        var psi = new System.Diagnostics.ProcessStartInfo
        {
            FileName = "powershell.exe",
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };
        psi.ArgumentList.Add("-NoProfile");
        psi.ArgumentList.Add("-NonInteractive");
        psi.ArgumentList.Add("-Command");
        psi.ArgumentList.Add(command);
        using var proc = System.Diagnostics.Process.Start(psi);
        if (proc is null) return Fail("Could not start PowerShell");
        var stdoutTask = ReadBoundedOutput(proc.StandardOutput);
        var stderrTask = ReadBoundedOutput(proc.StandardError);
        proc.WaitForExit();
        if (!Task.WaitAll(new Task[] { stdoutTask, stderrTask }, 3_000))
            return Fail("PowerShell output did not close. Completed changes cannot be undone automatically.");
        var stdout = stdoutTask.Result;
        var stderr = stderrTask.Result;
        return new Dictionary<string, object?>
        {
            ["ok"] = proc.ExitCode == 0,
            ["output"] = string.IsNullOrWhiteSpace(stdout) ? stderr : stdout
        };
    }

    private static async Task<string> ReadBoundedOutput(StreamReader reader)
    {
        const int limit = 65_536;
        var output = new System.Text.StringBuilder();
        var buffer = new char[4096];
        var truncated = false;
        int count;
        while ((count = await reader.ReadAsync(buffer)) != 0)
        {
            var keep = Math.Min(count, limit - output.Length);
            output.Append(buffer, 0, keep);
            truncated |= keep != count;
        }
        if (truncated) output.Append("\n[Output truncated]");
        return output.ToString();
    }

    private static Dictionary<string, object?> OpenSettings(string uri)
    {
        if (!Regex.IsMatch(uri, @"\Ams-settings:[a-z0-9-]*\z", RegexOptions.IgnoreCase))
            return Fail("Invalid Windows Settings URI.");
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
        var windows = WindowsUiTargets.Enumerate(automation)
            .Select(w => new { title = w.Title, pid = w.Root.Properties.ProcessId.ValueOrDefault })
            .Where(w => !string.IsNullOrWhiteSpace(w.title))
            .Take(40)
            .Cast<object>()
            .ToList();
        return new Dictionary<string, object?> { ["ok"] = true, ["windows"] = windows, ["output"] = "ok" };
    }

    private static Dictionary<string, object?> ListElements(string windowTitle)
    {
        using var automation = new UIA3Automation();
        var root = string.IsNullOrWhiteSpace(windowTitle) ? automation.GetDesktop() : FindWindow(automation, windowTitle);
        if (root is null) return Fail($"Window not found or ambiguous: {windowTitle}");
        var elements = root.FindAllDescendants()
            .Select(e => new
            {
                name = e.Name ?? "",
                controlType = e.ControlType.ToString(),
                automationId = e.Properties.AutomationId.ValueOrDefault ?? ""
            })
            .Where(e => !string.IsNullOrWhiteSpace(e.name))
            .Take(80)
            .Cast<object>()
            .ToList();
        return new Dictionary<string, object?> { ["ok"] = true, ["elements"] = elements, ["output"] = "ok" };
    }

    private static Dictionary<string, object?> Click(string name, string windowTitle)
    {
        if (string.IsNullOrWhiteSpace(windowTitle) || string.IsNullOrWhiteSpace(name))
            return Fail("A window title and element name are required.");
        using var automation = new UIA3Automation();
        var root = FindWindow(automation, windowTitle);
        if (root is null) return Fail($"Window not found or ambiguous: {windowTitle}");
        var elements = root.FindAllDescendants(cf => cf.ByName(name)).Where(CanClick).ToArray();
        if (elements.Length != 1) return Fail($"Element not found or ambiguous: {name}");
        var element = elements[0];
        if (!element.IsEnabled) return Fail("The requested element is disabled.");
        if (element.Patterns.Invoke.PatternOrDefault is { } invoke) invoke.Invoke();
        else if (element.Patterns.Toggle.PatternOrDefault is { } toggle) toggle.Toggle();
        else if (element.Patterns.SelectionItem.PatternOrDefault is { } selection) selection.Select();
        else element.Click();
        return Ok($"Clicked {name}");
    }

    private static bool CanClick(AutomationElement element) => element.IsEnabled
        && !element.Properties.IsPassword.ValueOrDefault
        && (element.Patterns.Invoke.PatternOrDefault is not null
            || element.Patterns.Toggle.PatternOrDefault is not null
            || element.Patterns.SelectionItem.PatternOrDefault is not null
            || element.ControlType is FlaUI.Core.Definitions.ControlType.Button
                or FlaUI.Core.Definitions.ControlType.Hyperlink or FlaUI.Core.Definitions.ControlType.ComboBox
                or FlaUI.Core.Definitions.ControlType.Edit or FlaUI.Core.Definitions.ControlType.TabItem);

    private static bool CanSetValue(AutomationElement element) => element.IsEnabled
        && !element.Properties.IsPassword.ValueOrDefault
        && (element.Patterns.Toggle.PatternOrDefault is not null
            || element.Patterns.RangeValue.PatternOrDefault is not null
            || element.ControlType == FlaUI.Core.Definitions.ControlType.ComboBox
            || (element.ControlType == FlaUI.Core.Definitions.ControlType.Edit && element.Patterns.Value.PatternOrDefault is not null));

    private static Dictionary<string, object?> SetElementValue(string name, string value, string windowTitle)
    {
        if (string.IsNullOrWhiteSpace(windowTitle) || string.IsNullOrWhiteSpace(name))
            return Fail("A window title and element name are required.");
        using var automation = new UIA3Automation();
        var root = FindWindow(automation, windowTitle);
        if (root is null) return Fail($"Window not found or ambiguous: {windowTitle}");
        var elements = root.FindAllDescendants(cf => cf.ByName(name)).Where(CanSetValue).ToArray();
        if (elements.Length != 1) return Fail($"Element not found or ambiguous: {name}");
        var element = elements[0];
        if (!element.IsEnabled || element.Properties.IsPassword.ValueOrDefault)
            return Fail("Disabled controls and password fields are not supported.");
        if (element.Patterns.Toggle.PatternOrDefault is { } toggle)
        {
            var requested = value.ToLowerInvariant() switch
            {
                "on" or "true" => FlaUI.Core.Definitions.ToggleState.On,
                "off" or "false" => FlaUI.Core.Definitions.ToggleState.Off,
                _ => (FlaUI.Core.Definitions.ToggleState?)null
            };
            if (requested is null) return Fail("Use on or off for this switch.");
            for (var attempt = 0; attempt < 3 && toggle.ToggleState.Value != requested; attempt++) toggle.Toggle();
            return toggle.ToggleState.Value == requested ? Ok($"Set {name} to {value}") : Fail("The switch did not reach the requested state.");
        }
        if (element.Patterns.RangeValue.PatternOrDefault is { } range)
        {
            if (range.IsReadOnly.Value || !double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var number)
                || !double.IsFinite(number) || number < range.Minimum.Value || number > range.Maximum.Value)
                return Fail("Use a number within this control's allowed range.");
            range.SetValue(number);
            return Ok($"Set {name} to {value}");
        }
        if (element.ControlType == FlaUI.Core.Definitions.ControlType.ComboBox)
        {
            var combo = element.AsComboBox();
            combo.Expand();
            try
            {
                var matches = combo.Items.Where(item => item.Name == value).ToArray();
                if (matches.Length != 1) return Fail("The requested option was not found or is ambiguous.");
                matches[0].Select();
                return Ok($"Set {name} to {value}");
            }
            finally { combo.Collapse(); }
        }
        if (element.ControlType == FlaUI.Core.Definitions.ControlType.Edit
            && element.Patterns.Value.PatternOrDefault is { } text && !text.IsReadOnly.Value)
        {
            text.SetValue(value);
            return Ok($"Set {name}");
        }
        return Fail("This control does not support setting a value.");
    }

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    private static Dictionary<string, object?> TypeText(string text, string windowTitle)
    {
        if (string.IsNullOrWhiteSpace(windowTitle)) return Fail("A window title is required.");
        using var automation = new UIA3Automation();
        var window = FindWindow(automation, windowTitle);
        if (window is null) return Fail($"Window not found or ambiguous: {windowTitle}");
        var targetHandle = window.Properties.NativeWindowHandle.ValueOrDefault;
        if (targetHandle == IntPtr.Zero || GetAncestor(targetHandle, 2) != GetForegroundWindow())
            return Fail("The requested window must be in the foreground.");
        var focused = automation.FocusedElement();
        if (focused is null || focused.Properties.ProcessId.ValueOrDefault != window.Properties.ProcessId.ValueOrDefault)
            return Fail("The focused field is not in the requested window.");
        if (focused.Properties.IsPassword.ValueOrDefault) return Fail("Password fields are not supported.");
        var value = focused.Patterns.Value.PatternOrDefault;
        if (value is null || value.IsReadOnly.Value) return Fail("The focused field does not support text entry.");
        // ValuePattern treats braces, modifiers, and newlines as text, not shortcuts.
        value.SetValue(text);
        return Ok("Set the focused field text");
    }

    [DllImport("user32.dll")]
    private static extern IntPtr GetAncestor(IntPtr window, uint flags);

    private static Dictionary<string, object?> Undo(string journalId)
    {
        return Fail("Automatic undo is not available. Restore recycled items manually from the Windows Recycle Bin.");
    }

    private static AutomationElement? FindWindow(UIA3Automation automation, string title)
    {
        if (string.IsNullOrWhiteSpace(title)) return null;
        var matches = WindowsUiTargets.Enumerate(automation).Where(window => window.Title == title).ToArray();
        return matches.Length == 1 ? matches[0].Root : null;
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

}
