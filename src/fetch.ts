import { Readability } from "@mozilla/readability";

const IMG_TAG_REGEX = /<img[^>]*>/g;

import { JSDOM } from "jsdom";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { extractText, getDocumentProxy } from "unpdf";

import { TtlCache } from "./cache.ts";
import { getRandomUserAgent } from "./user-agents.ts";

export interface FetchResult {
  content: string;
  length: number;
  title: string;
  url: string;
}

export async function fetchUrl(url: string): Promise<FetchResult> {
  const res = await fetch(url, {
    headers: { "User-Agent": getRandomUserAgent() },
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    throw new Error(`Fetch failed with status ${res.status}`);
  }

  const contentType = res.headers.get("Content-Type") ?? "";
  if (url.endsWith(".pdf") || contentType.includes("application/pdf")) {
    const buffer = await res.arrayBuffer();
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });
    const extractedText = text ?? "";
    return {
      title: "",
      content: extractedText,
      url,
      length: extractedText.length,
    };
  }

  const rawHtml = await res.text();
  const html = rawHtml.replace(IMG_TAG_REGEX, "");

  const doc = new JSDOM(html, { url });
  const article = new Readability(doc.window.document).parse();

  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    linkStyle: "referenced",
  });

  turndown.use(gfm);
  turndown.addRule("removeImages", {
    filter: "img",
    replacement: () => "",
  });

  let content = turndown.turndown(article?.content ?? "");

  if (content.length < 50) {
    try {
      const jinaRes = await fetch(`https://r.jina.ai/${url}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (jinaRes.ok) {
        content = await jinaRes.text();
      }
    } catch {
      // Graceful degradation — keep the short content
    }
  }

  return {
    title: article?.title ?? "",
    content,
    url,
    length: content.length,
  };
}

const fetchCache = new TtlCache<string, FetchResult>(3 * 60 * 1000);

export async function fetchUrlWithCache(url: string): Promise<FetchResult> {
  if (fetchCache.has(url)) {
    const cached = fetchCache.get(url);
    if (cached) {
      return cached;
    }
  }

  const result = await fetchUrl(url);
  fetchCache.set(url, result);
  return result;
}
