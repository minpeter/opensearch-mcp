import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchViaPublicApi } from "../fetch/public-api.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchViaPublicApi", () => {
  it("returns null for non-routed URLs without making a request", async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    expect(await fetchViaPublicApi("https://example.com/article")).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("routes a Reddit comments URL to the .json API", async () => {
    const body = JSON.stringify([
      {
        data: {
          children: [{ data: { selftext: "Body text", title: "Post title" } }],
        },
      },
      {
        data: {
          children: [
            { data: { body: "A comment" } },
            { data: { body: "More" } },
          ],
        },
      },
    ]);
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response(body, { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchViaPublicApi(
      "https://www.reddit.com/r/rust/comments/abc/title/"
    );

    expect(String(mockFetch.mock.calls[0]?.[0])).toBe(
      "https://www.reddit.com/r/rust/comments/abc/title.json"
    );
    expect(result?.title).toBe("Post title");
    expect(result?.content).toContain("Body text");
    expect(result?.content).toContain("A comment");
  });

  it("routes a Hacker News item URL to the Firebase API", async () => {
    const body = JSON.stringify({
      by: "user",
      text: "HN text",
      title: "HN Title",
    });
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response(body, { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchViaPublicApi(
      "https://news.ycombinator.com/item?id=12345"
    );

    expect(String(mockFetch.mock.calls[0]?.[0])).toContain(
      "hacker-news.firebaseio.com/v0/item/12345.json"
    );
    expect(result?.title).toBe("HN Title");
    expect(result?.content).toContain("HN text");
  });

  it("returns null when the official API call fails", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 500 }));
    vi.stubGlobal("fetch", mockFetch);

    expect(
      await fetchViaPublicApi("https://news.ycombinator.com/item?id=1")
    ).toBeNull();
  });
});
