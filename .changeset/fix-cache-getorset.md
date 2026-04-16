---
"opensearch-mcp": patch
---

Fix `TtlCache#getOrSet` so concurrent cache misses share the same in-flight promise instead of running duplicate work.
