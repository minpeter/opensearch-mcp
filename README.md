# opensearch-mcp

MCP server with `web_search` and `web_fetch` tools.

## Tools

- **`web_search`** — Multi-engine web search. Uses Brave → Exa API → Exa MCP hosted search → DuckDuckGo → Bing when corresponding paths are available, with Google scraping available as an opt-in last resort. `content` returns a compact text rendering of the full result set, and `structuredContent.results` returns the same results in machine-readable form.
- **`web_fetch`** — Fetches one or more URLs and converts them to markdown. It accepts legacy `url` plus batch `urls`. Single fetches keep the extracted body in `content`; batch fetches return multiple text blocks with per-URL metadata and extracted content. `structuredContent.results` always returns machine-readable fetch results, with top-level metadata preserved for single-fetch compatibility. It tries Exa's hosted MCP fetch path first, then falls back to the local HTML/PDF pipeline and finally [Jina AI](https://jina.ai) for sparse content.

## Usage

```json
{
  "mcpServers": {
    "opensearch": {
      "command": "npx",
      "args": ["-y", "opensearch-mcp"]
    }
  }
}
```

Or with a specific version:

```json
{
  "mcpServers": {
    "opensearch": {
      "command": "npx",
      "args": ["-y", "opensearch-mcp@latest"]
    }
  }
}
```

## Tool Reference

### `web_search`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | — | Search query |
| `max_results` | number | 5 | Max results to return (1–15) |

Returns an array of `{ engine, title, url, snippet }` where `engine` is one of `"Brave"`, `"Exa"`, `"DuckDuckGo"`, `"Bing"`, or `"Google"`.

| Provider | Path used by this server | Credential needed here? | Notes |
|---|---|---:|---|
| Brave | Brave Search API | Yes | Requires `BRAVE_SEARCH_API_KEY`. |
| Exa | Exa Search API | Yes | Used when `EXA_API_KEY` is set. |
| Exa | Exa hosted MCP (`https://mcp.exa.ai/mcp`) | No (free hosted plan) | Used automatically when `EXA_API_KEY` is absent unless `OPENSEARCH_ENABLE_EXA_MCP=false`. |
| DuckDuckGo | HTML scraping | No | Public HTML endpoint; can still hit anti-bot challenges. |
| Bing | HTML scraping | No | Public search page scraping with wrapper URL normalization. |
| Google | HTML scraping (opt-in) | No | Disabled by default and used only as a last resort because it is challenge-prone. |

This project intentionally aggregates only official API paths, official hosted MCP paths, or public web pages. It does not rely on reverse-engineered private endpoints or credential bypasses.

As of April 16, 2026, Exa is the only official provider path we found that supports the exact "free first, add your own key later" flow used here. The comparison that led to the current fallback policy is:

| Official provider path reviewed | Free without auth to start? | What the provider still requires | Why it is not the same flow as Exa hosted MCP |
|---|---:|---|---|
| Exa hosted MCP (`https://mcp.exa.ai/mcp`) | Yes | Nothing for the hosted free plan; `EXA_API_KEY` is optional for higher official limits | Matches this server's no-key-first, add-key-later behavior |
| Brave Search API | No | Signup plus `BRAVE_SEARCH_API_KEY`, even though Brave includes free monthly credits | Free credits exist, but authenticated setup is still required before first use |
| Tavily MCP / API | No | Tavily OAuth or Tavily API key, even on the free plan | Official free credits exist, but the provider still authenticates every MCP/API path |
| Google Custom Search JSON API | No | Google API key plus Programmable Search Engine ID/config | Requires upfront auth and engine configuration, not anonymous first use |
| Microsoft Bing grounding / custom search integrations | No | Azure resource setup plus a resource key | Requires Azure-side provisioning and billing-bound resource keys up front |

That is why the remaining no-key fallbacks in this server stay limited to public-page scraping providers (DuckDuckGo/Bing/Google) rather than additional official provider integrations.

The fallback chain is Brave → Exa API → Exa MCP hosted search → DuckDuckGo → Bing, with Google scraping appended only when `OPENSEARCH_ENABLE_GOOGLE_SCRAPE=true`. `BRAVE_SEARCH_API_KEY` enables Brave. `EXA_API_KEY` enables the raw Exa Search API. When `EXA_API_KEY` is absent, the server uses Exa's official hosted MCP endpoint and its free plan before falling through to scrape providers. Set `OPENSEARCH_ENABLE_EXA_MCP=false` to skip the hosted Exa MCP path. If Brave or raw Exa credentials are present but rejected, the server continues down the fallback chain instead of aborting the search.


Returns a compact text rendering of the full result set in `content` and an array of `{ engine, title, url, snippet }` in `structuredContent.results`, where `engine` is one of `"Brave"`, `"Exa"`, `"DuckDuckGo"`, `"Bing"`, or `"Google"`.

### `web_fetch`

| Parameter | Type | Description |
|-----------|------|-------------|
| `url` | string | Legacy single URL to fetch |
| `urls` | string[] | Optional batch of URLs to fetch in one call |

For non-disabled hosted MCP mode, `web_fetch` tries Exa's official hosted MCP fetch path first and returns that result when available. If Exa MCP is unavailable or disabled via `OPENSEARCH_ENABLE_EXA_MCP=false`, it falls back to the local fetch pipeline (Readability/PDF extraction) and then Jina for sparse content. The outward-facing MCP response stays normalized across those paths, and `structuredContent.url` continues to echo the requested URL.

Single-fetch calls keep the extracted markdown body in `content` for compatibility and expose `{ title, url, length, count, results }` in `structuredContent`. Batch-fetch calls return multiple text blocks in `content` plus `{ count, results }` in `structuredContent`, where each entry in `results` is `{ title, url, content, length }`.

## Development

```bash
pnpm install
pnpm run build
pnpm test
```

### Release (via Changesets)

1. Make changes and add a changeset:
   ```bash
   pnpm changeset
   ```

2. Push to `main` — GitHub Actions will open a "Release PR" automatically.

3. Merge the Release PR → package is published to npm.

## License

MIT
