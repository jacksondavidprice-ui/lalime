using System.ComponentModel;
using System.Diagnostics;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;

namespace Lalime.Hands;

internal static class ElevatedCommandBroker
{
    private const int MaximumPacket = 1_048_576;
    private static Dictionary<string, object?> Fail(string message) => new() { ["ok"] = false, ["output"] = message };

    internal static Dictionary<string, object?> Run(string command, Func<ProcessStartInfo, Process?> launch)
    {
        var pipeName = "lalime-admin-" + Guid.NewGuid().ToString("N");
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        using var pipe = new NamedPipeServerStream(pipeName, PipeDirection.InOut, 1,
            PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
        var start = new ProcessStartInfo
        {
            FileName = Environment.ProcessPath ?? throw new InvalidOperationException("Hands executable path is unavailable."),
            UseShellExecute = true, Verb = "runas", WindowStyle = ProcessWindowStyle.Hidden,
        };
        start.ArgumentList.Add("--elevated-worker");
        start.ArgumentList.Add(pipeName);
        start.ArgumentList.Add(token);
        start.ArgumentList.Add(Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(command))));
        start.ArgumentList.Add(Environment.ProcessId.ToString(System.Globalization.CultureInfo.InvariantCulture));
        Process? worker = null;
        var deliveryStarted = false;
        try
        {
            worker = launch(start);
            if (worker is null) return Fail("Windows could not start the administrator action.");
            // This deadline covers transport startup only. Commands have no deadline.
            using var startup = new CancellationTokenSource(TimeSpan.FromSeconds(15));
            var connected = pipe.WaitForConnectionAsync(startup.Token);
            var exited = worker.WaitForExitAsync(startup.Token);
            if (Task.WhenAny(connected, exited).GetAwaiter().GetResult() != connected)
            {
                startup.Token.ThrowIfCancellationRequested();
                return Fail("The administrator worker stopped before connecting.");
            }
            connected.GetAwaiter().GetResult();
            if (!GetNamedPipeClientProcessId(pipe.SafePipeHandle, out var client) || client != worker.Id)
                return Fail("The administrator connection could not be verified.");
            var hello = ReadPacket(pipe, startup.Token).GetAwaiter().GetResult();
            if (!FixedEquals(token, hello)) return Fail("The administrator connection could not be verified.");
            deliveryStarted = true;
            WritePacket(pipe, JsonSerializer.Serialize(new Request(token, command)), startup.Token).GetAwaiter().GetResult();
            startup.CancelAfter(Timeout.InfiniteTimeSpan);
            // The worker monitors this connection. Closing it cancels its job.
            var result = ReadPacket(pipe, CancellationToken.None).GetAwaiter().GetResult();
            return JsonSerializer.Deserialize<Dictionary<string, object?>>(result)
                ?? Fail("The administrator worker returned no result.");
        }
        catch (Win32Exception error) when (error.NativeErrorCode == 1223)
        {
            return Fail("Administrator approval was declined in Windows. Nothing was run.");
        }
        catch (OperationCanceledException)
        {
            return Fail(deliveryStarted
                ? "The administrator connection stopped while sending the command. Execution may have started; completed changes may remain."
                : "The administrator connection did not start. No command was sent.");
        }
        catch
        {
            return Fail("The administrator action did not return a verified result. Completed changes may remain.");
        }
        finally
        {
            pipe.Dispose();
            if (worker is not null)
            {
                // A disconnected worker exits itself, closing its kill-on-close job.
                try { worker.WaitForExit(); } catch (InvalidOperationException) { }
                worker.Dispose();
            }
        }
    }

    internal static int RunWorker(string[] args, Func<string, Dictionary<string, object?>> execute)
    {
        if (args.Length != 5 || !System.Text.RegularExpressions.Regex.IsMatch(args[1], "^lalime-admin-[a-f0-9]{32}$")
            || !System.Text.RegularExpressions.Regex.IsMatch(args[2], "^[A-F0-9]{64}$")
            || !System.Text.RegularExpressions.Regex.IsMatch(args[3], "^[A-F0-9]{64}$")
            || !uint.TryParse(args[4], out var expectedParent)) return 1;
        try
        {
            using var pipe = new NamedPipeClientStream(".", args[1], PipeDirection.InOut, PipeOptions.Asynchronous);
            using var startup = new CancellationTokenSource(TimeSpan.FromSeconds(15));
            pipe.ConnectAsync(startup.Token).GetAwaiter().GetResult();
            if (!GetNamedPipeServerProcessId(pipe.SafePipeHandle, out var server) || server != expectedParent) return 1;
            WritePacket(pipe, args[2], startup.Token).GetAwaiter().GetResult();
            var request = JsonSerializer.Deserialize<Request>(ReadPacket(pipe, startup.Token).GetAwaiter().GetResult());
            if (request is null || !FixedEquals(args[2], request.Token)
                || !FixedEquals(args[3], Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(request.Command))))) return 1;
            startup.CancelAfter(Timeout.InfiniteTimeSpan);
            _ = Task.Run(async () =>
            {
                try { await pipe.ReadAsync(new byte[1]); } catch { }
                // Parent Stop or exit closes the pipe. Exit closes our job and its children.
                Environment.Exit(1);
            });
            var result = execute(request.Command);
            WritePacket(pipe, JsonSerializer.Serialize(result), CancellationToken.None).GetAwaiter().GetResult();
            return 0;
        }
        catch { return 1; }
    }

    private sealed record Request(string Token, string Command);
    private static bool FixedEquals(string first, string second) =>
        CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(first), Encoding.UTF8.GetBytes(second));

    private static async Task<string> ReadPacket(Stream stream, CancellationToken cancellation)
    {
        var header = new byte[4];
        await stream.ReadExactlyAsync(header, cancellation);
        var length = System.Buffers.Binary.BinaryPrimitives.ReadInt32LittleEndian(header);
        if (length < 0 || length > MaximumPacket) throw new InvalidDataException("Invalid packet length.");
        var data = new byte[length];
        await stream.ReadExactlyAsync(data, cancellation);
        return Encoding.UTF8.GetString(data);
    }

    private static async Task WritePacket(Stream stream, string value, CancellationToken cancellation)
    {
        var data = Encoding.UTF8.GetBytes(value);
        if (data.Length > MaximumPacket) throw new InvalidDataException("Packet is too large.");
        var header = new byte[4];
        System.Buffers.Binary.BinaryPrimitives.WriteInt32LittleEndian(header, data.Length);
        await stream.WriteAsync(header, cancellation);
        await stream.WriteAsync(data, cancellation);
        await stream.FlushAsync(cancellation);
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetNamedPipeClientProcessId(SafePipeHandle pipe, out uint processId);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetNamedPipeServerProcessId(SafePipeHandle pipe, out uint processId);
}
