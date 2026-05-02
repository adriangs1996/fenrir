function escapeForDoubleQuotedShellString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

export function buildRawTcpPtyUpgradeCommand(cols: number, rows: number): string {
  const safeCols = Math.max(1, Math.floor(cols));
  const safeRows = Math.max(1, Math.floor(rows));
  const pythonCommand = [
    "import os, pty",
    'os.environ["TERM"] = "xterm-256color"',
    'shell = "/bin/bash" if os.path.exists("/bin/bash") else "/bin/sh"',
    "pty.spawn(shell)",
  ].join("; ");
  const escapedPythonCommand = escapeForDoubleQuotedShellString(pythonCommand);

  return [
    "export TERM=xterm-256color",
    `stty rows ${safeRows} cols ${safeCols} sane 2>/dev/null || true`,
    "if command -v script >/dev/null 2>&1; then",
    "  exec script -qfc '/bin/bash -li || /bin/sh -li' /dev/null",
    "elif command -v python3 >/dev/null 2>&1; then",
    `  exec python3 -c "${escapedPythonCommand}"`,
    "elif command -v python >/dev/null 2>&1; then",
    `  exec python -c "${escapedPythonCommand}"`,
    "else",
    "  printf '[fenrir] PTY upgrade requires script or python\\n'",
    "fi",
    "",
  ].join("\n");
}
