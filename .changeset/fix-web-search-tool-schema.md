---
"opensearch-mcp": patch
---

Preserve the `web_search` tool input schema in bundled releases so MCP clients receive the expected `query`, `numResults`, and `max_results` fields from `tools/list`.
