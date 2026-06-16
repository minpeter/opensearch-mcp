import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { extractMetadata, metadataToMarkdown } from "../fetch/metadata.ts";

describe("extractMetadata", () => {
  it("reads Open Graph, Twitter Card, and meta tags", () => {
    const dom = new JSDOM(
      '<html><head><meta property="og:title" content="OG Title"><meta property="og:description" content="OG desc"><meta name="author" content="Jane"><meta property="og:site_name" content="Site"></head><body></body></html>'
    );
    const meta = extractMetadata(dom);
    expect(meta.title).toBe("OG Title");
    expect(meta.description).toBe("OG desc");
    expect(meta.author).toBe("Jane");
    expect(meta.siteName).toBe("Site");
  });

  it("prefers JSON-LD Article fields and reads nested author", () => {
    const ld = JSON.stringify({
      "@type": "NewsArticle",
      author: { name: "Bob" },
      datePublished: "2026-01-01",
      description: "LD desc",
      headline: "LD Headline",
    });
    const dom = new JSDOM(
      `<html><head><script type="application/ld+json">${ld}</script><meta property="og:title" content="OG Title"></head><body></body></html>`
    );
    const meta = extractMetadata(dom);
    expect(meta.title).toBe("LD Headline");
    expect(meta.description).toBe("LD desc");
    expect(meta.author).toBe("Bob");
    expect(meta.published).toBe("2026-01-01");
  });

  it("handles @graph and tolerates malformed JSON-LD", () => {
    const dom = new JSDOM(
      '<html><head><script type="application/ld+json">{bad json</script><script type="application/ld+json">{"@graph":[{"@type":"BlogPosting","headline":"Graph Title"}]}</script></head><body></body></html>'
    );
    expect(extractMetadata(dom).title).toBe("Graph Title");
  });

  it("prefers the Article node over a thin WebPage node in the same @graph", () => {
    const graph = JSON.stringify({
      "@graph": [
        { "@type": "WebPage", name: "Site Section" },
        {
          "@type": "Article",
          author: { name: "Real Author" },
          headline: "Real Headline",
        },
      ],
    });
    const dom = new JSDOM(
      `<html><head><script type="application/ld+json">${graph}</script></head><body></body></html>`
    );
    const meta = extractMetadata(dom);
    expect(meta.title).toBe("Real Headline");
    expect(meta.author).toBe("Real Author");
  });
});

describe("metadataToMarkdown", () => {
  it("renders title, byline, and description", () => {
    const md = metadataToMarkdown({
      author: "A",
      description: "D",
      published: "2026",
      siteName: "S",
      title: "T",
    });
    expect(md).toBe("# T\n\n_By A · 2026 · S_\n\nD");
  });

  it("is empty when there is no metadata", () => {
    expect(
      metadataToMarkdown({
        author: "",
        description: "",
        published: "",
        siteName: "",
        title: "",
      })
    ).toBe("");
  });
});
