/** Grant-only analysis. Guardian and Hands still decide whether an action may run. */
type Token = { kind: "word" | "string" | "symbol"; text: string; dynamic?: boolean };

const DELETE_COMMANDS = new Set([
  "remove-item", "remove-itemproperty", "rm", "ri", "del", "erase", "rd", "rmdir", "rp",
]);
const INDIRECT_COMMANDS = new Set([
  "invoke-expression", "iex", "invoke-command", "icm",
  "powershell", "pwsh", "cmd", "bash", "sh", "wsl", "set-alias", "sal", "new-alias", "nal",
]);

/** Separate code from data. Unsupported syntax must keep individual consent. */
function quoteKind(c: string): string | undefined {
  if ("'\u2018\u2019".includes(c) && c) return "'";
  if ('"\u201c\u201d'.includes(c) && c) return '"';
  return undefined;
}

/** Find the end without treating quoted or commented parentheses as code. */
function subexpression(input: string, open: number): { source: string; end: number } | undefined {
  let nesting = 1;
  let quote: string | undefined;
  for (let i = open + 1; i < input.length; i++) {
    const c = input[i];
    if (quote) {
      if (quote === '"' && c === "`") { i++; continue; }
      if (quoteKind(c) === quote) {
        if (quoteKind(input[i + 1] ?? "") === quote) i++;
        else quote = undefined;
      }
      continue;
    }
    if (c === "`") { i++; continue; }
    if (c === "#") { while (i < input.length && !/[\r\n]/.test(input[i])) i++; continue; }
    if (input.startsWith("<#", i) || c === "@") return;
    if (quoteKind(c)) { quote = quoteKind(c); continue; }
    if (c === "(") nesting++;
    if (c === ")" && --nesting === 0) return { source: input.slice(open + 1, i), end: i + 1 };
  }
  return undefined;
}

function tokenize(source: string, depth: number): Token[] | undefined {
  if (source.length > 100_000 || depth > 16) return;
  let input = source.replace(/[\u2013\u2014\u2015]/g, "-");
  const tokens: Token[] = [];
  const brackets: string[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (c === "\n" || c === "\r") { tokens.push({ kind: "symbol", text: ";" }); i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === "#") { while (i < input.length && !/[\r\n]/.test(input[i])) i++; continue; }
    if (input.startsWith("<#", i)) {
      let depth = 1; i += 2;
      while (i < input.length && depth) {
        if (input.startsWith("<#", i)) { depth++; i += 2; }
        else if (input.startsWith("#>", i)) { depth--; i += 2; }
        else i++;
      }
      if (depth) return;
      continue;
    }
    if (c === "`" && /^`\r?\n/.test(input.slice(i))) {
      input = input.slice(0, i) + input.slice(i).replace(/^`\r?\n/, ""); continue;
    }
    if (c === "`" || input.startsWith("--%", i)) return;
    if (c === "@") {
      if (input[i + 1] === "(" || input[i + 1] === "{") { i++; continue; }
      if (input.startsWith("@'", i)) {
        const tail = input.slice(i + 2);
        if (!/^\r?\n/.test(tail)) return;
        const end = /(?:^|\n)'@(?=\r?\n|$)/.exec(tail);
        if (!end) return;
        tokens.push({ kind: "string", text: tail.slice(0, end.index) });
        i += 2 + end.index + end[0].length; continue;
      }
      const splat = /^@[a-z_][\w:]*/i.exec(input.slice(i));
      if (!splat) return;
      tokens.push({ kind: "word", text: splat[0], dynamic: true }); i += splat[0].length; continue;
    }
    if (quoteKind(c)) {
      const quote = quoteKind(c)!; let text = ""; let closed = false; let dynamic = false; i++;
      while (i < input.length) {
        const next = input[i++];
        if (quoteKind(next) === quote) {
          if (quoteKind(input[i] ?? "") === quote) { text += quote; i++; continue; }
          closed = true; break;
        }
        if (quote === '"' && next === "`") {
          if (i === input.length) return;
          text += input[i++]; continue;
        }
        if (quote === '"' && next === "$") {
          if (input[i] === "(") {
            const expression = subexpression(input, i);
            if (!expression || powerShellGrantUnavailableReason(expression.source, depth + 1)) return;
            i = expression.end;
          }
          dynamic = true;
        }
        text += next;
      }
      if (!closed) return;
      tokens.push({ kind: "string", text, dynamic }); continue;
    }
    if (input.startsWith("::", i)) { tokens.push({ kind: "symbol", text: "::" }); i += 2; continue; }
    if (";|&{}()[]=,+<>".includes(c) || (c === "." && !/[\\/.]/.test(input[i + 1] ?? ""))) {
      if ("{([".includes(c)) brackets.push(c);
      if ("})]".includes(c) && brackets.pop() !== ({ "}": "{", ")": "(", "]": "[" } as Record<string, string>)[c]) return;
      tokens.push({ kind: "symbol", text: c }); i++; continue;
    }
    if (c === "$") {
      const start = i++;
      while (i < input.length && /[\w:?]/.test(input[i]) && !input.startsWith("::", i)) i++;
      if (input[i] === "{") return;
      tokens.push({ kind: "word", text: input.slice(start, i), dynamic: true }); continue;
    }
    const start = i;
    while (i < input.length) {
      if (/^`\r?\n/.test(input.slice(i))) {
        input = input.slice(0, i) + input.slice(i).replace(/^`\r?\n/, ""); continue;
      }
      if (/[\s;'"|&{}()\[\]=,+<>`]/.test(input[i]) || input.startsWith("::", i)) break;
      i++;
    }
    if (i === start) return;
    // A quoted fragment can complete an executable name, such as Remove-'Item'.
    if (input[i] === "'" || input[i] === '"') return;
    tokens.push({ kind: "word", text: input.slice(start, i) });
  }
  return brackets.length ? undefined : tokens;
}

function commandName(token: Token): string {
  return (token.text.split(/[\\/]/).at(-1) ?? "").replace(/\.exe$/i, "").toLowerCase();
}

function indirectDeleteMember(tokens: Token[], start: number): boolean {
  let depth = 0;
  for (let i = start + 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.kind === "symbol") {
      if (depth === 0 && [";", "|", "&", "}"].includes(token.text)) break;
      if (depth === 0 && ["(", "["].includes(token.text)) return true;
      if (["{", "(", "["].includes(token.text)) depth++;
      if (["}", ")", "]"].includes(token.text)) { if (depth === 0) break; depth--; }
      continue;
    }
    if (depth) continue;
    if (/[*?\[]/.test(token.text)) return true;
    if (/^delete/i.test(token.text)) return true;
    const [parameter, ...boundParts] = token.text.toLowerCase().split(":");
    if (parameter.length > 1 && "-membername".startsWith(parameter)) {
      const bound = boundParts.join(":");
      if (/^delete/.test(bound) || bound.includes("$") || tokens[i + 1]?.dynamic) return true;
    }
    // Common parameters can occur before the positional member name.
    if (token.dynamic) return true;
  }
  return false;
}

/**
 * Recognize deletion commands and member-call structure, not words in arguments.
 * This is not a PowerShell parser or sandbox. Dynamic dispatch and unsupported
 * syntax receive no reusable grant; normal one-action approval remains available.
 * User-defined functions and external executable semantics are not inferred here.
 */
export function permitsPowerShellTaskGrant(source: string): boolean {
  return powerShellGrantUnavailableReason(source) === undefined;
}

export function powerShellGrantUnavailableReason(source: string, depth = 0): string | undefined {
  if (source.length > 100_000) return "This command is too long to check for Allow-for-task. You can still approve it once.";
  const tokens = tokenize(source, depth);
  if (!tokens) return "uses syntax Lalime can't check";
  let commandStart = true;
  let invocation = false;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.kind === "symbol") {
      if (token.text === "." || token.text === "::") {
        const member = tokens[i + 1];
        if (member?.text === "(" || (member?.dynamic && tokens[i + 2]?.text === "(")) return "uses dynamic invocation";
        const members = member?.text.split(".") ?? [];
        if (member && /[\u2018\u2019\u201c\u201d]/.test(member.text)) return "uses syntax Lalime can't check";
        if (tokens[i + 2]?.text === "(" && members.some((name) => /^delete/i.test(name))) return "permanent delete";
        if (tokens[i + 2]?.text === "(" && members.some((name) => /^(?:invoke|getmethods?$|foreach$)/i.test(name))) return "uses dynamic invocation";
        if (token.text === "." && commandStart) invocation = true;
      }
      if ([";", "|", "{", "}", "(", "="].includes(token.text)) { commandStart = true; invocation = false; }
      if (token.text === "&") { commandStart = true; invocation = true; }
      if (token.text === ")") commandStart = false;
      if (invocation) {
        const next = tokens[i + 1];
        if (!next || next.dynamic || (next.kind === "symbol" && next.text !== "{")) return "uses dynamic invocation";
      }
      continue;
    }
    if (!commandStart) continue;
    commandStart = false;
    if (token.dynamic && invocation) return "uses dynamic invocation";
    if (token.kind === "string" && !invocation) continue;
    invocation = false;
    const name = commandName(token);
    if (/[\u2018\u2019\u201c\u201d]/.test(name)) return "uses syntax Lalime can't check";
    if (DELETE_COMMANDS.has(name)) return "permanent delete";
    if (INDIRECT_COMMANDS.has(name)) return "uses dynamic invocation";
    if (["start-process", "saps", "start", "invoke-item", "ii", "explorer"].includes(name)) {
      const args: Token[] = [];
      for (const argument of tokens.slice(i + 1)) {
        if (argument.kind === "symbol" && [";", "|", "&", "}"].includes(argument.text)) break;
        args.push(argument);
      }
      const pathParameters = ["invoke-item", "ii"].includes(name) ? ["-path", "-literalpath"] : ["-filepath"];
      if (pathParameters.includes(args[0]?.text.toLowerCase())) args.shift();
      const target = args[0];
      if (args.length !== 1 || !target || target.dynamic || target.kind === "symbol"
        || !/\.(?:pdf|txt|png|jpe?g|gif|docx|xlsx|pptx)$/i.test(target.text)
        || /[*?]/.test(target.text) || target.text.startsWith("-") || /^[\\/]{2}/.test(target.text)
        || target.text.replace(/^[a-z]:[\\/]/i, "").includes(":")) return "launch target or arguments need individual approval";
    }
    if (["foreach-object", "%", "foreach"].includes(name) && indirectDeleteMember(tokens, i)) return "uses deletion or dynamic member invocation";
    if (["robocopy", "xcopy"].includes(name)) {
      for (const argument of tokens.slice(i + 1)) {
        if (argument.kind === "symbol" && [";", "|", "&", "}"].includes(argument.text)) break;
        if (argument.dynamic) return "uses copy options Lalime can't check";
        if (/^\/(?:job|save)(?::|$)|^\/(?:nosd|nodd)$/i.test(argument.text)) return "uses copy job options Lalime can't check";
        if (/^\/(?:mir|purge|mov|move)$/i.test(argument.text)) return "permanent delete";
      }
    }
  }
  return undefined;
}
