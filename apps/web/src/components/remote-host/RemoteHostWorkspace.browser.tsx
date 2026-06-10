import type {
  EnvironmentApi,
  RemoteCommandRunSnapshot,
  RemoteConnectionSnapshot,
  RemoteHostSnapshot,
} from "@fenrir/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { useRemoteControllerStore } from "../../remoteControllerStore";
import { SidebarProvider } from "../ui/sidebar";
import { RemoteHostWorkspace } from "./RemoteHostWorkspace";

const mocks = vi.hoisted(() => {
  const sendCommand = vi.fn();
  return {
    environmentApi: {
      remoteController: {
        sendCommand,
      },
    },
    sendCommand,
  };
});

vi.mock("../../environments/primary", () => ({
  getPrimaryKnownEnvironment: () => null,
  readPrimaryEnvironmentDescriptor: () => ({
    environmentId: "environment-1",
    label: "Test Environment",
  }),
  resetPrimaryEnvironmentDescriptorForTests: () => undefined,
  resolveInitialPrimaryEnvironmentDescriptor: async () => ({
    environmentId: "environment-1",
    label: "Test Environment",
  }),
  usePrimaryEnvironmentId: () => "environment-1",
  writePrimaryEnvironmentDescriptor: () => undefined,
  __resetPrimaryEnvironmentBootstrapForTests: () => undefined,
  __resetPrimaryEnvironmentDescriptorBootstrapForTests: () => undefined,
  ensurePrimaryEnvironmentReady: async () => ({
    environmentId: "environment-1",
    label: "Test Environment",
  }),
  updatePrimaryEnvironmentDescriptor: () => undefined,
  createServerPairingCredential: async () => ({}),
  fetchSessionState: async () => ({}),
  listServerClientSessions: async () => [],
  listServerPairingLinks: async () => [],
  peekPairingTokenFromUrl: () => null,
  resolveInitialServerAuthGateState: async () => ({ status: "disabled" }),
  revokeOtherServerClientSessions: async () => undefined,
  revokeServerClientSession: async () => undefined,
  revokeServerPairingLink: async () => undefined,
  stripPairingTokenFromUrl: () => undefined,
  submitServerAuthCredential: async () => ({}),
  takePairingTokenFromUrl: () => null,
  __resetServerAuthBootstrapForTests: () => undefined,
  resolvePrimaryEnvironmentHttpUrl: (path: string) => path,
  resolvePrimaryWebSocketConnectionUrl: () => "ws://localhost/test",
  isLoopbackHostname: () => true,
}));

vi.mock("../../environmentApi", () => ({
  createEnvironmentApi: () => mocks.environmentApi as unknown as EnvironmentApi,
  readEnvironmentApi: () => mocks.environmentApi as unknown as EnvironmentApi,
  ensureEnvironmentApi: () => mocks.environmentApi as unknown as EnvironmentApi,
}));

vi.mock("./useRemoteControllerSync", () => ({
  useRemoteControllerSync: () => undefined,
}));

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function commandRun(
  command: string,
  input?: {
    output?: string;
    startedAt?: string;
  },
): RemoteCommandRunSnapshot {
  return {
    runId: `run-${command}` as never,
    connectionId: "connection-1" as never,
    command,
    status: "succeeded",
    output: input?.output ?? "",
    exitCode: 0,
    signal: null,
    startedAt: input?.startedAt ?? "2026-06-02T00:00:01.000Z",
    finishedAt: "2026-06-02T00:00:02.000Z",
  };
}

function seedRemoteHostWorkspace(input?: {
  commandRuns?: ReadonlyArray<RemoteCommandRunSnapshot>;
}) {
  const host = {
    hostId: "host-1" as never,
    label: "Local shell",
    transport: {
      type: "command-template",
      command: "sh",
      args: ["-lc", "{command}"],
    },
    createdAt: "2026-06-02T00:00:00.000Z",
    updatedAt: "2026-06-02T00:00:00.000Z",
  } satisfies RemoteHostSnapshot;
  const connection = {
    connectionId: "connection-1" as never,
    hostId: "host-1" as never,
    label: "Local shell",
    transportType: "command-template",
    status: "connected",
    state: { path: "/tmp" },
    startedAt: "2026-06-02T00:00:00.000Z",
  } satisfies RemoteConnectionSnapshot;

  useRemoteControllerStore.setState({
    hosts: { [host.hostId]: host },
    connections: { [connection.connectionId]: connection },
    commandRuns: Object.fromEntries((input?.commandRuns ?? []).map((run) => [run.runId, run])),
    selectedHostId: null,
  });
}

function commandInput(): HTMLTextAreaElement {
  const element = document.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="Command input"]',
  );
  if (!element) {
    throw new Error("Expected the remote host command input to be rendered.");
  }
  return element;
}

function dispatchEnter(element: HTMLTextAreaElement) {
  element.dispatchEvent(
    new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Enter",
    }),
  );
}

function changeCommandInput(element: HTMLTextAreaElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  valueSetter?.call(element, value);
  element.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
    }),
  );
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

describe("RemoteHostWorkspace", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    mocks.sendCommand.mockReset();
    useRemoteControllerStore.setState({
      hosts: {},
      connections: {},
      commandRuns: {},
      selectedHostId: null,
    });
  });

  it("keeps command input focus after sending with Enter", async () => {
    seedRemoteHostWorkspace();
    const deferred = createDeferred<RemoteCommandRunSnapshot>();
    mocks.sendCommand.mockReturnValueOnce(deferred.promise);
    const screen = await render(
      <SidebarProvider>
        <RemoteHostWorkspace hostId="host-1" />
      </SidebarProvider>,
    );

    try {
      const input = commandInput();
      input.focus();
      changeCommandInput(input, "pwd");

      dispatchEnter(input);

      await vi.waitFor(() => {
        expect(mocks.sendCommand).toHaveBeenCalledWith({
          connectionId: "connection-1",
          command: "pwd",
        });
      });
      expect(document.activeElement).toBe(input);
      expect(input.value).toBe("");

      changeCommandInput(input, "whoami");
      deferred.resolve(commandRun("pwd"));

      await deferred.promise;
      await nextAnimationFrame();
      expect(document.activeElement).toBe(input);
      expect(input.value).toBe("whoami");
    } finally {
      await screen.unmount();
    }
  });

  it("renders command history as a continuous shell transcript", async () => {
    seedRemoteHostWorkspace({
      commandRuns: [
        commandRun("pwd", {
          output: "/tmp\n",
          startedAt: "2026-06-02T00:00:02.000Z",
        }),
        commandRun("whoami", {
          output: "fenrir\n",
          startedAt: "2026-06-02T00:00:01.000Z",
        }),
      ],
    });
    const screen = await render(
      <SidebarProvider>
        <RemoteHostWorkspace hostId="host-1" />
      </SidebarProvider>,
    );

    try {
      const shell = document.querySelector<HTMLElement>('[data-remote-host-shell="true"]');
      const runs = Array.from(
        document.querySelectorAll<HTMLElement>('[data-remote-host-shell-run="true"]'),
      );

      expect(shell).toBeTruthy();
      expect(runs).toHaveLength(2);
      expect(runs[0]?.textContent ?? "").toContain("$whoami");
      expect(runs[0]?.textContent ?? "").toContain("fenrir");
      expect(runs[1]?.textContent ?? "").toContain("$pwd");
      expect(runs[1]?.textContent ?? "").toContain("/tmp");
      expect(document.querySelector('[data-remote-host-shell-prompt="true"]')).toBeTruthy();
      expect(document.querySelector('button[aria-label="Send command"]')).toBeNull();
      expect(document.querySelector("section")).toBeNull();
    } finally {
      await screen.unmount();
    }
  });

  it("keeps command input focus after sending from the shell prompt", async () => {
    seedRemoteHostWorkspace();
    const deferred = createDeferred<RemoteCommandRunSnapshot>();
    mocks.sendCommand.mockReturnValueOnce(deferred.promise);
    const screen = await render(
      <SidebarProvider>
        <RemoteHostWorkspace hostId="host-1" />
      </SidebarProvider>,
    );

    try {
      const input = commandInput();
      input.focus();
      changeCommandInput(input, "id");

      dispatchEnter(input);

      await vi.waitFor(() => {
        expect(mocks.sendCommand).toHaveBeenCalledWith({
          connectionId: "connection-1",
          command: "id",
        });
      });
      expect(document.activeElement).toBe(input);

      deferred.resolve(commandRun("id"));
      await deferred.promise;
      await nextAnimationFrame();
      expect(document.activeElement).toBe(input);
    } finally {
      await screen.unmount();
    }
  });

  it("handles clear commands locally without sending them to the remote controller", async () => {
    seedRemoteHostWorkspace({
      commandRuns: [
        commandRun("pwd", {
          output: "/tmp\n",
          startedAt: "2026-06-02T00:00:01.000Z",
        }),
        commandRun("whoami", {
          output: "fenrir\n",
          startedAt: "2026-06-02T00:00:02.000Z",
        }),
      ],
    });
    const screen = await render(
      <SidebarProvider>
        <RemoteHostWorkspace hostId="host-1" />
      </SidebarProvider>,
    );

    try {
      const input = commandInput();
      input.focus();
      changeCommandInput(input, "clear");

      dispatchEnter(input);

      await vi.waitFor(() => {
        expect(document.querySelectorAll('[data-remote-host-shell-run="true"]')).toHaveLength(0);
      });
      expect(mocks.sendCommand).not.toHaveBeenCalled();
      expect(input.value).toBe("");
      expect(document.activeElement).toBe(input);
      expect(document.body.textContent ?? "").not.toContain("fenrir");
      expect(document.body.textContent ?? "").not.toContain("Remote shell ready");
    } finally {
      await screen.unmount();
    }
  });
});
