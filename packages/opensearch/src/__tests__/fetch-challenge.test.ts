import { describe, expect, it } from "vitest";
import { isChallengePage } from "../fetch/challenge.ts";

describe("isChallengePage", () => {
  it("flags strong vendor tokens unconditionally", () => {
    expect(
      isChallengePage(
        `<html><head><script src="/cdn-cgi/challenge-platform/x.js"></script></head><body>${"x".repeat(5000)}</body></html>`
      )
    ).toBe(true);
    expect(isChallengePage("<html>cf-chl-bypass</html>")).toBe(true);
  });

  it("flags a Cloudflare interstitial via the title", () => {
    expect(
      isChallengePage(
        "<html><head><title>Just a moment...</title></head><body>Enable JavaScript and cookies to continue</body></html>"
      )
    ).toBe(true);
  });

  it("flags a tiny body carrying a weak marker", () => {
    expect(
      isChallengePage("<html><body>Verify you are human</body></html>")
    ).toBe(true);
  });

  it("does NOT flag a long legit article that merely mentions a marker word", () => {
    const article = `<html><head><title>How CAPTCHA and DataDome work</title></head><body>${"<p>A long, real article about anti-bot systems and access denied pages. </p>".repeat(120)}</body></html>`;
    expect(isChallengePage(article)).toBe(false);
  });

  it("returns false for empty input", () => {
    expect(isChallengePage("")).toBe(false);
  });
});
