---
"opensearch-mcp": patch
---

Refactor MCP tool response shaping: `web_search` `content` now returns a human-readable text rendering instead of raw JSON, and `web_fetch` no longer duplicates the full markdown body in `structuredContent`. Adds `createSearchToolResult` and `createFetchToolResult` helpers with unit tests.
