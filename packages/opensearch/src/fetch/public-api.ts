import { z } from "zod";
import { getRandomUserAgent } from "../user-agents.ts";
import { createFetchResult, type FetchResult } from "./result.ts";

/**
 * Phase-0 official public-API routing: a few platforms that generic HTML fetch
 * handles poorly (bot walls / JS shells) expose keyless official JSON endpoints
 * that are more accurate and cheaper. This is the sanctioned exception to "no
 * site-specific code" — these are documented, public, agreed endpoints.
 */

const API_TIMEOUT_MS = 10_000;
const MAX_REDDIT_COMMENTS = 8;
const HN_ID_RADIX = 10;
const TRAILING_SLASH_REGEX = /\/$/;
const REDDIT_HOST_REGEX = /(^|\.)reddit\.com$/;
const DIGITS_REGEX = /^\d+$/;

async function getJson(url: string): Promise<unknown | null> {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": getRandomUserAgent(),
      },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  }
}

// --- Reddit ----------------------------------------------------------------

const redditListingSchema = z.array(
  z.object({
    data: z.object({
      children: z.array(z.object({ data: z.record(z.string(), z.unknown()) })),
    }),
  })
);

function redditField(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  return typeof value === "string" ? value.trim() : "";
}

function buildRedditMarkdown(parsed: z.infer<typeof redditListingSchema>): {
  title: string;
  content: string;
} {
  const post = parsed[0]?.data.children[0]?.data ?? {};
  const title = redditField(post, "title");
  const parts: string[] = [];
  if (title) {
    parts.push(`# ${title}`);
  }
  const selftext = redditField(post, "selftext");
  const link = redditField(post, "url");
  if (selftext) {
    parts.push(selftext);
  } else if (link) {
    parts.push(`Link: ${link}`);
  }

  const comments = (parsed[1]?.data.children ?? [])
    .map((child) => redditField(child.data, "body"))
    .filter(Boolean)
    .slice(0, MAX_REDDIT_COMMENTS);
  if (comments.length > 0) {
    parts.push("## Comments", comments.map((c) => `- ${c}`).join("\n\n"));
  }

  return { content: parts.join("\n\n"), title };
}

async function fetchReddit(url: URL): Promise<FetchResult | null> {
  const path = url.pathname.replace(TRAILING_SLASH_REGEX, "");
  const json = await getJson(`https://www.reddit.com${path}.json`);
  const parsed = redditListingSchema.safeParse(json);
  if (!parsed.success) {
    return null;
  }
  const { title, content } = buildRedditMarkdown(parsed.data);
  return content ? createFetchResult(url.toString(), content, title) : null;
}

function isReddit(url: URL): boolean {
  return (
    REDDIT_HOST_REGEX.test(url.hostname) && url.pathname.includes("/comments/")
  );
}

// --- Hacker News -----------------------------------------------------------

const hnItemSchema = z.object({
  by: z.string().optional(),
  text: z.string().optional(),
  title: z.string().optional(),
  url: z.string().optional(),
});

async function fetchHackerNews(url: URL): Promise<FetchResult | null> {
  const id = url.searchParams.get("id");
  if (!(id && DIGITS_REGEX.test(id))) {
    return null;
  }
  const json = await getJson(
    `https://hacker-news.firebaseio.com/v0/item/${Number.parseInt(id, HN_ID_RADIX)}.json`
  );
  const parsed = hnItemSchema.safeParse(json);
  if (!parsed.success) {
    return null;
  }
  const item = parsed.data;
  const parts: string[] = [];
  if (item.title) {
    parts.push(`# ${item.title}`);
  }
  if (item.by) {
    parts.push(`_by ${item.by}_`);
  }
  if (item.text) {
    parts.push(item.text);
  } else if (item.url) {
    parts.push(`Link: ${item.url}`);
  }
  const content = parts.join("\n\n");
  return content
    ? createFetchResult(url.toString(), content, item.title ?? "")
    : null;
}

function isHackerNews(url: URL): boolean {
  return url.hostname === "news.ycombinator.com" && url.pathname === "/item";
}

// --- Router ----------------------------------------------------------------

/**
 * Route a URL to an official keyless API when one applies; returns null when no
 * route matches or the API call fails (caller falls back to generic fetch).
 */
export function fetchViaPublicApi(rawUrl: string): Promise<FetchResult | null> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return Promise.resolve(null);
  }
  if (isReddit(url)) {
    return fetchReddit(url);
  }
  if (isHackerNews(url)) {
    return fetchHackerNews(url);
  }
  return Promise.resolve(null);
}
