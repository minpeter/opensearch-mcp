import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { extractText, getDocumentProxy } from "unpdf";

import { BROWSER_HEADERS } from "../search/http.ts";
import { getRandomUserAgent } from "../user-agents.ts";
import { isChallengePage } from "./challenge.ts";
import { extractMetadata, metadataToMarkdown } from "./metadata.ts";
import { createFetchResult, type FetchResult } from "./result.ts";
import { transformedUrls } from "./url-transforms.ts";

type PdfDocument = Awaited<ReturnType<typeof getDocumentProxy>>;

const FETCH_TIMEOUT_MS = 30_000;
const IMG_TAG_REGEX = /<img[^>]*>/g;
const JINA_TIMEOUT_MS = 10_000;
const SPARSE_CONTENT_THRESHOLD = 50;
// Statuses that signal a soft block/throttle worth a URL-variant + reader
// fallback before giving up. 451 (Unavailable For Legal Reasons) is deliberately
// excluded: a legal takedown should surface as an error, not be routed around
// via the third-party reader.
const BLOCK_STATUSES = new Set([403, 429, 503]);

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

function fetchPage(url: string): Promise<Response> {
  return fetch(url, {
    headers: buildRequestHeaders(url),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

async function extractPdfContent(buffer: ArrayBuffer): Promise<string> {
  const pdf: PdfDocument = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

/** The Jina reader renders via a real browser, so it often clears soft blocks. */
async function fetchJina(url: string): Promise<string | null> {
  try {
    const response = await fetch(`https://r.jina.ai/${url}`, {
      headers: { "User-Agent": getRandomUserAgent() },
      signal: AbortSignal.timeout(JINA_TIMEOUT_MS),
    });
    if (response.ok) {
      const text = await response.text();
      return text.length > 0 ? text : null;
    }
  } catch {
    // Reader unavailable — caller decides what to do.
  }
  return null;
}

/** Retry a blocked origin on its mobile/apex host variants; null if all fail. */
function isPdf(url: string, contentType: string): boolean {
  return url.endsWith(".pdf") || contentType.includes("application/pdf");
}

/**
 * Turn a successful (2xx) response into a result. PDFs (by extension or
 * Content-Type) are text-extracted; HTML is parsed. Returns null when the body
 * is a WAF challenge so the caller escalates. `url` is the identity to report,
 * which may differ from the variant the body came from.
 */
async function resultFromResponse(
  url: string,
  response: Response
): Promise<FetchResult | null> {
  const contentType = response.headers.get("Content-Type") ?? "";
  if (isPdf(url, contentType)) {
    return createFetchResult(
      url,
      await extractPdfContent(await response.arrayBuffer())
    );
  }
  const raw = await response.text();
  if (isChallengePage(raw)) {
    return null;
  }
  return buildResultFromHtml(url, raw);
}

/** Retry a blocked origin on its mobile/apex host variants. */
async function fetchViaVariants(url: string): Promise<FetchResult | null> {
  for (const variant of transformedUrls(url)) {
    try {
      const response = await fetchPage(variant);
      if (response.ok) {
        const result = await resultFromResponse(url, response);
        if (result) {
          return result;
        }
      }
    } catch {
      // Try the next variant.
    }
  }
  return null;
}

function createTurndown(): TurndownService {
  const turndown = new TurndownService({
    codeBlockStyle: "fenced",
    headingStyle: "atx",
    linkStyle: "referenced",
  });
  turndown.use(gfm);
  turndown.addRule("removeImages", {
    filter: "img",
    replacement: () => "",
  });
  return turndown;
}

/** markdown → reader → structured metadata, in descending fullness. */
async function resolveContent(
  url: string,
  markdown: string,
  metadataMarkdown: string
): Promise<string> {
  if (markdown.length >= SPARSE_CONTENT_THRESHOLD) {
    return markdown;
  }
  const reader = await fetchJina(url);
  if (reader && reader.length >= SPARSE_CONTENT_THRESHOLD) {
    return reader;
  }
  if (metadataMarkdown.length >= SPARSE_CONTENT_THRESHOLD) {
    return metadataMarkdown;
  }
  return markdown || reader || metadataMarkdown;
}

async function buildResultFromHtml(
  url: string,
  html: string
): Promise<FetchResult> {
  const doc = new JSDOM(html.replace(IMG_TAG_REGEX, ""), { url });
  const article = new Readability(doc.window.document).parse();
  const markdown = createTurndown().turndown(article?.content ?? "");
  const metadata = extractMetadata(doc);
  const title = (article?.title ?? "").trim() || metadata.title;
  const content = await resolveContent(
    url,
    markdown,
    metadataToMarkdown(metadata)
  );
  return createFetchResult(url, content, title);
}

export async function fetchLocalUrl(url: string): Promise<FetchResult> {
  const response = await fetchPage(url);

  if (response.ok) {
    // HTTP 200 is not success: resultFromResponse returns null for a WAF
    // challenge body so we escalate instead of ingesting the interstitial.
    const result = await resultFromResponse(url, response);
    if (result) {
      return result;
    }
  } else if (!BLOCK_STATUSES.has(response.status)) {
    throw new Error(`Fetch failed with status ${response.status}`);
  }

  // Blocked or challenged — try URL variants, then the reader.
  const variantResult = await fetchViaVariants(url);
  if (variantResult) {
    return variantResult;
  }

  const reader = await fetchJina(url);
  if (
    reader &&
    reader.length >= SPARSE_CONTENT_THRESHOLD &&
    !isChallengePage(reader)
  ) {
    return createFetchResult(url, reader);
  }
  throw new Error("Fetch blocked by an anti-bot challenge");
}
