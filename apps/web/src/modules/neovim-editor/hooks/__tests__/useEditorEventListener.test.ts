import { describe, expect, it, vi } from "vitest";
import {
  BUF_WRITE_POST_EVENT,
  handleEditorEvent,
  shouldSubscribe,
} from "../useEditorEventListener";

describe("shouldSubscribe", () => {
  it("returns true when both bridge and main window", () => {
    expect(shouldSubscribe(true, true)).toBe(true);
  });

  it("returns false when bridge unavailable", () => {
    expect(shouldSubscribe(false, true)).toBe(false);
  });

  it("returns false when not main window", () => {
    expect(shouldSubscribe(true, false)).toBe(false);
  });

  it("returns false when both unavailable", () => {
    expect(shouldSubscribe(false, false)).toBe(false);
  });
});

describe("handleEditorEvent", () => {
  function makeStore() {
    return {
      setCurrentFile: vi.fn(),
      setDirty: vi.fn(),
    };
  }

  it("buf_enter sets currentFile via store", () => {
    const store = makeStore();
    const dispatch = vi.fn();
    handleEditorEvent({ kind: "buf_enter", file: "/src/main.rs", ft: "rust" }, store, dispatch);
    expect(store.setCurrentFile).toHaveBeenCalledWith("/src/main.rs");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("buf_modified_set with modified=true marks file dirty", () => {
    const store = makeStore();
    const dispatch = vi.fn();
    handleEditorEvent(
      { kind: "buf_modified_set", file: "/src/lib.rs", modified: true },
      store,
      dispatch,
    );
    expect(store.setDirty).toHaveBeenCalledWith("/src/lib.rs", true);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("buf_modified_set with modified=false removes file from dirty set", () => {
    const store = makeStore();
    const dispatch = vi.fn();
    handleEditorEvent(
      { kind: "buf_modified_set", file: "/src/lib.rs", modified: false },
      store,
      dispatch,
    );
    expect(store.setDirty).toHaveBeenCalledWith("/src/lib.rs", false);
  });

  it("buf_write_post dispatches window CustomEvent with file detail", () => {
    const store = makeStore();
    const dispatch = vi.fn();
    handleEditorEvent({ kind: "buf_write_post", file: "/src/main.rs" }, store, dispatch);

    expect(dispatch).toHaveBeenCalledTimes(1);
    const event = dispatch.mock.calls[0]![0] as CustomEvent;
    expect(event.type).toBe(BUF_WRITE_POST_EVENT);
    expect(event.detail).toEqual({ file: "/src/main.rs" });
    expect(store.setCurrentFile).not.toHaveBeenCalled();
    expect(store.setDirty).not.toHaveBeenCalled();
  });

  it("buf_write_post does not mutate store", () => {
    const store = makeStore();
    const dispatch = vi.fn();
    handleEditorEvent({ kind: "buf_write_post", file: "/a.ts" }, store, dispatch);
    expect(store.setCurrentFile).not.toHaveBeenCalled();
    expect(store.setDirty).not.toHaveBeenCalled();
  });
});

describe("BUF_WRITE_POST_EVENT", () => {
  it("equals fenrir:editor:bufWritePost", () => {
    expect(BUF_WRITE_POST_EVENT).toBe("fenrir:editor:bufWritePost");
  });
});
