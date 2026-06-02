export type RemoteHostSpecialCommand = {
  readonly type: "clear-terminal";
};

export function resolveRemoteHostSpecialCommand(input: string): RemoteHostSpecialCommand | null {
  const command = input.trim().toLowerCase();
  if (command === "clear" || command === "cls" || command === "clean") {
    return { type: "clear-terminal" };
  }

  return null;
}
