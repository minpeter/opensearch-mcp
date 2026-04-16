# opensearch-mcp

Zero-config web search and fetch MCP with free-tier-first routing across official providers

## Tools

- **`web_search`** — Multi-engine web search. Uses Brave → Exa MCP hosted search (free tier first) → Exa Search API when `EXA_API_KEY` is configured → DuckDuckGo → Bing when corresponding paths are available, with Google scraping available as an opt-in last resort. Responses are text-first and render the full result set in `content`.
- **`web_fetch`** — Fetches one or more URLs and converts them to markdown. It accepts Exa-style `urls`. Responses are text-first: each `content` block includes source metadata followed by extracted markdown. It tries Exa's hosted MCP fetch path first, then Exa's official contents API when `EXA_API_KEY` is configured, then the local HTML/PDF pipeline and finally [Jina AI](https://jina.ai) for sparse content.

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
| `numResults` | number | 5 | Preferred max results to return (1–15) |
| `max_results` | number | 5 | Legacy alias for `numResults` |

Returns an array of `{ engine, title, url, snippet }` where `engine` is one of `"Brave"`, `"Exa"`, `"DuckDuckGo"`, `"Bing"`, or `"Google"`.

| Provider | Path used by this server | Credential needed here? | Notes |
|---|---|---:|---|
| Brave | Brave Search API | Yes | Requires `BRAVE_SEARCH_API_KEY`. |
| Exa | Exa hosted MCP (`https://mcp.exa.ai/mcp`) | No (free hosted plan) | Tried first unless `OPENSEARCH_ENABLE_EXA_MCP=false`. |
| Exa | Exa Search API | Yes | Used after hosted MCP when `EXA_API_KEY` is set. |
| DuckDuckGo | HTML scraping | No | Public HTML endpoint; can still hit anti-bot challenges. |
| Bing | HTML scraping | No | Public search page scraping with wrapper URL normalization. |
| Google | HTML scraping (opt-in) | No | Disabled by default and used only as a last resort because it is challenge-prone. |

This project intentionally aggregates only official API paths, official hosted MCP paths, or public web pages. It does not rely on reverse-engineered private endpoints or credential bypasses.

The fallback chain is Brave → Exa MCP hosted search → Exa Search API → DuckDuckGo → Bing, with Google scraping appended only when `OPENSEARCH_ENABLE_GOOGLE_SCRAPE=true`. The hosted Exa MCP path is tried first so the server can use Exa's free hosted tier before consuming a configured `EXA_API_KEY`. Set `OPENSEARCH_ENABLE_EXA_MCP=false` to skip the hosted Exa MCP path entirely. If Brave or raw Exa credentials are present but rejected, the server continues down the fallback chain instead of aborting the search.


Returns a compact text rendering of the full result set in `content`, with each result rendered in `Title` / `URL` / `Highlights` / `Source` form. `engine` is one of `"Brave"`, `"Exa"`, `"DuckDuckGo"`, `"Bing"`, or `"Google"`.

### `web_fetch`

| Parameter | Type | Description |
|-----------|------|-------------|
| `urls` | string[] | URLs to fetch in one call |

For non-disabled hosted MCP mode, `web_fetch` tries Exa's official hosted MCP fetch path first so it can use the hosted free tier. If that is unavailable and `EXA_API_KEY` is configured, it falls back to Exa's official `POST /contents` API before using the local Readability/PDF pipeline and Jina for sparse content.

Single-fetch calls return one text block in `content` with `Title`, `URL`, `Length`, and the extracted markdown. Batch-fetch calls return a short summary block plus one text block per fetched URL with the same metadata-first format.

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
