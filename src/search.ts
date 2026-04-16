import { load } from "cheerio";
import pRetry from "p-retry";

import { TtlCache } from "./cache.ts";
import { getRandomUserAgent } from "./user-agents.ts";

export type SearchEngineName = "Bing" | "DuckDuckGo" | "Google";

export interface SearchResult {
  engine: SearchEngineName;
  snippet: string;
  title: string;
  url: string;
}

/** Internal shape returned by parse functions before the engine name is stamped. */
type ParsedResult = Omit<SearchResult, "engine">;

type EngineFailureKind = "blocked" | "no-results" | "transient";

type CheerioSelection = ReturnType<ReturnType<typeof load>>;

interface SearchEngine {
  getRequestInit(query: string): {
    init: RequestInit;
    url: string;
  };
  name: SearchEngineName;
  parse(html: string): ParsedResult[];
}

interface SearchExecutionMetadata {
  failures: SearchEngineError[];
}

class SearchExecutionError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "SearchExecutionError";
    this.retryable = retryable;
  }
}

class SearchEngineError extends Error {
  readonly engine: SearchEngineName;
  readonly kind: EngineFailureKind;

  constructor(
    engine: SearchEngineName,
    kind: EngineFailureKind,
    message: string
  ) {
    super(message);
    this.engine = engine;
    this.kind = kind;
    this.name = "SearchEngineError";
  }
}

const REQUEST_TIMEOUT_MS = 8000;
const MAX_HEURISTIC_SNIPPET_LENGTH = 280;
const BROWSER_HEADERS = {
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "Upgrade-Insecure-Requests": "1",
} as const;

const SEARCH_ENGINE_HOSTS: Record<SearchEngineName, string[]> = {
  Bing: ["bing.com", "www.bing.com"],
  DuckDuckGo: ["duckduckgo.com", "html.duckduckgo.com", "www.duckduckgo.com"],
  Google: ["google.com", "www.google.com"],
};

const SEARCH_ENGINE_INTERNAL_HOST_PATTERNS: Record<SearchEngineName, RegExp[]> =
  {
    Bing: [/\bbing\.com$/u, /\bmicrosoft\.com$/u],
    DuckDuckGo: [/\bduckduckgo\.com$/u],
    Google: [
      /\bgoogle\.com$/u,
      /\bsupport\.google\.com$/u,
      /\baccounts\.google\.com$/u,
      /\bmyaccount\.google\.com$/u,
      /\bpolicies\.google\.com$/u,
    ],
  };

const SEARCH_ENGINE_INTERNAL_ONLY_HOST_PATTERNS: Record<
  SearchEngineName,
  RegExp[]
> = {
  Bing: [/\bhelp\.bing\.microsoft\.com$/u],
  DuckDuckGo: [],
  Google: [
    /\bsupport\.google\.com$/u,
    /\baccounts\.google\.com$/u,
    /\bmyaccount\.google\.com$/u,
    /\bpolicies\.google\.com$/u,
  ],
};

const INTERNAL_PATH_SEGMENT_PATTERNS = [
  /(^|\/)(account|accounts)(\/|$)/u,
  /(^|\/)(captcha|challenge)(\/|$)/u,
  /(^|\/)(feedback|troubleshoot|troubleshooter|troubleshooting)(\/|$)/u,
  /(^|\/)(help|support)(\/|$)/u,
  /(^|\/)(preferences|settings)(\/|$)/u,
  /(^|\/)search(\/|$)/u,
];

const INTERNAL_QUERY_PARAMETER_KEYS = new Set([
  "aqs",
  "ei",
  "form",
  "fpstate",
  "gfe_rd",
  "iflsig",
  "pq",
  "sa",
  "sei",
  "source",
  "ved",
]);

const SEARCH_ENGINES: SearchEngine[] = [
  {
    name: "DuckDuckGo",
    getRequestInit(query: string) {
      const formData = new FormData();
      formData.append("q", query);

      return {
        url: "https://html.duckduckgo.com/html/",
        init: {
          method: "POST",
          headers: {
            ...BROWSER_HEADERS,
            "User-Agent": getRandomUserAgent(),
          },
          body: formData,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      };
    },
    parse: parseDuckDuckGoResults,
  },
  {
    name: "Google",
    getRequestInit(query: string) {
      const url = new URL("https://www.google.com/search");
      url.searchParams.set("q", query);
      url.searchParams.set("hl", "en");

      return {
        url: url.toString(),
        init: {
          method: "GET",
          headers: {
            ...BROWSER_HEADERS,
            "User-Agent": getRandomUserAgent(),
          },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      };
    },
    parse: parseGoogleResults,
  },
  {
    name: "Bing",
    getRequestInit(query: string) {
      const url = new URL("https://www.bing.com/search");
      url.searchParams.set("q", query);
      url.searchParams.set("setlang", "en-US");

      return {
        url: url.toString(),
        init: {
          method: "GET",
          headers: {
            ...BROWSER_HEADERS,
            "User-Agent": getRandomUserAgent(),
          },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      };
    },
    parse: parseBingResults,
  },
];

export async function search(query: string): Promise<SearchResult[]> {
  return (await searchDetailed(query)).results;
}

async function searchDetailed(
  query: string
): Promise<{ metadata: SearchExecutionMetadata; results: SearchResult[] }> {
  const failures: SearchEngineError[] = [];

  for (const engine of SEARCH_ENGINES) {
    try {
      const results = await searchWithEngine(engine, query);
      return {
        metadata: { failures },
        results,
      };
    } catch (error) {
      if (error instanceof SearchEngineError) {
        failures.push(error);
        continue;
      }

      throw error;
    }
  }

  if (failures.every((failure) => failure.kind === "no-results")) {
    throw new Error("No Results");
  }

  const failedEngines = failures.map((failure) => failure.engine).join(", ");
  const failureSummary = formatFailureSummary(failures);

  if (failures.every((failure) => failure.kind === "blocked")) {
    throw new Error(
      `All search engines failed: ${failedEngines}${failureSummary}`
    );
  }

  if (failures.every((failure) => failure.kind !== "no-results")) {
    throw new SearchExecutionError(
      `Search failed across all engines: ${failedEngines}${failureSummary}`,
      failures.every((failure) => failure.kind === "transient")
    );
  }

  throw new Error(
    `All search engines failed: ${failedEngines}${failureSummary}`
  );
}

async function searchWithEngine(
  engine: SearchEngine,
  query: string
): Promise<SearchResult[]> {
  const { url, init } = engine.getRequestInit(query);
  let response: Response;

  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new SearchEngineError(
      engine.name,
      "transient",
      `${engine.name} fetch failed: ${getErrorMessage(error)}`
    );
  }

  if (!response.ok) {
    throw new SearchEngineError(
      engine.name,
      classifyStatusFailure(response.status),
      `${engine.name} fetch failed with status ${response.status}`
    );
  }

  const html = await response.text();
  return engine.parse(html).map((r) => ({ ...r, engine: engine.name }));
}

function parseDuckDuckGoResults(html: string): ParsedResult[] {
  const $ = load(html);

  if ($(".no-results").length > 0) {
    throw new SearchEngineError("DuckDuckGo", "no-results", "No Results");
  }

  if ($(".challenge-form, #challenge-form").length > 0) {
    throw new SearchEngineError(
      "DuckDuckGo",
      "blocked",
      "Too many requests (Bot detected)"
    );
  }

  const results = collectResults(
    $,
    ".zci, #links > .result, .result.results_links, .result.results_links_deep",
    ($result) => ({
      snippet: $result(".zci__result, .result__snippet").first().text().trim(),
      title: $result(".zci__heading > a, .result__title .result__a, .result__a")
        .first()
        .text()
        .trim(),
      url:
        $result(".zci__heading > a, .result__title .result__a, .result__a")
          .first()
          .attr("href")
          ?.trim() ?? "",
    })
  );

  return ensureResults(results, $, "DuckDuckGo");
}

function parseGoogleResults(html: string): ParsedResult[] {
  const $ = load(html);
  const pageText = $.text();

  if (pageText.includes("did not match any documents")) {
    throw new SearchEngineError("Google", "no-results", "No Results");
  }

  if (
    pageText.includes("did not match any results") ||
    pageText.includes("No results found for")
  ) {
    throw new SearchEngineError("Google", "no-results", "No Results");
  }

  if (
    pageText.includes("Our systems have detected unusual traffic") ||
    pageText.includes("To continue, please type the characters below") ||
    $("#captcha-form, form#challenge-form, #recaptcha").length > 0
  ) {
    throw new SearchEngineError(
      "Google",
      "blocked",
      "Google blocked the request"
    );
  }

  const results = collectResults($, "div.g, div[data-snc]", ($result) => {
    const anchor = $result("a[href]").has("h3").first();
    const href = normalizeGoogleUrl(anchor.attr("href") ?? "");

    return {
      snippet: $result(".VwiC3b, .yXK7lf, .MUxGbd, .s3v9rd")
        .first()
        .text()
        .trim(),
      title: anchor.find("h3").first().text().trim(),
      url: href,
    };
  });

  return ensureResults(results, $, "Google");
}

function parseBingResults(html: string): ParsedResult[] {
  const $ = load(html);
  const pageText = $.text();

  if (
    pageText.includes("There are no results for") ||
    pageText.includes("No results found for") ||
    pageText.includes("There are no results for this question") ||
    $(".b_no").length > 0
  ) {
    throw new SearchEngineError("Bing", "no-results", "No Results");
  }

  if (
    pageText.includes("One last step") ||
    pageText.includes("Enter the characters you see below") ||
    pageText.includes("Please solve this puzzle") ||
    pageText.includes("verify you are a human")
  ) {
    throw new SearchEngineError("Bing", "blocked", "Bing blocked the request");
  }

  const results = collectResults($, "li.b_algo", ($result) => ({
    snippet: $result(".b_caption p, .b_snippet").first().text().trim(),
    title: $result("h2 a").first().text().trim(),
    url: normalizeBingUrl($result("h2 a").first().attr("href")?.trim() ?? ""),
  }));

  return ensureResults(results, $, "Bing");
}

function collectResults(
  $: ReturnType<typeof load>,
  selector: string,
  getResult: (result: ReturnType<typeof load>) => ParsedResult
): ParsedResult[] {
  const results: ParsedResult[] = [];

  $(selector).each((_, element) => {
    const resultHtml = $.html(element);
    if (!resultHtml) {
      return;
    }

    const $result = load(resultHtml);
    const result = getResult($result);

    const normalizedResult = normalizeResult(result);

    if (normalizedResult) {
      results.push(normalizedResult);
    }
  });

  return dedupeResults(results);
}

function ensureResults(
  selectorResults: ParsedResult[],
  $: ReturnType<typeof load>,
  engine: SearchEngineName
): ParsedResult[] {
  if (selectorResults.length > 0) {
    return selectorResults;
  }

  const heuristicResults = extractHeuristicResults($, engine);

  if (heuristicResults.length > 0) {
    return heuristicResults;
  }

  throw new SearchEngineError(engine, "no-results", "No Results");
}

function normalizeGoogleUrl(url: string): string {
  if (url.startsWith("/url?")) {
    const parsed = new URL(url, "https://www.google.com");
    return parsed.searchParams.get("q")?.trim() ?? "";
  }

  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url.trim();
  }

  return "";
}

function normalizeEngineUrl(engine: SearchEngineName, url: string): string {
  const trimmedUrl = url.trim();

  if (!trimmedUrl || trimmedUrl.startsWith("#")) {
    return "";
  }

  if (
    trimmedUrl.startsWith("javascript:") ||
    trimmedUrl.startsWith("mailto:") ||
    trimmedUrl.startsWith("tel:")
  ) {
    return "";
  }

  if (engine === "Google") {
    return normalizeGoogleUrl(trimmedUrl);
  }

  if (engine === "Bing") {
    return normalizeBingUrl(trimmedUrl);
  }

  if (trimmedUrl.startsWith("http://") || trimmedUrl.startsWith("https://")) {
    return trimmedUrl;
  }

  return "";
}

function normalizeBingUrl(url: string): string {
  if (!(url.startsWith("http://") || url.startsWith("https://"))) {
    return "";
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(url);
  } catch {
    return "";
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const pathname = parsedUrl.pathname.toLowerCase();
  const isBingWrapperHost =
    hostname === "www.bing.com" || hostname === "bing.com";

  if (!(isBingWrapperHost && pathname.startsWith("/ck/a"))) {
    return url.trim();
  }

  const wrappedTarget = parsedUrl.searchParams.get("u")?.trim() ?? "";
  if (!wrappedTarget) {
    return url.trim();
  }

  const decodedTarget = decodeBingWrappedUrl(wrappedTarget);
  return decodedTarget || url.trim();
}

function decodeBingWrappedUrl(encodedTarget: string): string {
  if (
    encodedTarget.startsWith("http://") ||
    encodedTarget.startsWith("https://")
  ) {
    return encodedTarget;
  }

  const decodedTarget = tryDecodeBingBase64Target(encodedTarget);
  if (!decodedTarget) {
    return "";
  }

  try {
    return new URL(decodedTarget).toString();
  } catch {
    return "";
  }
}

function tryDecodeBingBase64Target(encodedTarget: string): string {
  const normalizedTarget = encodedTarget.startsWith("a1")
    ? encodedTarget.slice(2)
    : encodedTarget;

  if (!normalizedTarget) {
    return "";
  }

  const base64 = normalizedTarget.replace(/-/g, "+").replace(/_/g, "/");
  const paddedBase64 = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");

  try {
    return Buffer.from(paddedBase64, "base64").toString("utf8").trim();
  } catch {
    return "";
  }
}

function extractHeuristicResults(
  $: ReturnType<typeof load>,
  engine: SearchEngineName
): ParsedResult[] {
  const results: ParsedResult[] = [];

  $("a[href]").each((_, element) => {
    const anchor = $(element);
    const normalizedUrl = normalizeEngineUrl(engine, anchor.attr("href") ?? "");

    if (!normalizedUrl || isIgnoredSearchEngineUrl(normalizedUrl, engine)) {
      return;
    }

    const title = cleanText(
      anchor.find("h1, h2, h3, h4").first().text() || anchor.text()
    );
    if (!title) {
      return;
    }

    const snippet = extractHeuristicSnippet(anchor, title);
    const normalizedResult = normalizeResult({
      snippet,
      title,
      url: normalizedUrl,
    });

    if (normalizedResult) {
      results.push(normalizedResult);
    }
  });

  return dedupeResults(results);
}

function extractHeuristicSnippet(
  anchor: CheerioSelection,
  title: string
): string {
  const candidateTexts = [
    anchor.parent().text(),
    anchor.siblings("p, div, span").text(),
    anchor.closest("article, li, div, section").text(),
    anchor.parent().parent().text(),
  ];

  for (const candidateText of candidateTexts) {
    const snippet = toSnippet(candidateText, title);
    if (snippet) {
      return snippet;
    }
  }

  const fallbackText = cleanText(anchor.text());
  return toSnippet(fallbackText, title);
}

function toSnippet(text: string, title: string): string {
  const cleanedText = removeLeadingTitle(cleanText(text), title);
  if (!cleanedText) {
    return "";
  }

  return truncateText(cleanedText, MAX_HEURISTIC_SNIPPET_LENGTH);
}

function normalizeResult(result: ParsedResult): ParsedResult | null {
  const title = cleanText(result.title);
  if (!title) {
    return null;
  }

  const url = result.url.trim();
  if (!url) {
    return null;
  }

  const snippet = truncateText(
    cleanText(result.snippet),
    MAX_HEURISTIC_SNIPPET_LENGTH
  );

  if (!snippet) {
    return null;
  }

  return { snippet, title, url };
}

function dedupeResults(results: ParsedResult[]): ParsedResult[] {
  const seenUrls = new Set<string>();

  return results.filter((result) => {
    if (seenUrls.has(result.url)) {
      return false;
    }

    seenUrls.add(result.url);
    return true;
  });
}

function isIgnoredSearchEngineUrl(
  url: string,
  engine: SearchEngineName
): boolean {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(url);
  } catch {
    return true;
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const pathname = parsedUrl.pathname.toLowerCase();
  const searchParams = parsedUrl.searchParams;

  if (SEARCH_ENGINE_HOSTS[engine].includes(hostname)) {
    return true;
  }

  const isEngineOwnedInternalHost = SEARCH_ENGINE_INTERNAL_HOST_PATTERNS[
    engine
  ].some((pattern) => pattern.test(hostname));

  if (
    SEARCH_ENGINE_INTERNAL_ONLY_HOST_PATTERNS[engine].some((pattern) =>
      pattern.test(hostname)
    )
  ) {
    return true;
  }

  if (isEngineOwnedInternalHost) {
    if (
      INTERNAL_PATH_SEGMENT_PATTERNS.some((pattern) => pattern.test(pathname))
    ) {
      return true;
    }

    if (
      [...searchParams.keys()].some((key) =>
        INTERNAL_QUERY_PARAMETER_KEYS.has(key)
      )
    ) {
      return true;
    }
  }

  if (
    pathname === "/search" ||
    pathname.startsWith("/preferences") ||
    pathname.startsWith("/settings") ||
    pathname.startsWith("/account")
  ) {
    return true;
  }

  return false;
}

function removeLeadingTitle(text: string, title: string): string {
  const escapedTitle = escapeRegExp(title);
  const separatorPattern = "(?:\\s+|\\s*[-:|·–—]\\s*)?";
  const titlePrefixPattern = new RegExp(`^${escapedTitle}${separatorPattern}`);

  let nextText = text;

  while (titlePrefixPattern.test(nextText)) {
    nextText = nextText.replace(titlePrefixPattern, "").trim();
  }

  return nextText;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  const truncatedText = text.slice(0, maxLength).trimEnd();
  const lastSpaceIndex = truncatedText.lastIndexOf(" ");

  if (lastSpaceIndex <= maxLength / 2) {
    return `${truncatedText}…`;
  }

  return `${truncatedText.slice(0, lastSpaceIndex)}…`;
}

function classifyStatusFailure(status: number): EngineFailureKind {
  if (status === 403 || status === 429) {
    return "blocked";
  }

  return "transient";
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function formatFailureSummary(failures: SearchEngineError[]): string {
  if (failures.length === 0) {
    return "";
  }

  const details = failures
    .map((failure) => `${failure.engine}:${failure.kind}`)
    .join("; ");

  return ` [${details}]`;
}

const SEARCH_CACHE_TTL_MS = 3 * 60 * 1000;

const searchCache = new TtlCache<string, SearchResult[]>(SEARCH_CACHE_TTL_MS);

const NON_RETRYABLE_SEARCH_ERRORS = [
  "No Results",
  "All search engines failed",
  "Search failed across all engines",
] as const;

function shouldRetrySearchError(error: Error): boolean {
  const retryable = getSearchExecutionRetryable(error);
  if (retryable !== undefined) {
    return retryable;
  }

  return !NON_RETRYABLE_SEARCH_ERRORS.some((message) =>
    error.message.includes(message)
  );
}

function getSearchExecutionRetryable(error: Error): boolean | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  if (!("retryable" in error)) {
    return undefined;
  }

  const retryable = Reflect.get(error, "retryable");

  return typeof retryable === "boolean" ? retryable : undefined;
}

export async function searchWithRetryAndCache(
  query: string,
  maxResults: number
): Promise<SearchResult[]> {
  if (searchCache.has(query)) {
    return (searchCache.get(query) ?? []).slice(0, maxResults);
  }

  const results = await pRetry(
    async () => (await searchDetailed(query)).results,
    {
      retries: 2,
      minTimeout: 2000,
      factor: 2,
      shouldRetry: ({ error }) => shouldRetrySearchError(error),
    }
  );

  searchCache.set(query, results);
  return results.slice(0, maxResults);
}
