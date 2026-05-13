import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import type { ManagedProcess } from "@fenrir/contracts";
import { PortlessWrapper } from "../Services/PortlessWrapper.ts";
import { PortlessWrapperLive } from "./PortlessWrapper.ts";

// ── Module-level mock of processRunner ──

const mockRunProcess = vi.fn();

vi.mock("../../processRunner.ts", () => ({
  runProcess: (...args: unknown[]) => mockRunProcess(...args),
}));

// ── Helpers ──

const TestLayer = PortlessWrapperLive;

const DUMMY_DEFINITION = {
  id: "dev-server",
  name: "Dev Server",
  command: "npm run dev",
  icon: "terminal",
  scope: "project",
  cwd: null,
  env: {},
  proxy: null,
  readiness: { kind: "none" },
  autoRestart: null,
} as unknown as ManagedProcess;

function withPortless(def: ManagedProcess, appName?: string): ManagedProcess {
  return {
    ...def,
    proxy: {
      kind: "portless" as const,
      ...(appName ? { appName } : {}),
    },
  } as unknown as ManagedProcess;
}

// ── Tests ──

describe("PortlessWrapper", () => {
  describe("wrap", () => {
    it("no proxy → command unchanged, urlEstimate null", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const wrapper = yield* PortlessWrapper;
          return yield* wrapper.wrap({
            definition: DUMMY_DEFINITION,
            worktreePath: null,
            branchName: null,
          });
        }).pipe(Effect.provide(TestLayer)),
      );

      expect(result.command).toBe("npm run dev");
      expect(result.urlEstimate).toBeNull();
      expect(result.executable).toBeNull();
    });

    it("portless proxy with explicit appName → wrapped command + URL", async () => {
      mockRunProcess.mockResolvedValue({ code: 0, stdout: "/usr/bin/portless" });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const wrapper = yield* PortlessWrapper;
          return yield* wrapper.wrap({
            definition: withPortless(DUMMY_DEFINITION, "my-app"),
            worktreePath: null,
            branchName: null,
          });
        }).pipe(Effect.provide(TestLayer)),
      );

      expect(result.command).toContain("portless run --name");
      expect(result.command).toContain("my-app");
      expect(result.urlEstimate).toBe("https://my-app.localhost");
      expect(result.executable).toBe("portless");
    });

    it("portless proxy without appName → uses definition.id", async () => {
      mockRunProcess.mockResolvedValue({ code: 0, stdout: "/usr/bin/portless" });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const wrapper = yield* PortlessWrapper;
          return yield* wrapper.wrap({
            definition: withPortless(DUMMY_DEFINITION),
            worktreePath: null,
            branchName: null,
          });
        }).pipe(Effect.provide(TestLayer)),
      );

      expect(result.command).toContain("dev-server");
      expect(result.urlEstimate).toBe("https://dev-server.localhost");
    });

    it("portless proxy on linked worktree → URL prefixed with branch slug", async () => {
      mockRunProcess.mockResolvedValue({ code: 0, stdout: "/usr/bin/portless" });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const wrapper = yield* PortlessWrapper;
          return yield* wrapper.wrap({
            definition: withPortless(DUMMY_DEFINITION, "my-app"),
            worktreePath: "/worktrees/feature-foo",
            branchName: "feature/my-branch",
          });
        }).pipe(Effect.provide(TestLayer)),
      );

      expect(result.urlEstimate).toBe("https://feature-my-branch.my-app.localhost");
    });

    it("portless not on PATH → fails with portless-not-found", async () => {
      mockRunProcess.mockResolvedValue({ code: 1, stdout: "" });

      const result = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const wrapper = yield* PortlessWrapper;
          return yield* wrapper.wrap({
            definition: withPortless(DUMMY_DEFINITION, "my-app"),
            worktreePath: null,
            branchName: null,
          });
        }).pipe(Effect.provide(TestLayer)),
      );

      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(JSON.stringify(result.cause)).toContain("portless-not-found");
      }
    });
  });

  describe("observeUrlConfirmation", () => {
    it("returns null when proxy is not portless", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const wrapper = yield* PortlessWrapper;
          const observer = wrapper.observeUrlConfirmation({
            definition: DUMMY_DEFINITION,
          });
          return observer.observe("https://foo.localhost starting...");
        }).pipe(Effect.provide(TestLayer)),
      );

      expect(result).toBeNull();
    });

    it("detects URL on first match", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const wrapper = yield* PortlessWrapper;
          const observer = wrapper.observeUrlConfirmation({
            definition: withPortless(DUMMY_DEFINITION, "my-app"),
          });
          return observer.observe("Server running at https://my-app.localhost ready");
        }).pipe(Effect.provide(TestLayer)),
      );

      expect(result).toBe("https://my-app.localhost");
    });

    it("returns null after first match (subsequent calls)", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const wrapper = yield* PortlessWrapper;
          const observer = wrapper.observeUrlConfirmation({
            definition: withPortless(DUMMY_DEFINITION, "my-app"),
          });
          const first = observer.observe("https://my-app.localhost");
          expect(first).toBe("https://my-app.localhost");

          const second = observer.observe("https://my-app.localhost again");
          expect(second).toBeNull();
        }).pipe(Effect.provide(TestLayer)),
      );
    });

    it("works with chunked input across multiple observe calls", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const wrapper = yield* PortlessWrapper;
          const observer = wrapper.observeUrlConfirmation({
            definition: withPortless(DUMMY_DEFINITION, "my-app"),
          });

          // URL split across chunks
          const r1 = observer.observe("Starting server... https://my-ap");
          expect(r1).toBeNull();

          const r2 = observer.observe("p.localhost is ready");
          expect(r2).toBe("https://my-app.localhost");

          // Subsequent call returns null
          const r3 = observer.observe("https://my-app.localhost");
          expect(r3).toBeNull();
        }).pipe(Effect.provide(TestLayer)),
      );
    });

    it("strips ANSI codes before matching", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const wrapper = yield* PortlessWrapper;
          const observer = wrapper.observeUrlConfirmation({
            definition: withPortless(DUMMY_DEFINITION, "my-app"),
          });

          const result = observer.observe("Ready at \x1b[32mhttps://my-app.localhost\x1b[0m done");
          expect(result).toBe("https://my-app.localhost");
        }).pipe(Effect.provide(TestLayer)),
      );
    });
  });
});
