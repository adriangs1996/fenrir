import { Cause } from "effect";
import { describe, expect, it } from "vitest";

import {
  ManagedProcessRpcError,
  OrchestrationDispatchCommandError,
  SourceControlStackRpcError,
} from "@fenrir/contracts";

import {
  makeRpcErrorMapper,
  toBootstrapDispatchCommandCauseError,
  toDispatchCommandError,
  toManagedProcessRpcError,
  toSourceControlStackRpcError,
} from "./rpcErrors.ts";

describe("makeRpcErrorMapper", () => {
  const mapper = makeRpcErrorMapper(
    SourceControlStackRpcError,
    (cause) => new SourceControlStackRpcError({ message: "fallback", cause }),
  );

  it("passes through values that already match the schema", () => {
    const error = new SourceControlStackRpcError({ message: "original" });
    expect(mapper(error)).toBe(error);
  });

  it("wraps non-matching values with the fallback", () => {
    const wrapped = mapper("boom");
    expect(wrapped).not.toBe("boom");
    expect(wrapped.message).toBe("fallback");
    expect(wrapped.cause).toBe("boom");
  });
});

describe("toManagedProcessRpcError", () => {
  it("passes through an existing ManagedProcessRpcError unchanged", () => {
    const error = new ManagedProcessRpcError({ code: "not-found", message: "missing" });
    expect(toManagedProcessRpcError(error)).toBe(error);
  });

  it("wraps an Error using its message and the io-error code", () => {
    const mapped = toManagedProcessRpcError(new Error("disk full"));
    expect(mapped).toBeInstanceOf(ManagedProcessRpcError);
    expect(mapped.code).toBe("io-error");
    expect(mapped.message).toBe("disk full");
  });

  it("uses the generic message for non-Error causes", () => {
    const mapped = toManagedProcessRpcError({ unexpected: true });
    expect(mapped.code).toBe("io-error");
    expect(mapped.message).toBe("Managed process operation failed");
  });
});

describe("toSourceControlStackRpcError", () => {
  it("passes through an existing SourceControlStackRpcError unchanged", () => {
    const error = new SourceControlStackRpcError({ message: "stack broke" });
    expect(toSourceControlStackRpcError(error)).toBe(error);
  });

  it("wraps an Error using its message and keeps the cause", () => {
    const original = new Error("git failed");
    const mapped = toSourceControlStackRpcError(original);
    expect(mapped).not.toBe(original);
    expect(mapped.message).toBe("git failed");
    expect(mapped.cause).toBe(original);
  });

  it("uses the generic message for non-Error causes", () => {
    const mapped = toSourceControlStackRpcError(42);
    expect(mapped.message).toBe("Source-control stack operation failed.");
    expect(mapped.cause).toBe(42);
  });
});

describe("toDispatchCommandError", () => {
  it("passes through an existing OrchestrationDispatchCommandError unchanged", () => {
    const error = new OrchestrationDispatchCommandError({ message: "dispatch broke" });
    expect(toDispatchCommandError(error, "fallback message")).toBe(error);
  });

  it("wraps an Error using its message", () => {
    const original = new Error("command rejected");
    const mapped = toDispatchCommandError(original, "fallback message");
    expect(mapped).not.toBe(original);
    expect(mapped.message).toBe("command rejected");
    expect(mapped.cause).toBe(original);
  });

  it("uses the fallback message for non-Error causes", () => {
    const mapped = toDispatchCommandError("string failure", "fallback message");
    expect(mapped.message).toBe("fallback message");
    expect(mapped.cause).toBe("string failure");
  });
});

describe("toBootstrapDispatchCommandCauseError", () => {
  it("passes through a squashed OrchestrationDispatchCommandError unchanged", () => {
    const error = new OrchestrationDispatchCommandError({ message: "already mapped" });
    expect(toBootstrapDispatchCommandCauseError(Cause.fail(error))).toBe(error);
  });

  it("wraps a squashed Error using its message and keeps the full cause", () => {
    const cause = Cause.fail(new Error("bootstrap exploded"));
    const mapped = toBootstrapDispatchCommandCauseError(cause);
    expect(mapped.message).toBe("bootstrap exploded");
    expect(mapped.cause).toBe(cause);
  });

  it("uses the bootstrap fallback message for non-Error failures", () => {
    const cause = Cause.fail({ random: "value" });
    const mapped = toBootstrapDispatchCommandCauseError(cause);
    expect(mapped.message).toBe("Failed to bootstrap thread turn start.");
    expect(mapped.cause).toBe(cause);
  });
});
