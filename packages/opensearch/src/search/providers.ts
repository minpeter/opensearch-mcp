import { createAugmentedBingProvider } from "./providers-augmented-bing.ts";
import {
  createBraveSearchProvider,
  createTinyFishSearchProvider,
} from "./providers-core.ts";
import {
  createExaMcpSearchProvider,
  createExaSearchProvider,
} from "./providers-exa.ts";
import { createIndependentProviders } from "./providers-independent.ts";
import { createLlmNativeProviders } from "./providers-llm.ts";
import { createParallelMcpSearchProvider } from "./providers-parallel-mcp.ts";
import { createSerpProviders } from "./providers-serp.ts";
import { createZeroKeyProviders } from "./providers-zero-key.ts";
import { createScrapeSearchProvider, SCRAPE_SEARCH_ENGINES } from "./scrape.ts";
import type { SearchProvider } from "./types.ts";

const EXA_MCP_OPT_OUT_ENV = "OPENSEARCH_ENABLE_EXA_MCP";
const PARALLEL_MCP_OPT_OUT_ENV = "OPENSEARCH_ENABLE_PARALLEL_MCP";
const ZERO_KEY_OPT_OUT_ENV = "OPENSEARCH_ENABLE_ZERO_KEY_PROVIDERS";

function isExaMcpEnabled(): boolean {
  return process.env[EXA_MCP_OPT_OUT_ENV] !== "false";
}

function isParallelMcpEnabled(): boolean {
  return process.env[PARALLEL_MCP_OPT_OUT_ENV] !== "false";
}

function isZeroKeyProvidersEnabled(): boolean {
  return process.env[ZERO_KEY_OPT_OUT_ENV] !== "false";
}

export function getSearchProviders(): SearchProvider[] {
  const providers: SearchProvider[] = [];

  pushProvider(providers, createTinyFishSearchProvider());
  providers.push(...createLlmNativeProviders());
  providers.push(...createSerpProviders());

  pushProvider(providers, createBraveSearchProvider());

  if (isParallelMcpEnabled()) {
    providers.push(createParallelMcpSearchProvider());
  }

  if (isExaMcpEnabled()) {
    providers.push(createExaMcpSearchProvider());
  }

  pushProvider(providers, createExaSearchProvider());
  providers.push(...createIndependentProviders());

  if (isZeroKeyProvidersEnabled()) {
    providers.push(...createZeroKeyProviders());
  }

  providers.push(createScrapeSearchProvider(SCRAPE_SEARCH_ENGINES.DuckDuckGo));
  providers.push(
    isZeroKeyProvidersEnabled()
      ? createAugmentedBingProvider()
      : createScrapeSearchProvider(SCRAPE_SEARCH_ENGINES.Bing)
  );

  return providers;
}

function pushProvider(
  providers: SearchProvider[],
  provider: SearchProvider | null
): void {
  if (provider) {
    providers.push(provider);
  }
}
