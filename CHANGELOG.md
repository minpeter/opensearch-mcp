# opensearch-mcp

## 0.1.3

### Patch Changes

- 051672a: Clean up duplicated `web_fetch`/`web_search` plumbing, tighten related fetch regression coverage, and add the bounded cleanup plan document for this refactor pass.
- 71f7092: Add official Exa hosted MCP fallback support, prefer Exa's free hosted tier before key-backed Exa APIs, and improve `web_fetch`/`web_search` ergonomics with batch fetch input, more Exa-style text-first responses, and stronger regression coverage.
- 0924083: Harden `web_search` fallback handling with Brave and Exa API providers, opt-in Google scraping, clearer auth failure behavior, and stronger fallback regression coverage.

## 0.1.2

### Patch Changes

- 3b88d93: Add `engine` field to each `web_search` result indicating which search engine produced it (`"DuckDuckGo"`, `"Google"`, or `"Bing"`).
- 5499178: Fix `TtlCache#getOrSet` so concurrent cache misses share the same in-flight promise instead of running duplicate work.
- eb99534: Refactor MCP tool response shaping: `web_search` `content` now returns a human-readable text rendering instead of raw JSON, and `web_fetch` no longer duplicates the full markdown body in `structuredContent`. Adds `createSearchToolResult` and `createFetchToolResult` helpers with unit tests.

## 0.1.1

### Patch Changes

- f7a0843: Improve `web_search` resilience with multi-engine fallback hardening.

  - add selector-less heuristic extraction when engine-specific selectors fail
  - filter internal support/help links from search-engine owned domains
  - normalize Bing wrapper URLs to final target URLs
  - strengthen blocked/no-results detection across fallback engines
  - improve search failure summaries for easier diagnostics
