import { type EnvironmentId, ThreadId, type ScopedThreadRef } from "@fenrir/contracts";

export const GLOBAL_TERMINAL_THREAD_ID = ThreadId.make("global-terminal");
export const GLOBAL_TERMINAL_TMUX_PROJECT_ID = "global";
export const GLOBAL_TERMINAL_TMUX_THREAD_ID = ThreadId.make(
  `tmux:${GLOBAL_TERMINAL_TMUX_PROJECT_ID}`,
);
export const GLOBAL_TERMINAL_ROUTE = "/global-terminal";

export function isGlobalTerminalThreadId(threadId: string): boolean {
  return threadId === GLOBAL_TERMINAL_THREAD_ID || threadId === GLOBAL_TERMINAL_TMUX_THREAD_ID;
}

export function shouldStoreGlobalTerminalReturnHref(pathname: string): boolean {
  return pathname !== GLOBAL_TERMINAL_ROUTE;
}

export function resolveGlobalTerminalToggleHref(input: {
  pathname: string;
  returnHref: string | null;
}): string {
  return input.pathname === GLOBAL_TERMINAL_ROUTE
    ? (input.returnHref ?? "/")
    : GLOBAL_TERMINAL_ROUTE;
}

export function globalTerminalThreadRef(environmentId: EnvironmentId): ScopedThreadRef {
  return {
    environmentId,
    threadId: GLOBAL_TERMINAL_THREAD_ID,
  };
}
