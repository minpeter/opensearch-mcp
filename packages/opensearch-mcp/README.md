# opensearch-mcp

Zero-config `web_search` and `web_fetch` for any MCP client, backed by the
reusable [`@minpeter/opensearch`](../opensearch) runtime.

Need the same routing and extraction behavior directly from TypeScript? Use
[`@minpeter/opensearch`](../opensearch). Need it as Vercel AI SDK tools? Use
[`opensearch-ai-sdk`](../opensearch-ai-sdk).

## Install

For MCP clients:

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

## Tools

`opensearch-mcp` exposes two stdio tools.

| Tool | Purpose |
|---|---|
| `web_search` | Searches the web and returns text-first results with title, URL, highlights, and source. |
| `web_fetch` | Reads one or more URLs and returns metadata plus clean markdown. |

### `web_search`

| Parameter | Type | Default | Notes |
|---|---:|---:|---|
| `query` | string | required | Natural-language search query. |
| `numResults` | number | `5` | Preferred result count, from 1 to 15. |
| `max_results` | number | `5` | Compatibility alias for `numResults`. |

Each result is rendered as:

```text
Title: ...
URL: ...
Highlights: ...
Source: ...
```

### `web_fetch`

| Parameter | Type | Default | Notes |
|---|---:|---:|---|
| `urls` | string[] | required | One to ten URLs. |
| `maxCharacters` | number | `12_000` | Optional per-page character cap. |

Single-URL fetches return one text block. Batch fetches return a short summary
block followed by one text block per URL.

## Configuration

The server reads the Node process environment for provider routing, API key
pools, endpoint overrides, and no-key fallback flags. See the runtime docs for
the full reference:

- Providers, search order, and no-key operation:
  [`packages/opensearch/README.md`](../opensearch/README.md#providers)
- API key pools and endpoint overrides:
  [`packages/opensearch/README.md`](../opensearch/README.md#api-key-pools)
- Per-provider limit/rate-limit contract:
  [`packages/opensearch/PROVIDERS.md`](../opensearch/PROVIDERS.md)

## Development

```bash
pnpm install
pnpm --filter opensearch-mcp start
```

Repo-wide scripts (`check`, `typecheck`, `test`, `build`) run from the
repository root. See the [root README](../../README.md#development).

## License

MIT
