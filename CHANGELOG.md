# opensearch-mcp

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
