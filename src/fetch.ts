import { Readability } from "@mozilla/readability";

const IMG_TAG_REGEX = /<img[^>]*>/g;

import { JSDOM } from "jsdom";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { extractText, getDocumentProxy } from "unpdf";
import { z } from "zod";

import { TtlCache } from "./cache.ts";
import { getRandomUserAgent } from "./user-agents.ts";

export const fetchResultSchema = z.object({
  title: z.string(),
  content: z.string(),
  url: z.string(),
  length: z.number(),
});

type FetchResult = z.infer<typeof fetchResultSchema>;

type ReadabilityArticle = NonNullable<ReturnType<Readability["parse"]>>;
type PdfDocument = Awaited<ReturnType<typeof getDocumentProxy>>;

function getArticleContent(article: ReadabilityArticle | null): string {
  return article?.content ?? "";
}

function getArticleTitle(article: ReadabilityArticle | null): string {
  return article?.title ?? "";
}

async function extractPdfContent(buffer: ArrayBuffer): Promise<string> {
  const pdf: PdfDocument = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
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
    const extractedText = await extractPdfContent(await res.arrayBuffer());
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
  const article: ReadabilityArticle | null = new Readability(
    doc.window.document
  ).parse();

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

  let content = turndown.turndown(getArticleContent(article));

  if (content.length < 50) {
    try {
      const jinaRes = await fetch(`https://r.jina.ai/${url}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (jinaRes.ok) {
        content = await jinaRes.text();
      }
    } catch {
      // Keep the original content when Jina fails.
    }
  }

  return {
    title: getArticleTitle(article),
    content,
    url,
    length: content.length,
  };
}

const fetchCache = new TtlCache<string, FetchResult>(3 * 60 * 1000);

export function fetchUrlWithCache(url: string): Promise<FetchResult> {
  return fetchCache.getOrSet(url, () => fetchUrl(url));
}
