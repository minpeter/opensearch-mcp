# Provider access and aggregation policy

`opensearch-mcp` aggregates search capacity only through official APIs, official hosted MCP endpoints, or public web pages. It does not rely on reverse-engineered private endpoints, cookie replay, CAPTCHA bypass, or other auth/workaround flows.

## Current aggregation order

`web_search` currently tries providers in this order:

1. Brave Search API (`BRAVE_SEARCH_API_KEY`)
2. Exa Search API (`EXA_API_KEY`)
3. Exa hosted MCP (`https://mcp.exa.ai/mcp`) when `EXA_API_KEY` is absent and `OPENSEARCH_ENABLE_EXA_MCP` is not `false`
4. DuckDuckGo public HTML search
5. Bing public HTML search
6. Google public HTML search when `OPENSEARCH_ENABLE_GOOGLE_SCRAPE=true`

## Provider matrix

| Provider / product | Access path used here | Credential in this package | Notes |
| --- | --- | --- | --- |
| Brave Search | Official Brave Search API | `BRAVE_SEARCH_API_KEY` | Preferred when configured. |
| Exa Search | Official raw Exa Search API | `EXA_API_KEY` | Preferred Exa path when a key is available. |
| Exa hosted MCP | Official remote MCP endpoint | None for hosted free plan; optional `EXA_API_KEY` for higher limits | Used in-server as a compliant free-path fallback when raw Exa API credentials are absent. |
| DuckDuckGo | Public HTML endpoint | None | Can be challenge-prone. |
| Bing | Public HTML endpoint | None | Current resilient scrape fallback. |
| Google | Public HTML endpoint | None | Opt-in only; challenge-prone and less reliable. |

## Explicitly out of scope

The project should **not** add or rely on any of the following:

- private or undocumented provider endpoints
- copied browser cookies or session tokens
- reverse-engineered auth flows
- CAPTCHA / challenge circumvention
- paid-feature bypasses or "free tier unlock" workarounds

If a provider requires credentials for a given official path, the supported approach is to supply valid credentials for that path or use a different official/public fallback.

## Exa hosted MCP vs raw Exa API

Exa exposes two official integration surfaces that matter here:

1. **Hosted MCP endpoint**: `https://mcp.exa.ai/mcp`
   - Useful for Exa's hosted free MCP plan and direct MCP client integrations.
   - `opensearch-mcp` now uses this as a built-in fallback when `EXA_API_KEY` is absent.
2. **Raw Exa Search API**
   - Used when `EXA_API_KEY` is configured.
   - Best when you want Exa results with your own paid credentials and higher limits.

That means:

- `opensearch-mcp` can aggregate Exa's hosted MCP free plan through Exa's official documented MCP endpoint.
- `opensearch-mcp` does **not** attempt to unlock raw Exa API access without credentials.
- If future provider aggregation work adds more remote MCP providers, it must use the provider's documented endpoint and normal auth flow.

## Recommended client setup

```json
{
  "mcpServers": {
    "opensearch": {
      "command": "npx",
      "args": ["-y", "opensearch-mcp"],
      "env": {
        "BRAVE_SEARCH_API_KEY": "your-brave-key",
        "EXA_API_KEY": "optional-raw-exa-key"
      }
    }
  }
}
```

Use `OPENSEARCH_ENABLE_EXA_MCP=false` if you want to skip the hosted Exa MCP path entirely.
