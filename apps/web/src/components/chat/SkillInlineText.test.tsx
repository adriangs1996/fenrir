import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SkillInlineText, renderSkillInlineMarkdownChildren } from "./SkillInlineText";

const SKILLS = [
  { name: "docs", displayName: "Docs" },
  { name: "security", displayName: "Security" },
] as const;

describe("SkillInlineText", () => {
  it("renders matching skill tokens as inline chips", () => {
    const markup = renderToStaticMarkup(
      <SkillInlineText text={"Use $docs before $security review"} skills={SKILLS} />,
    );

    expect(markup).toContain("Docs");
    expect(markup).toContain("Security");
    expect(markup).toContain("$docs");
    expect(markup).toContain("$security");
  });

  it("keeps unknown skill tokens as plain text", () => {
    const markup = renderToStaticMarkup(
      <SkillInlineText text={"Leave $unknown untouched"} skills={SKILLS} />,
    );

    expect(markup).toContain("Leave $unknown untouched");
  });

  it("recursively renders markdown child strings while preserving code spans", () => {
    const markup = renderToStaticMarkup(
      <p>
        {renderSkillInlineMarkdownChildren(["Run $docs and ", <code key="c">$docs</code>], SKILLS)}
      </p>,
    );

    expect(markup).toContain("Docs");
    expect(markup).toContain("<code>$docs</code>");
  });
});
