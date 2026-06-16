import { describe, expect, it } from "vitest";
import { transformedUrls } from "../fetch/url-transforms.ts";

describe("transformedUrls", () => {
  it("maps a www host to mobile and apex variants", () => {
    expect(transformedUrls("https://www.example.com/a?b=1")).toEqual([
      "https://m.example.com/a?b=1",
      "https://example.com/a?b=1",
    ]);
  });

  it("maps an apex host to its mobile subdomain", () => {
    expect(transformedUrls("https://example.com/a")).toEqual([
      "https://m.example.com/a",
    ]);
  });

  it("treats an apex under a compound TLD as apex, not a subdomain", () => {
    expect(transformedUrls("https://example.co.uk/a")).toEqual([
      "https://m.example.co.uk/a",
    ]);
    expect(transformedUrls("https://example.com.au/a")).toEqual([
      "https://m.example.com.au/a",
    ]);
  });

  it("skips deep subdomains and hosts already on m.", () => {
    expect(transformedUrls("https://docs.example.com/a")).toEqual([]);
    expect(transformedUrls("https://docs.example.co.uk/a")).toEqual([]);
    expect(transformedUrls("https://m.example.com/a")).toEqual([]);
  });

  it("returns [] for non-http(s) or invalid URLs", () => {
    expect(transformedUrls("ftp://example.com")).toEqual([]);
    expect(transformedUrls("not a url")).toEqual([]);
  });

  it("strips embedded Basic-auth credentials from variants", () => {
    const variants = transformedUrls("https://user:pass@www.example.com/a");
    expect(variants).toEqual([
      "https://m.example.com/a",
      "https://example.com/a",
    ]);
    expect(variants.some((u) => u.includes("user") || u.includes("pass"))).toBe(
      false
    );
  });
});
