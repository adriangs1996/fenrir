import { assert, describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { TmuxAttachInput, TmuxDetachInput, TmuxSessionSnapshot, TmuxError } from "./terminal";

function decode<S extends Schema.Top>(schema: S, input: unknown) {
  return Schema.decodeUnknownEffect(schema as never)(input) as Effect.Effect<
    Schema.Schema.Type<S>,
    Schema.SchemaError,
    never
  >;
}

describe("TmuxSessionSnapshot", () => {
  it.effect("accepts valid snapshot", () =>
    Effect.gen(function* () {
      const parsed = yield* decode(TmuxSessionSnapshot, {
        projectId: "abc-123",
        sessionName: "fenrir-abc-123",
        pid: 12345,
      });
      assert.strictEqual(parsed.projectId, "abc-123");
      assert.strictEqual(parsed.sessionName, "fenrir-abc-123");
      assert.strictEqual(parsed.pid, 12345);
    }),
  );

  it.effect("accepts null pid", () =>
    Effect.gen(function* () {
      const parsed = yield* decode(TmuxSessionSnapshot, {
        projectId: "abc",
        sessionName: "fenrir-abc",
        pid: null,
      });
      assert.isNull(parsed.pid);
    }),
  );
});

describe("TmuxDetachInput", () => {
  it.effect("accept valid projectId", () =>
    Effect.gen(function* () {
      const parsed = yield* decode(TmuxDetachInput, {
        projectId: "abc-123",
      });

      assert.strictEqual(parsed.projectId, "abc-123");
    }),
  );

  it.effect("rejects empty projectId", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(decode(TmuxDetachInput, { projectId: "" }));
      assert.strictEqual(result._tag, "Failure");
    }),
  );
});

describe("TmuxAttachInput", () => {
  it.effect("accepts valid input", () =>
    Effect.gen(function* () {
      const parsed = yield* decode(TmuxAttachInput, {
        projectId: "abc-123",
        cwd: "/home/user/project",
        cols: 120,
        rows: 40,
      });

      assert.strictEqual(parsed.projectId, "abc-123");
      assert.strictEqual(parsed.cwd, "/home/user/project");
      assert.strictEqual(parsed.cols, 120);
      assert.strictEqual(parsed.rows, 40);
    }),
  );

  it.effect("rejects empty projectId", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(
        decode(TmuxAttachInput, {
          cwd: "/home/user/project",
          cols: 120,
          rows: 40,
        }),
      );

      assert.strictEqual(result._tag, "Failure");
    }),
  );

  it.effect("rejects cols below minimum (20)", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(
        decode(TmuxAttachInput, {
          project: "test",
          cwd: "/home/user/project",
          cols: 19,
          rows: 40,
        }),
      );

      assert.strictEqual(result._tag, "Failure");
    }),
  );

  it.effect("rejects rows above maximum (200)", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(
        decode(TmuxAttachInput, {
          projectId: "test",
          cwd: "/tmp",
          cols: 80,
          rows: 999,
        }),
      );
      assert.strictEqual(result._tag, "Failure");
    }),
  );
});

describe("TmuxError", () => {
  it("has correct _tag", () => {
    const error = new TmuxError({ message: "something broke" });
    expect(error._tag).toBe("TmuxError");
    expect(error.message).toBe("something broke");
  });
});
