import { describe, expect, it } from "vitest";

import { redactProviderRuntimeImageDataForActivity } from "./providerImageArtifacts.ts";

describe("providerImageArtifacts", () => {
  it("redacts image data from canonical tool result content", () => {
    const redacted = redactProviderRuntimeImageDataForActivity({
      item: {
        result: {
          content: [
            { type: "image", data: "SGVsbG8=", mimeType: "image/png" },
            { type: "text", text: "Fenrir image handle: fenrir-image://browser-lab-test" },
          ],
        },
      },
    }) as {
      readonly item: {
        readonly result: {
          readonly content: ReadonlyArray<{ readonly data?: string }>;
        };
      };
    };

    expect(redacted.item.result.content[0]?.data).toBe("[redacted image data: 8 chars]");
  });
});
