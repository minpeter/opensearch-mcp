import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { extractText, getDocumentProxy } from "unpdf";
import { z } from "zod";

import { TtlCache } from "./cache.ts";
import { fetchExaMcp, fetchExaMcpBatch } from "./exa-mcp.ts";
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
const DEFAULT_MAX_CHARACTERS = 12_000;
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

type ExaContentsStatus = z.infer<
  typeof exaContentsResponseSchema
>["statuses"] extends (infer Status)[] | undefined
  ? Status
  : never;

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
  const [result] = await fetchExaApiBatch([url]);

  if (!result) {
    throw new Error("Exa API fetch returned no text content");
  }

  return result;
}

async function fetchExaApiBatch(
  urls: string[],
  maxCharacters = DEFAULT_MAX_CHARACTERS
): Promise<FetchResult[]> {
  const apiKey = process.env[EXA_API_KEY_ENV]?.trim();
  if (!apiKey) {
    throw new Error("Exa API key is not configured");
  }

  const response = await fetch(EXA_CONTENTS_API_URL, {
    body: JSON.stringify({
      text: {
        maxCharacters,
      },
      urls,
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
  const statusesById = new Map(
    (payload.statuses ?? [])
      .map((status) =>
        status.id ? ([status.id, status] as const) : null
      )
      .filter(
        (entry): entry is readonly [string, ExaContentsStatus] => entry !== null
      )
  );
  const resultsByUrl = new Map(
    payload.results
      .filter((result) => result.url && result.text?.trim())
      .map((result) => [result.url as string, result] as const)
  );

  const normalizedResults: FetchResult[] = [];

  for (const [index, url] of urls.entries()) {
    const status = statusesById.get(url) ?? payload.statuses?.[index];

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
      resultsByUrl.get(url) ??
      payload.results.find((entry) => entry.text?.trim() && entry.url === url) ??
      payload.results[index];

    if (!result?.text?.trim()) {
      throw new Error("Exa API fetch returned no text content");
    }

    normalizedResults.push(createFetchResult(url, result.text, result.title ?? ""));
  }

  return normalizedResults;
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
  const [result] = await fetchUrls([url]);

  if (!result) {
    throw new Error("Fetch returned no results");
  }

  return result;
}

async function fetchUrlDirect(url: string): Promise<FetchResult> {
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

export async function fetchUrls(
  urls: string[],
  maxCharacters = DEFAULT_MAX_CHARACTERS
): Promise<FetchResult[]> {
  if (urls.length === 0) {
    return [];
  }

  if (isExaMcpEnabled()) {
    try {
      const exaResults = await fetchExaMcpBatch(urls, maxCharacters);
      return urls.map((url, index) => {
        const exaResult =
          exaResults.find((result) => result.url === url) ?? exaResults[index];

        if (!exaResult) {
          throw new Error("Exa MCP fetch returned an unexpected response shape");
        }

        return createFetchResult(url, exaResult.content, exaResult.title);
      });
    } catch {
      // Fall through to the official Exa API or local fetch pipeline.
    }
  }

  if (process.env[EXA_API_KEY_ENV]?.trim()) {
    try {
      return await fetchExaApiBatch(urls, maxCharacters);
    } catch {
      // Fall through to the local fetch pipeline.
    }
  }

  return Promise.all(urls.map((url) => fetchUrlDirect(url)));
}

const fetchCache = new TtlCache<string, FetchResult>(3 * 60 * 1000);

export function fetchUrlWithCache(url: string): Promise<FetchResult> {
  return fetchCache.getOrSet(url, () => fetchUrl(url));
}

export async function fetchUrlsWithCache(
  urls: string[],
  maxCharacters?: number
): Promise<FetchResult[]> {
  if (maxCharacters !== undefined) {
    return fetchUrls(urls, maxCharacters);
  }

  const uncachedUrls = urls.filter((url) => !fetchCache.has(url));

  if (uncachedUrls.length > 0) {
    const fetchedResults = await fetchUrls(uncachedUrls);

    for (const result of fetchedResults) {
      fetchCache.set(result.url, result);
    }
  }

  return Promise.all(urls.map((url) => fetchUrlWithCache(url)));
}

function isExaMcpEnabled(): boolean {
  return process.env[OPENSEARCH_ENABLE_EXA_MCP_ENV] !== "false";
}
