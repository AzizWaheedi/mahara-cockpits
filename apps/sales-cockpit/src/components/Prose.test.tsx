// bun test src/components/Prose.test.tsx
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Prose } from "./Prose";

const html = (text: string) => renderToStaticMarkup(<Prose text={text} />);

describe("Prose", () => {
  test("a model's HTML stays text", () => {
    const out = html('<script>alert(1)</script> and <img src=x onerror="y">');
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;script&gt;");
  });
  test("only http links become links", () => {
    const out = html(
      "[see](javascript:alert(1)) and [call](https://fathom.video/share/x)",
    );
    expect(out).not.toContain('href="javascript');
    expect(out).toContain('href="https://fathom.video/share/x"');
    expect(out).toContain('rel="noreferrer noopener"');
  });
  test("Slack bold, markdown bold, bullets and headings", () => {
    const out = html(
      "### Topics\n*Frame Set — 4/10*\n- **Budget** asked early\n- next step",
    );
    expect(out).toContain("<strong>Frame Set — 4/10</strong>");
    expect(out).toContain("<strong>Budget</strong>");
    expect(out).toContain("<ul");
    expect((out.match(/<li/g) ?? []).length).toBe(2);
    expect(out).toContain(">Topics</p>");
  });
  test("Arabic lines set their own direction", () => {
    expect(html("خلينا ندخل مباشرة")).toContain('dir="auto"');
  });
  test("nothing to show is nothing", () => {
    expect(html("   ")).toBe("");
  });
});
