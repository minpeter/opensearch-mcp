import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { extractText, getDocumentProxy } from "unpdf";

import { BROWSER_HEADERS } from "../search/http.ts";
import { getRandomUserAgent } from "../user-agents.ts";
import { isChallengePage } from "./challenge.ts";
import { createFetchResult, type FetchResult } from "./result.ts";

type ReadabilityArticle = NonNullable<ReturnType<Readability["parse"]>>;
type PdfDocument = Awaited<ReturnType<typeof getDocumentProxy>>;

const FETCH_TIMEOUT_MS = 30_000;
const IMG_TAG_REGEX = /<img[^>]*>/g;
const JINA_TIMEOUT_MS = 10_000;
const SPARSE_CONTENT_THRESHOLD = 50;
// Statuses that signal a block/throttle rather than a hard error — worth a
// reader-fallback attempt before giving up.
const BLOCK_STATUSES = new Set([403, 429, 451, 503]);

function buildRequestHeaders(url: string): Record<string, string> {
  const headers: Record<string, string> = {
    ...BROWSER_HEADERS,
    "User-Agent": getRandomUserAgent(),
  };
  try {
    // A same-origin Referer makes the request look like in-site navigation,
    // which referer-gating WAFs expect.
    headers.Referer = `${new URL(url).origin}/`;
  } catch {
    // Non-absolute URL — let the fetch surface the error itself.
  }
  return headers;
}

async function extractPdfContent(buffer: ArrayBuffer): Promise<string> {
  const pdf: PdfDocument = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

async function getFallbackContent(
  url: string,
  content: string
): Promise<string> {
  if (content.length >= SPARSE_CONTENT_THRESHOLD) {
    return content;
  }

  try {
    const response = await fetch(`https://r.jina.ai/${url}`, {
      headers: { "User-Agent": getRandomUserAgent() },
      signal: AbortSignal.timeout(JINA_TIMEOUT_MS),
    });

    if (response.ok) {
      return await response.text();
    }
  } catch (error) {
    if (error instanceof Error) {
      return content;
    }

    throw error;
  }

  return content;
}

export async function fetchLocalUrl(url: string): Promise<FetchResult> {
  const response = await fetch(url, {
    headers: buildRequestHeaders(url),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    // A block/throttle status may still be readable through the Jina reader
    // (it renders via a real browser), so escalate before failing.
    if (BLOCK_STATUSES.has(response.status)) {
      const fallback = await getFallbackContent(url, "");
      if (fallback) {
        return createFetchResult(url, fallback);
      }
    }
    throw new Error(`Fetch failed with status ${response.status}`);
  }

  const contentType = response.headers.get("Content-Type") ?? "";
  if (url.endsWith(".pdf") || contentType.includes("application/pdf")) {
    const extractedText = await extractPdfContent(await response.arrayBuffer());
    return createFetchResult(url, extractedText);
  }

  const rawHtml = await response.text();

  // HTTP 200 is not success: a WAF interstitial would otherwise be turned into
  // markdown and ingested as the page. Escalate to the reader fallback instead.
  if (isChallengePage(rawHtml)) {
    const fallback = await getFallbackContent(url, "");
    if (fallback) {
      return createFetchResult(url, fallback);
    }
    throw new Error("Fetch blocked by an anti-bot challenge");
  }

  const htmlWithoutImages = rawHtml.replace(IMG_TAG_REGEX, "");

  const doc = new JSDOM(htmlWithoutImages, { url });
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

  const content = await getFallbackContent(
    url,
    turndown.turndown(article?.content ?? "")
  );

  return createFetchResult(url, content, article?.title ?? "");
}
