---
"@minpeter/opensearch": minor
"@minpeter/opensearch-ai-sdk": minor
---

Add Ollama web search + fetch provider.

Ollama exposes the same web tools through two entry points that share one
per-account hourly quota (verified against ollama/ollama source):

- **Local daemon** `POST http://localhost:11434/api/experimental/web_{search,fetch}`
  — keyless on the wire (the signed-in daemon signs each request with the
  user's `~/.ollama` keypair). Requires `ollama serve` + `ollama signin`.
- **Cloud direct** `POST https://ollama.com/api/web_{search,fetch}` — requires
  `OLLAMA_API_KEY` (Bearer). Same account quota as the local path.

The provider tries the local daemon first and falls back to the cloud API only
when the daemon is unreachable (`ECONNREFUSED`/timeout) or unsigned (`401`).
Because both paths share one quota, a `429` (with `Retry-After`, resets at the
top of the hour) or any non-auth HTTP failure from the local path is propagated
immediately as `blocked`/`transient` rather than retried against the cloud — the
chain then moves on to the next configured provider instead of double-spending
quota.

Opt-in via `OPENSEARCH_ENABLE_OLLAMA=true` (default off, to keep existing
deployments' behavior unchanged and avoid probing `localhost:11434` for users
who never opted in). `OLLAMA_HOST` is honored for non-default daemon addresses.
Disable the local probe with `OPENSEARCH_DISABLE_OLLAMA_LOCAL=true` to force the
cloud-key path (e.g. on a server without a local daemon).

`opensearch-ai-sdk`'s mirrored `SEARCH_ENGINE_NAMES` is widened to include
`"Ollama"` for type parity.
