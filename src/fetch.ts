import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { extractText, getDocumentProxy } from "unpdf";
import { z } from "zod";

import { TtlCache } from "./cache.ts";
import { fetchExaMcp } from "./exa-mcp.ts";
import { getRandomUserAgent } from "./user-agents.ts";

export const fetchResultSchema = z.object({
  title: z.string(),
  content: z.string(),
  url: z.string(),
  length: z.number(),
});

export type FetchResult = z.infer<typeof fetchResultSchema>;

type ReadabilityArticle = NonNullable<ReturnType<Readability["parse"]>>;
type PdfDocument = Awaited<ReturnType<typeof getDocumentProxy>>;

const FETCH_TIMEOUT_MS = 30_000;
const IMG_TAG_REGEX = /<img[^>]*>/g;
const JINA_TIMEOUT_MS = 10_000;
const EXA_API_TIMEOUT_MS = 10_000;
const EXA_API_KEY_ENV = "EXA_API_KEY";
const EXA_CONTENTS_API_URL = "https://api.exa.ai/contents";
const OPENSEARCH_ENABLE_EXA_MCP_ENV = "OPENSEARCH_ENABLE_EXA_MCP";
const SPARSE_CONTENT_THRESHOLD = 50;
const exaContentsResponseSchema = z.object({
  results: z
    .array(
      z.object({
        text: z.string().optional(),
        title: z.string().optional(),
        url: z.string().optional(),
      })
    )
    .default([]),
  statuses: z
    .array(
      z.object({
        id: z.string().optional(),
        status: z.string(),
        error: z
          .object({
            httpStatusCode: z.number().optional(),
            tag: z.string().optional(),
          })
          .optional(),
      })
    )
    .optional(),
});

function createFetchResult(
  url: string,
  content: string,
  title = ""
): FetchResult {
  return {
    title,
    content,
    url,
    length: content.length,
  };
}

async function extractPdfContent(buffer: ArrayBuffer): Promise<string> {
  const pdf: PdfDocument = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

async function fetchExaApi(url: string): Promise<FetchResult> {
  const apiKey = process.env[EXA_API_KEY_ENV]?.trim();
  if (!apiKey) {
    throw new Error("Exa API key is not configured");
  }

  const response = await fetch(EXA_CONTENTS_API_URL, {
    body: JSON.stringify({
      text: true,
      urls: [url],
    }),
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    method: "POST",
    signal: AbortSignal.timeout(EXA_API_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Exa API fetch failed with status ${response.status}`);
  }

  const payload = exaContentsResponseSchema.parse(await response.json());
  const status =
    payload.statuses?.find((entry) => entry.id === url) ??
    payload.statuses?.[0];

  if (status?.status === "error") {
    const errorTag = status.error?.tag ?? "unknown-error";
    const errorCode = status.error?.httpStatusCode;
    throw new Error(
      errorCode
        ? `Exa API fetch failed: ${errorTag} (${errorCode})`
        : `Exa API fetch failed: ${errorTag}`
    );
  }

  const result =
    payload.results.find((entry) => entry.text?.trim()) ?? payload.results[0];

  if (!result?.text?.trim()) {
    throw new Error("Exa API fetch returned no text content");
  }

  return createFetchResult(result.url ?? url, result.text, result.title ?? "");
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
      signal: AbortSignal.timeout(JINA_TIMEOUT_MS),
    });

    if (response.ok) {
      return await response.text();
    }
  } catch {
    // Keep the original content when Jina fails.
  }

  return content;
}

export async function fetchUrl(url: string): Promise<FetchResult> {
  if (isExaMcpEnabled()) {
    try {
      const exaResult = await fetchExaMcp(url);
      return createFetchResult(url, exaResult.content, exaResult.title);
    } catch {
      // Fall through to the official Exa API or local fetch pipeline.
    }
  }

  if (process.env[EXA_API_KEY_ENV]?.trim()) {
    try {
      return await fetchExaApi(url);
    } catch {
      // Fall through to the local fetch pipeline.
    }
  }

  const response = await fetch(url, {
    headers: { "User-Agent": getRandomUserAgent() },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Fetch failed with status ${response.status}`);
  }

  const contentType = response.headers.get("Content-Type") ?? "";
  if (url.endsWith(".pdf") || contentType.includes("application/pdf")) {
    const extractedText = await extractPdfContent(await response.arrayBuffer());
    return createFetchResult(url, extractedText);
  }

  const htmlWithoutImages = (await response.text()).replace(IMG_TAG_REGEX, "");

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

const fetchCache = new TtlCache<string, FetchResult>(3 * 60 * 1000);

export function fetchUrlWithCache(url: string): Promise<FetchResult> {
  return fetchCache.getOrSet(url, () => fetchUrl(url));
}

function isExaMcpEnabled(): boolean {
  return process.env[OPENSEARCH_ENABLE_EXA_MCP_ENV] !== "false";
}
