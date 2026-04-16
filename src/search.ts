import { type CheerioAPI, load } from "cheerio";
import pRetry from "p-retry";
import { z } from "zod";

import { TtlCache } from "./cache.ts";
import { searchExaMcp } from "./exa-mcp.ts";
import { getRandomUserAgent } from "./user-agents.ts";

export const SEARCH_ENGINE_NAMES = [
  "Bing",
  "Brave",
  "DuckDuckGo",
  "Exa",
  "Google",
] as const;

type SearchEngineName = (typeof SEARCH_ENGINE_NAMES)[number];

export const searchResultSchema = z.object({
  engine: z.enum(SEARCH_ENGINE_NAMES),
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
});

export const searchResultsSchema = z.array(searchResultSchema);

type SearchResult = z.infer<typeof searchResultSchema>;

type ParsedResult = Omit<SearchResult, "engine">;

type EngineFailureKind =
  | "blocked"
  | "misconfigured"
  | "no-results"
  | "transient";

interface HeuristicAnchor {
  closest(selector?: string): { text(): string };
  parent(): { text(): string; parent(): { text(): string } };
  siblings(selector?: string): { text(): string };
  text(): string;
}

interface SearchProvider {
  name: SearchEngineName;
  search(query: string): Promise<SearchResult[]>;
}

interface ScrapeSearchEngine {
  getRequestInit(query: string): {
    init: RequestInit;
    url: string;
  };
  name: SearchEngineName;
  parse(html: string): ParsedResult[];
}

interface SearchParserConfig {
  blockedMessage: string;
  detectBlocked?: ($: CheerioAPI, pageText: string) => boolean;
  detectNoResults?: ($: CheerioAPI, pageText: string) => boolean;
  engine: SearchEngineName;
  extractResults: ($: CheerioAPI) => ParsedResult[];
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
const EXA_HIGHLIGHT_MAX_CHARACTERS = MAX_HEURISTIC_SNIPPET_LENGTH;
const HTTP_PROTOCOL_PREFIXES: readonly ["http://", "https://"] = [
  "http://",
  "https://",
];
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
  Brave: ["brave.com", "search.brave.com", "api.search.brave.com"],
  DuckDuckGo: ["duckduckgo.com", "html.duckduckgo.com", "www.duckduckgo.com"],
  Exa: ["exa.ai", "api.exa.ai"],
  Google: ["google.com", "www.google.com"],
};

const SEARCH_ENGINE_INTERNAL_URL_RULES: Record<
  SearchEngineName,
  {
    alwaysIgnoreHostPatterns: RegExp[];
    ownedHostPatterns: RegExp[];
  }
> = {
  Bing: {
    alwaysIgnoreHostPatterns: [/\bhelp\.bing\.microsoft\.com$/u],
    ownedHostPatterns: [/\bbing\.com$/u, /\bmicrosoft\.com$/u],
  },
  Brave: {
    alwaysIgnoreHostPatterns: [],
    ownedHostPatterns: [/\bbrave\.com$/u],
  },
  DuckDuckGo: {
    alwaysIgnoreHostPatterns: [],
    ownedHostPatterns: [/\bduckduckgo\.com$/u],
  },
  Exa: {
    alwaysIgnoreHostPatterns: [],
    ownedHostPatterns: [/\bexa\.ai$/u],
  },
  Google: {
    alwaysIgnoreHostPatterns: [
      /\bsupport\.google\.com$/u,
      /\baccounts\.google\.com$/u,
      /\bmyaccount\.google\.com$/u,
      /\bpolicies\.google\.com$/u,
    ],
    ownedHostPatterns: [
      /\bgoogle\.com$/u,
      /\bsupport\.google\.com$/u,
      /\baccounts\.google\.com$/u,
      /\bmyaccount\.google\.com$/u,
      /\bpolicies\.google\.com$/u,
    ],
  },
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

const SCRAPE_SEARCH_ENGINES: Record<
  "Bing" | "DuckDuckGo" | "Google",
  ScrapeSearchEngine
> = {
  DuckDuckGo: {
    name: "DuckDuckGo",
    getRequestInit(query: string) {
      const formData = new FormData();
      formData.append("q", query);

      return {
        url: "https://html.duckduckgo.com/html/",
        init: createSearchRequestInit("POST", formData),
      };
    },
    parse: parseDuckDuckGoResults,
  },
  Google: {
    name: "Google",
    getRequestInit(query: string) {
      return {
        url: createSearchUrl("https://www.google.com/search", {
          q: query,
          hl: "en",
        }),
        init: createSearchRequestInit("GET"),
      };
    },
    parse: parseGoogleResults,
  },
  Bing: {
    name: "Bing",
    getRequestInit(query: string) {
      return {
        url: createSearchUrl("https://www.bing.com/search", {
          q: query,
          setlang: "en-US",
        }),
        init: createSearchRequestInit("GET"),
      };
    },
    parse: parseBingResults,
  },
};

const GOOGLE_SCRAPE_OPT_IN_ENV = "OPENSEARCH_ENABLE_GOOGLE_SCRAPE";
const EXA_MCP_OPT_OUT_ENV = "OPENSEARCH_ENABLE_EXA_MCP";
const BRAVE_API_KEY_ENV = "BRAVE_SEARCH_API_KEY";
const EXA_API_KEY_ENV = "EXA_API_KEY";

function isGoogleScrapeEnabled(): boolean {
  return process.env[GOOGLE_SCRAPE_OPT_IN_ENV] === "true";
}

function isExaMcpEnabled(): boolean {
  return process.env[EXA_MCP_OPT_OUT_ENV] !== "false";
}

function getSearchProviders(): SearchProvider[] {
  const providers: SearchProvider[] = [];
  const braveApiKey = process.env[BRAVE_API_KEY_ENV]?.trim();
  const exaApiKey = process.env[EXA_API_KEY_ENV]?.trim();

  if (braveApiKey) {
    providers.push(createBraveSearchProvider(braveApiKey));
  }

  if (exaApiKey) {
    providers.push(createExaSearchProvider(exaApiKey));
  } else if (isExaMcpEnabled()) {
    providers.push(createExaMcpSearchProvider());
  }

  providers.push(createScrapeSearchProvider(SCRAPE_SEARCH_ENGINES.DuckDuckGo));
  providers.push(createScrapeSearchProvider(SCRAPE_SEARCH_ENGINES.Bing));

  if (isGoogleScrapeEnabled()) {
    providers.push(createScrapeSearchProvider(SCRAPE_SEARCH_ENGINES.Google));
  }

  return providers;
}

function createExaMcpSearchProvider(): SearchProvider {
  return {
    name: "Exa",
    async search(query: string): Promise<SearchResult[]> {
      try {
        const results = await searchExaMcp(query, 10);

        if (results.length === 0) {
          throw new SearchEngineError("Exa", "no-results", "No Results");
        }

        return attachEngine("Exa", results);
      } catch (error) {
        if (error instanceof SearchEngineError) {
          throw error;
        }

        throw new SearchEngineError(
          "Exa",
          classifyExaMcpFailure(error),
          `Exa MCP search failed: ${getErrorMessage(error)}`
        );
      }
    },
  };
}

function createScrapeSearchProvider(
  engine: ScrapeSearchEngine
): SearchProvider {
  return {
    name: engine.name,
    search(query: string): Promise<SearchResult[]> {
      return searchWithScrapeEngine(engine, query);
    },
  };
}

function createBraveSearchProvider(apiKey: string): SearchProvider {
  return {
    name: "Brave",
    async search(query: string): Promise<SearchResult[]> {
      const response = await fetchSearchApi({
        engine: "Brave",
        init: {
          headers: {
            Accept: "application/json",
            "Accept-Encoding": "gzip",
            "User-Agent": getRandomUserAgent(),
            "X-Subscription-Token": apiKey,
          },
          method: "GET",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
        url: createSearchUrl("https://api.search.brave.com/res/v1/web/search", {
          count: "10",
          q: query,
          search_lang: "en",
        }),
      });

      return attachEngine("Brave", parseBraveResults(response));
    },
  };
}

function createExaSearchProvider(apiKey: string): SearchProvider {
  return {
    name: "Exa",
    async search(query: string): Promise<SearchResult[]> {
      const response = await fetchSearchApi({
        engine: "Exa",
        init: {
          body: JSON.stringify({
            contents: {
              highlights: {
                maxCharacters: EXA_HIGHLIGHT_MAX_CHARACTERS,
              },
            },
            numResults: 10,
            query,
            type: "auto",
          }),
          headers: {
            "Content-Type": "application/json",
            "User-Agent": getRandomUserAgent(),
            "x-api-key": apiKey,
          },
          method: "POST",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
        url: "https://api.exa.ai/search",
      });

      return attachEngine("Exa", parseExaResults(response));
    },
  };
}

export async function search(query: string): Promise<SearchResult[]> {
  const failures: SearchEngineError[] = [];
  const providers = getSearchProviders();

  for (const engine of providers) {
    try {
      return await engine.search(query);
    } catch (error) {
      if (error instanceof SearchEngineError) {
        failures.push(error);
        continue;
      }

      throw error;
    }
  }

  if (failures.every((failure) => failure.kind === "no-results")) {
    throw new SearchExecutionError("No Results", false);
  }

  const failedEngines = failures.map((failure) => failure.engine).join(", ");
  const failureSummary = formatFailureSummary(failures);

  if (failures.every((failure) => failure.kind === "blocked")) {
    throw new SearchExecutionError(
      `All search engines failed: ${failedEngines}${failureSummary}`,
      false
    );
  }

  if (failures.every((failure) => failure.kind !== "no-results")) {
    throw new SearchExecutionError(
      `Search failed across all engines: ${failedEngines}${failureSummary}`,
      failures.every((failure) => failure.kind === "transient")
    );
  }

  throw new SearchExecutionError(
    `All search engines failed: ${failedEngines}${failureSummary}`,
    false
  );
}

async function searchWithScrapeEngine(
  engine: ScrapeSearchEngine,
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
  return attachEngine(engine.name, engine.parse(html));
}

async function fetchSearchApi({
  engine,
  init,
  url,
}: {
  engine: SearchEngineName;
  init: RequestInit;
  url: string;
}): Promise<string> {
  let response: Response;

  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new SearchEngineError(
      engine,
      "transient",
      `${engine} fetch failed: ${getErrorMessage(error)}`
    );
  }

  if (!response.ok) {
    throw new SearchEngineError(
      engine,
      classifyApiStatusFailure(engine, response.status),
      `${engine} fetch failed with status ${response.status}`
    );
  }

  return response.text();
}

function parseDuckDuckGoResults(html: string): ParsedResult[] {
  return parseEngineResults(html, {
    blockedMessage: "Too many requests (Bot detected)",
    detectBlocked: ($) => $(".challenge-form, #challenge-form").length > 0,
    detectNoResults: ($) => $(".no-results").length > 0,
    engine: "DuckDuckGo",
    extractResults: ($) =>
      collectResults(
        $,
        ".zci, #links > .result, .result.results_links, .result.results_links_deep",
        ($result) => {
          const anchor = $result(
            ".zci__heading > a, .result__title .result__a, .result__a"
          ).first();

          return {
            snippet: $result(".zci__result, .result__snippet")
              .first()
              .text()
              .trim(),
            title: anchor.text().trim(),
            url: anchor.attr("href")?.trim() ?? "",
          };
        }
      ),
  });
}

function parseGoogleResults(html: string): ParsedResult[] {
  return parseEngineResults(html, {
    blockedMessage: "Google blocked the request",
    detectBlocked: ($, pageText) =>
      pageText.includes("Our systems have detected unusual traffic") ||
      pageText.includes("To continue, please type the characters below") ||
      $("#captcha-form, form#challenge-form, #recaptcha").length > 0,
    detectNoResults: (_, pageText) =>
      pageText.includes("did not match any documents") ||
      pageText.includes("did not match any results") ||
      pageText.includes("No results found for"),
    engine: "Google",
    extractResults: ($) =>
      collectResults($, "div.g, div[data-snc]", ($result) => {
        const anchor = $result("a[href]").has("h3").first();

        return {
          snippet: $result(".VwiC3b, .yXK7lf, .MUxGbd, .s3v9rd")
            .first()
            .text()
            .trim(),
          title: anchor.find("h3").first().text().trim(),
          url: normalizeGoogleUrl(anchor.attr("href") ?? ""),
        };
      }),
  });
}

function parseBingResults(html: string): ParsedResult[] {
  return parseEngineResults(html, {
    blockedMessage: "Bing blocked the request",
    detectBlocked: (_, pageText) =>
      pageText.includes("One last step") ||
      pageText.includes("Enter the characters you see below") ||
      pageText.includes("Please solve this puzzle") ||
      pageText.includes("verify you are a human"),
    detectNoResults: ($, pageText) =>
      pageText.includes("There are no results for") ||
      pageText.includes("No results found for") ||
      pageText.includes("There are no results for this question") ||
      $(".b_no").length > 0,
    engine: "Bing",
    extractResults: ($) =>
      collectResults($, "li.b_algo", ($result) => {
        const anchor = $result("h2 a").first();

        return {
          snippet: $result(".b_caption p, .b_snippet").first().text().trim(),
          title: anchor.text().trim(),
          url: normalizeBingUrl(anchor.attr("href")?.trim() ?? ""),
        };
      }),
  });
}

function parseBraveResults(responseBody: string): ParsedResult[] {
  const parsed = parseJsonResponse(responseBody, "Brave");
  const webResults = getRecordValue(parsed, "web");
  if (webResults === null) {
    throw new SearchEngineError(
      "Brave",
      "transient",
      "Brave returned an unexpected response shape"
    );
  }

  const rawResults = getArrayValue(webResults, "results");
  const results = rawResults
    .map((item) =>
      normalizeResult({
        snippet:
          getStringValue(item, "description") ??
          getStringValue(item, "snippet") ??
          "",
        title: getStringValue(item, "title") ?? "",
        url: getStringValue(item, "url") ?? "",
      })
    )
    .filter((result): result is ParsedResult => result !== null);

  if (results.length === 0) {
    throw new SearchEngineError("Brave", "no-results", "No Results");
  }

  return dedupeResults(results);
}

function parseExaResults(responseBody: string): ParsedResult[] {
  const parsed = parseJsonResponse(responseBody, "Exa");
  if (!Object.hasOwn(parsed, "results")) {
    throw new SearchEngineError(
      "Exa",
      "transient",
      "Exa returned an unexpected response shape"
    );
  }

  const rawResults = getArrayValue(parsed, "results");
  const results = rawResults
    .map((item) => {
      const highlights = getArrayValue(
        typeof item === "object" && item !== null && !Array.isArray(item)
          ? (item as Record<string, unknown>)
          : null,
        "highlights"
      )
        .map((highlight) =>
          typeof highlight === "string" ? highlight.trim() : ""
        )
        .filter(Boolean);
      const snippet =
        highlights[0] ??
        getStringValue(item, "text") ??
        getStringValue(item, "snippet") ??
        "";

      return normalizeResult({
        snippet,
        title: getStringValue(item, "title") ?? "",
        url: getStringValue(item, "url") ?? "",
      });
    })
    .filter((result): result is ParsedResult => result !== null);

  if (results.length === 0) {
    throw new SearchEngineError("Exa", "no-results", "No Results");
  }

  return dedupeResults(results);
}

function parseJsonResponse(
  responseBody: string,
  engine: SearchEngineName
): Record<string, unknown> {
  try {
    const parsed = JSON.parse(responseBody) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Expected an object response");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new SearchEngineError(
      engine,
      "transient",
      `${engine} returned invalid JSON: ${getErrorMessage(error)}`
    );
  }
}

function getArrayValue(
  value: Record<string, unknown> | null,
  key: string
): unknown[] {
  const candidate = value?.[key];
  return Array.isArray(candidate) ? candidate : [];
}

function getRecordValue(
  value: Record<string, unknown> | null,
  key: string
): Record<string, unknown> | null {
  const candidate = value?.[key];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }

  return candidate as Record<string, unknown>;
}

function getStringValue(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" ? candidate.trim() : null;
}

function parseEngineResults(
  html: string,
  {
    blockedMessage,
    detectBlocked,
    detectNoResults,
    engine,
    extractResults,
  }: SearchParserConfig
): ParsedResult[] {
  const $ = load(html);
  const pageText = $.text();

  if (detectNoResults?.($, pageText)) {
    throw new SearchEngineError(engine, "no-results", "No Results");
  }

  if (detectBlocked?.($, pageText)) {
    throw new SearchEngineError(engine, "blocked", blockedMessage);
  }

  return ensureResults(extractResults($), $, engine);
}

function collectResults(
  $: CheerioAPI,
  selector: string,
  getResult: (result: CheerioAPI) => ParsedResult
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
  $: CheerioAPI,
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

  if (hasHttpProtocol(url)) {
    return url.trim();
  }

  return "";
}

function normalizeHeuristicUrl(engine: SearchEngineName, url: string): string {
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

  switch (engine) {
    case "Google": {
      return normalizeGoogleUrl(trimmedUrl);
    }
    case "Bing": {
      return normalizeBingUrl(trimmedUrl);
    }
    case "DuckDuckGo": {
      return hasHttpProtocol(trimmedUrl) ? trimmedUrl : "";
    }
    default: {
      return "";
    }
  }
}

function normalizeBingUrl(url: string): string {
  if (!hasHttpProtocol(url)) {
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
  if (hasHttpProtocol(encodedTarget)) {
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

  return Buffer.from(paddedBase64, "base64").toString("utf8").trim();
}

function extractHeuristicResults(
  $: CheerioAPI,
  engine: SearchEngineName
): ParsedResult[] {
  const results: ParsedResult[] = [];

  $("a[href]").each((_, element) => {
    const anchor = $(element);
    const normalizedUrl = normalizeHeuristicUrl(
      engine,
      anchor.attr("href") ?? ""
    );

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
  anchor: HeuristicAnchor,
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

function attachEngine(
  engine: SearchEngineName,
  results: ParsedResult[]
): SearchResult[] {
  return results.map((result) => ({ ...result, engine }));
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
  const internalUrlRules = SEARCH_ENGINE_INTERNAL_URL_RULES[engine];

  if (SEARCH_ENGINE_HOSTS[engine].includes(hostname)) {
    return true;
  }

  if (
    internalUrlRules.alwaysIgnoreHostPatterns.some((pattern) =>
      pattern.test(hostname)
    )
  ) {
    return true;
  }

  const isEngineOwnedInternalHost = internalUrlRules.ownedHostPatterns.some(
    (pattern) => pattern.test(hostname)
  );

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

function classifyApiStatusFailure(
  engine: SearchEngineName,
  status: number
): EngineFailureKind {
  if (
    (engine === "Brave" && status === 401) ||
    (engine === "Exa" && (status === 401 || status === 402))
  ) {
    return "misconfigured";
  }

  return classifyStatusFailure(status);
}

function classifyExaMcpFailure(error: unknown): EngineFailureKind {
  const message = getErrorMessage(error).toLowerCase();

  if (
    message.includes("payment required") ||
    message.includes("invalid api key") ||
    message.includes("unauthorized")
  ) {
    return "misconfigured";
  }

  if (message.includes("429") || message.includes("rate limit")) {
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

function createSearchRequestInit(
  method: "GET" | "POST",
  body?: BodyInit
): RequestInit {
  return {
    method,
    headers: {
      ...BROWSER_HEADERS,
      "User-Agent": getRandomUserAgent(),
    },
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };
}

function createSearchUrl(
  baseUrl: string,
  params: Record<string, string>
): string {
  const url = new URL(baseUrl);
  url.search = "";

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return url.toString();
}

function hasHttpProtocol(url: string): boolean {
  return HTTP_PROTOCOL_PREFIXES.some((prefix) => url.startsWith(prefix));
}

const SEARCH_CACHE_TTL_MS = 3 * 60 * 1000;

const searchCache = new TtlCache<string, SearchResult[]>(SEARCH_CACHE_TTL_MS);

function shouldRetrySearchError(error: Error): boolean {
  if (error instanceof SearchExecutionError) {
    return error.retryable;
  }

  return true;
}

export async function searchWithRetryAndCache(
  query: string,
  maxResults: number
): Promise<SearchResult[]> {
  const results = await searchCache.getOrSet(query, async () =>
    pRetry(async () => search(query), {
      retries: 2,
      minTimeout: 2000,
      factor: 2,
      shouldRetry: ({ error }) => shouldRetrySearchError(error),
    })
  );

  return results.slice(0, maxResults);
}
