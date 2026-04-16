---
"opensearch-mcp": patch
---

Improve `web_search` resilience with multi-engine fallback hardening.

- add selector-less heuristic extraction when engine-specific selectors fail
- filter internal support/help links from search-engine owned domains
- normalize Bing wrapper URLs to final target URLs
- strengthen blocked/no-results detection across fallback engines
- improve search failure summaries for easier diagnostics
