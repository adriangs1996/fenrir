import { describe, expect, it } from "vitest";

import { CHAT_LIST_ANCHOR_OFFSET, resolveChatListAnchor } from "./chatList";

interface Row {
  readonly id: string;
  readonly anchorable: boolean;
}

const rows: ReadonlyArray<Row> = [
  { id: "first", anchorable: true },
  { id: "ignored", anchorable: false },
  { id: "latest", anchorable: true },
];

const getAnchorId = (row: Row) => (row.anchorable ? row.id : null);

describe("resolveChatListAnchor", () => {
  it("anchors the matching row", () => {
    expect(resolveChatListAnchor(rows, "latest", getAnchorId)).toEqual({
      anchorIndex: 2,
      anchorOffset: CHAT_LIST_ANCHOR_OFFSET,
    });
  });

  it("allows callers to override the anchor offset", () => {
    expect(resolveChatListAnchor(rows, "latest", getAnchorId, { anchorOffset: 132 })).toEqual({
      anchorIndex: 2,
      anchorOffset: 132,
    });
  });

  it("ignores ineligible rows and missing anchors", () => {
    expect(resolveChatListAnchor(rows, "ignored", getAnchorId)).toBeUndefined();
    expect(resolveChatListAnchor(rows, "missing", getAnchorId)).toBeUndefined();
    expect(resolveChatListAnchor(rows, null, getAnchorId)).toBeUndefined();
  });
});
