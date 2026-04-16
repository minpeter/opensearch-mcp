# opensearch-mcp

MCP server with `web_search` and `web_fetch` tools.

## Tools

- **`web_search`** — Multi-engine web search (DuckDuckGo → Google → Bing fallback). `content` returns a compact text rendering of the full result set, and `structuredContent.results` returns the same results in machine-readable form.
- **`web_fetch`** — Fetches a URL and converts it to markdown. `content` returns the complete extracted body, and `structuredContent` returns extraction metadata. Supports HTML pages and PDFs. Falls back to [Jina AI](https://jina.ai) for sparse content.
- **`web_search`** — Multi-engine web search. Uses Brave → Exa → DuckDuckGo → Bing when corresponding API keys are configured, with Google scraping available as an opt-in last resort. `content` returns a compact text rendering of the full result set, and `structuredContent.results` returns the same results in machine-readable form.
- **`web_fetch`** — Fetches a URL and converts it to markdown. `content` returns the complete extracted body, and `structuredContent` returns extraction metadata. Supports HTML pages and PDFs. Falls back to [Jina AI](https://jina.ai) for sparse content.

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

Set `BRAVE_SEARCH_API_KEY` and/or `EXA_API_KEY` to enable API-backed providers. Set `OPENSEARCH_ENABLE_GOOGLE_SCRAPE=true` to append Google scraping as a last-resort fallback.

Returns a compact text rendering of the full result set in `content` and an array of `{ engine, title, url, snippet }` in `structuredContent.results`, where `engine` is one of `"Brave"`, `"Exa"`, `"DuckDuckGo"`, `"Bing"`, or `"Google"`.

### `web_fetch`

| Parameter | Type | Description |
|-----------|------|-------------|
| `url` | string | URL to fetch |

Returns the extracted markdown body in `content` and `{ title, url, length }` in `structuredContent`.

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
