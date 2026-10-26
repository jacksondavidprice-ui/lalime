using System.IO;
using System.Reflection;
using System.Runtime.Loader;
using System.Runtime.InteropServices;
using System.Text.Json;

// Each action targets this process's unique offscreen form. No desktop input is sent.
var assemblyPath = Path.GetFullPath(args[0]);
AssemblyLoadContext.Default.Resolving += (_, name) =>
{
    var candidate = Path.Combine(Path.GetDirectoryName(assemblyPath)!, name.Name + ".dll");
    return File.Exists(candidate) ? AssemblyLoadContext.Default.LoadFromAssemblyPath(candidate) : null;
};
var hands = AssemblyLoadContext.Default.LoadFromAssemblyPath(assemblyPath).GetType("Lalime.Hands.Program")!;
var ready = new TaskCompletionSource<Fixture>();
var ui = new Thread(() =>
{
    try
    {
        using var form = new Fixture();
        form.Shown += (_, _) => ready.SetResult(form);
        Application.Run(form);
    }
    catch (Exception error) { ready.TrySetException(error); }
});
ui.SetApartmentState(ApartmentState.STA);
ui.IsBackground = true;
ui.Start();
var fixture = ready.Task.WaitAsync(TimeSpan.FromSeconds(10)).GetAwaiter().GetResult();
var failures = new List<string>();
var checks = 0;
JsonElement Call(string method, params object[] parameters) { var result = JsonSerializer.SerializeToElement(hands.GetMethod(method, BindingFlags.Static | BindingFlags.NonPublic)!.Invoke(null, parameters)); Console.WriteLine("RESULT " + method + " " + result); return result; }
bool Ok(JsonElement result) => result.GetProperty("ok").GetBoolean();
T OnUi<T>(Func<T> read) => (T)fixture.Invoke(read);
void Check(string name, Func<bool> assertion)
{
    try
    {
        if (!assertion()) throw new Exception("assertion returned false");
        checks++;
        Console.WriteLine("PASS " + name);
    }
    catch (Exception error)
    {
        failures.Add(name + ": " + error.GetBaseException().Message);
        Console.WriteLine("FAIL " + failures[^1]);
    }
}
try
{
    Check("duplicate label does not hide the unique actionable button", () =>
        Ok(Call("Click", "Apply fixture", fixture.Text)) && OnUi(() => fixture.Clicks) == 1);
    Check("two actionable controls with the same name fail without either click", () =>
        !Ok(Call("Click", "Ambiguous fixture", fixture.Text)) && OnUi(() => fixture.AmbiguousClicks) == 0);
    Check("toggle reaches requested on state", () =>
        Ok(Call("SetElementValue", "Fixture switch", "on", fixture.Text)) && OnUi(() => fixture.Switch.Checked));
    Check("repeating on is idempotent", () =>
        Ok(Call("SetElementValue", "Fixture switch", "on", fixture.Text)) && OnUi(() => fixture.Switch.Checked));
    Check("unsupported TrackBar value is refused without false success", () =>
        !Ok(Call("SetElementValue", "Fixture volume", "7", fixture.Text)) && OnUi(() => fixture.Volume.Value) == 0);
    Check("unsupported TrackBar out of range request leaves value unchanged", () =>
        !Ok(Call("SetElementValue", "Fixture volume", "99", fixture.Text)) && OnUi(() => fixture.Volume.Value) == 0);
    Check("WPF RangePattern sets slider numeric value", () =>
        Ok(Call("SetElementValue", "Fixture WPF range", "6", fixture.Text)) && OnUi(() => fixture.Range.Value) == 6);
    Check("combo chooses the exact named option", () =>
        Ok(Call("SetElementValue", "Fixture combo", "Quiet", fixture.Text)) && OnUi(() => fixture.Combo.SelectedItem?.ToString()) == "Quiet");
    Check("named search field receives literal text", () =>
        Ok(Call("SetElementValue", "Fixture search", "literal {ENTER} + ^ text", fixture.Text)) &&
        OnUi(() => fixture.Search.Text) == "literal {ENTER} + ^ text");
    Check("password field is refused", () =>
        !Ok(Call("SetElementValue", "Fixture password", "not a secret", fixture.Text)) && OnUi(() => fixture.Password.Text) == "");
    Check("disabled button is refused", () => !Ok(Call("Click", "Disabled fixture", fixture.Text)));
    Check("hosted CoreWindow content selected without outer content", () =>
    {
        var result = Call("ListElements", fixture.HostedTitle);
        if (!Ok(result)) return false;
        var names = result.GetProperty("elements").EnumerateArray().Select(e => e.GetProperty("name").GetString()).ToArray();
        return names.Contains("Inside hosted fixture") && !names.Contains("Outside hosted fixture");
    });
}
finally
{
    fixture.BeginInvoke(new Action(fixture.Close));
    if (!ui.Join(TimeSpan.FromSeconds(5))) failures.Add("Fixture UI thread did not stop.");
}
Console.WriteLine($"{checks} checks passed; {failures.Count} failed.");
Environment.ExitCode = failures.Count == 0 ? 0 : 1;

sealed class Fixture : Form
{
    public int Clicks, AmbiguousClicks;
    public CheckBox Switch = new() { AccessibleName = "Fixture switch", Text = "Fixture switch" };
    public TrackBar Volume = new() { AccessibleName = "Fixture volume", Minimum = 0, Maximum = 10 };
    public System.Windows.Controls.Slider Range = new() { Minimum = 0, Maximum = 10 };
    public System.Windows.Controls.ComboBox Combo = new();
    public TextBox Search = new() { AccessibleName = "Fixture search" };
    public TextBox Password = new() { AccessibleName = "Fixture password", UseSystemPasswordChar = true };
    public string HostedTitle { get; } = "Hands hosted fixture " + Guid.NewGuid().ToString("N");
    private Form? hosted;
    private Native.WindowProc? wndProc;
    protected override bool ShowWithoutActivation => true;
    public Fixture()
    {
        Text = "Hands UI fixture " + Guid.NewGuid().ToString("N");
        ShowInTaskbar = false; StartPosition = FormStartPosition.Manual;
        Location = new Point(-24000, -24000); Size = new Size(700, 650);
        var apply = new Button { Text = "Apply fixture", AccessibleName = "Apply fixture" };
        apply.Click += (_, _) => Clicks++;
        var controls = new List<Control> { new Label { Text = "Apply fixture", AccessibleName = "Apply fixture" }, apply };
        for (var i = 0; i < 2; i++)
        {
            var button = new Button { Text = "Ambiguous fixture", AccessibleName = "Ambiguous fixture" };
            button.Click += (_, _) => AmbiguousClicks++;
            controls.Add(button);
        }
        System.Windows.Automation.AutomationProperties.SetName(Range, "Fixture WPF range");
        var rangeHost = new System.Windows.Forms.Integration.ElementHost { Child = Range };
        System.Windows.Automation.AutomationProperties.SetName(Combo, "Fixture combo");
        // An inline template keeps all items offscreen and never creates a popup.
        Combo.Template = new System.Windows.Controls.ControlTemplate(typeof(System.Windows.Controls.ComboBox))
        { VisualTree = new System.Windows.FrameworkElementFactory(typeof(System.Windows.Controls.ItemsPresenter)) };
        Combo.Items.Add("Normal"); Combo.Items.Add("Quiet"); Combo.SelectedIndex = 0;
        var comboHost = new System.Windows.Forms.Integration.ElementHost { Child = Combo };
        controls.AddRange(new Control[] { Switch, Volume, rangeHost, comboHost, Search, Password,
            new Button { Text = "Disabled fixture", AccessibleName = "Disabled fixture", Enabled = false } });
        for (var i = 0; i < controls.Count; i++)
        {
            controls[i].Bounds = new Rectangle(10, 10 + i * 50, 350, 40);
            Controls.Add(controls[i]);
        }
    }
    protected override void OnShown(EventArgs e)
    {
        hosted = new OffscreenForm { Text = HostedTitle };
        hosted.Controls.Add(new Button { Text = "Outside hosted fixture", Bounds = new Rectangle(1, 1, 180, 30) });
        hosted.Show();
        wndProc = Native.DefWindowProc;
        var windowClass = new Native.WindowClass { size = (uint)Marshal.SizeOf<Native.WindowClass>(),
            procedure = Marshal.GetFunctionPointerForDelegate(wndProc), className = "Windows.UI.Core.CoreWindow" };
        if (Native.RegisterClassEx(ref windowClass) == 0) throw new Exception("Synthetic CoreWindow registration failed.");
        var child = Native.CreateWindowEx(0, windowClass.className, "Hosted fixture root", 0x50000000,
            0, 40, 400, 200, hosted.Handle, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
        if (child == IntPtr.Zero) throw new Exception("Synthetic CoreWindow creation failed.");
        Native.CreateWindowEx(0, "BUTTON", "Inside hosted fixture", 0x50000000,
            1, 1, 180, 30, child, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
        base.OnShown(e);
    }
    protected override void OnFormClosed(FormClosedEventArgs e) { hosted?.Close(); hosted?.Dispose(); base.OnFormClosed(e); }
}
sealed class OffscreenForm : Form
{
    protected override bool ShowWithoutActivation => true;
    public OffscreenForm() { ShowInTaskbar = false; StartPosition = FormStartPosition.Manual; Location = new Point(-24000, -24000); }
}
static class Native
{
    public delegate IntPtr WindowProc(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct WindowClass
    {
        public uint size, style; public IntPtr procedure; public int classExtra, windowExtra;
        public IntPtr instance, icon, cursor, background; public string? menu; public string className; public IntPtr smallIcon;
    }
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern ushort RegisterClassEx(ref WindowClass value);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr DefWindowProc(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr CreateWindowEx(uint extended, string className, string title, uint style,
        int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr parameter);
}
