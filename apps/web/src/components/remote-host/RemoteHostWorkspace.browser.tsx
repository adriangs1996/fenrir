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

function commandRun(command: string): RemoteCommandRunSnapshot {
  return {
    runId: `run-${command}` as never,
    connectionId: "connection-1" as never,
    command,
    status: "succeeded",
    output: "",
    exitCode: 0,
    signal: null,
    startedAt: "2026-06-02T00:00:01.000Z",
    finishedAt: "2026-06-02T00:00:02.000Z",
  };
}

function seedRemoteHostWorkspace() {
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
    commandRuns: {},
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

function sendButton(): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>('button[aria-label="Send command"]');
  if (!element) {
    throw new Error("Expected the remote host send button to be rendered.");
  }
  return element;
}

function dispatchButtonClick(element: HTMLButtonElement) {
  for (const type of ["mousedown", "mouseup", "click"] as const) {
    element.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        button: 0,
        buttons: type === "mousedown" ? 1 : 0,
        cancelable: true,
      }),
    );
  }
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

      await vi.waitFor(() => {
        expect(sendButton().disabled).toBe(false);
      });
      expect(document.activeElement).toBe(input);
      expect(input.value).toBe("whoami");
    } finally {
      await screen.unmount();
    }
  });

  it("keeps command input focus after sending with the send button", async () => {
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

      dispatchButtonClick(sendButton());

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
});
