// PowerShellAstGuard.cs
// Sketch for Jackson Price — Congressional App Challenge 2026
//
// Intent: parse PowerShell with the official AST and reject obfuscated /
// download-and-execute patterns before Hands runs anything.
// This file is a design sketch until the full Hands.exe sidecar is built.

/*
using System;
using System.Management.Automation.Language;

namespace Lalime.Hands;

public static class PowerShellAstGuard
{
    public static bool IsBlocked(string script, out string reason)
    {
        Parser.ParseInput(script, out Token[] tokens, out ParseError[] errors);
        if (errors is { Length: > 0 })
        {
            reason = "PowerShell did not parse cleanly, so Lalime will not run it.";
            return true;
        }

        // JACKSON: walk the AST for Invoke-Expression, -EncodedCommand,
        // DownloadString | IEX, and similar. Prefer AST checks over regex alone.
        reason = "";
        return false;
    }
}
*/
