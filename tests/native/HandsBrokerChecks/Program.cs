using System.ComponentModel;
using System.Diagnostics;
using System.Reflection;
using System.Text.Json;

if (args.Length == 5 && args[0] == "--stall-client")
{
    using var pipe = new System.IO.Pipes.NamedPipeClientStream(".", args[1], System.IO.Pipes.PipeDirection.InOut);
    pipe.Connect(5000);
    using var writer = new BinaryWriter(pipe, System.Text.Encoding.UTF8, leaveOpen: true);
    var handshakeBytes = System.Text.Encoding.UTF8.GetBytes(args[2]);
    writer.Write(handshakeBytes.Length); writer.Write(handshakeBytes); writer.Flush();
    // Receive a prefix but stop consuming the command to force startup cancellation.
    pipe.ReadByte();
    await Task.Delay(16_000);
    return;
}

// Run against an isolated Hands build. Launches never request UAC.
var waitForParent = args.Length == 3 && args[0] == "--wait-parent";
var executable = Path.GetFullPath(waitForParent ? args[1] : args[0]);
var assembly = Assembly.LoadFrom(Path.ChangeExtension(executable, ".dll"));
var broker = assembly.GetType("Lalime.Hands.ElevatedCommandBroker")
    ?? throw new Exception("Hands does not provide a one-command broker.");
var run = broker.GetMethod("Run", BindingFlags.NonPublic | BindingFlags.Static)
    ?? throw new Exception("Hands does not provide the broker entry point.");
var checks = 0;
var failures = 0;

JsonElement Run(string command, Action<ProcessStartInfo>? change = null, bool deny = false)
{
    Func<ProcessStartInfo, Process?> launch = start =>
    {
        if (start.Verb != "runas" || !start.UseShellExecute) throw new Exception("Production launch did not request one-shot elevation.");
        if (deny) throw new Win32Exception(1223);
        // The transport is real; only the OS elevation launch is replaced.
        start.FileName = executable;
        start.UseShellExecute = false;
        start.Verb = "";
        start.CreateNoWindow = true;
        change?.Invoke(start);
        var child = Process.Start(start);
        if (waitForParent && child is not null) Console.WriteLine("WORKER " + child.Id);
        return child;
    };
    var value = run.Invoke(null, new object[] { command, launch });
    return JsonSerializer.SerializeToElement(value);
}
void Check(bool condition, string message)
{
    if (!condition) { failures++; Console.WriteLine("FAIL " + message); return; }
    checks++;
    Console.WriteLine("PASS " + message);
}

if (waitForParent)
{
    var destination = Path.GetFullPath(args[2]).Replace("'", "''");
    Run($"[IO.File]::WriteAllText('{destination}', $PID.ToString()); Start-Sleep -Seconds 120");
    return;
}

var good = Run("Write-Output 'bound-command-result'");
Check(good.GetProperty("ok").GetBoolean() && good.GetProperty("output").GetString()!.Contains("bound-command-result"), "exact command executes through real authenticated pipe");
var hash = Run("Write-Output 'must-not-execute'", start => start.ArgumentList[3] = new string('0', 64));
Check(!hash.GetProperty("ok").GetBoolean(), "changed command hash fails closed");
var token = Run("Write-Output 'must-not-execute'", start => start.ArgumentList[2] = new string('0', 64));
Check(!token.GetProperty("ok").GetBoolean(), "changed token fails closed");
var parent = Run("Write-Output 'must-not-execute'", start => start.ArgumentList[4] = "1");
Check(!parent.GetProperty("ok").GetBoolean(), "wrong server process identity fails closed");
var denied = Run("Write-Output 'must-not-execute'", deny: true);
Check(!denied.GetProperty("ok").GetBoolean() && denied.GetProperty("output").GetString()!.Contains("declined"), "UAC denial is reported plainly without command execution");
var blocked = Run("powershell -EncodedCommand Zg==");
Check(!blocked.GetProperty("ok").GetBoolean() && blocked.GetProperty("output").GetString()!.Contains("blocked"), "worker repeats native command precheck");
var partial = Run(new string('x', 500_000), start =>
{
    start.FileName = Environment.ProcessPath!;
    start.ArgumentList[0] = "--stall-client";
});
Check(!partial.GetProperty("ok").GetBoolean() && !partial.GetProperty("output").GetString()!.Contains("No command was sent"), "partial request delivery never claims no command was sent");
Console.WriteLine($"{checks} checks passed.");
Environment.ExitCode = failures == 0 ? 0 : 1;
