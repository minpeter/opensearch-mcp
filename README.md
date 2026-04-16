# opensearch-mcp

MCP server with `web_search` and `web_fetch` tools.

## Tools

- **`web_search`** — Multi-engine web search (DuckDuckGo → Google → Bing fallback). `content` returns a concise summary and `structuredContent.results` returns the complete result set.
- **`web_fetch`** — Fetches a URL and converts it to markdown. `content` returns a concise summary and `structuredContent.content` returns the complete extracted body. Supports HTML pages and PDFs. Falls back to [Jina AI](https://jina.ai) for sparse content.

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

Returns a concise text summary in `content` and an array of `{ engine, title, url, snippet }` in `structuredContent.results`, where `engine` is one of `"DuckDuckGo"`, `"Google"`, or `"Bing"`.

### `web_fetch`

| Parameter | Type | Description |
|-----------|------|-------------|
| `url` | string | URL to fetch |

Returns a concise text summary in `content` and `{ title, content, url, length }` in `structuredContent`, where `structuredContent.content` is the extracted markdown.

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
