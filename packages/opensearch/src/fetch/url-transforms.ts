/**
 * Generic, domain-agnostic URL transforms used to retry a blocked fetch.
 *
 * A blocked desktop URL sometimes succeeds on its mobile host (SSR mobile sites
 * are often less WAF-gated), or on the apex without `www.`. Transforms are pure
 * rules — they never name a specific site. Each returns a new URL or is skipped.
 */

const HTTP_PROTOCOLS = new Set(["http:", "https:"]);
const WWW_PREFIX = "www.";

function withHost(url: URL, host: string): string {
  const next = new URL(url.toString());
  next.hostname = host;
  // Never carry Basic-auth credentials across to a different host.
  next.username = "";
  next.password = "";
  return next.toString();
}

/**
 * Variant URLs to try when the original is blocked, in priority order, excluding
 * the original and deduped. Empty for non-http(s) or unparseable URLs.
 */
export function transformedUrls(rawUrl: string): string[] {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return [];
  }
  if (!HTTP_PROTOCOLS.has(url.protocol)) {
    return [];
  }

  const host = url.hostname.toLowerCase();
  const out: string[] = [];
  const seen = new Set([url.toString()]);
  const add = (candidateHost: string): void => {
    if (candidateHost === "" || candidateHost === host) {
      return;
    }
    const candidate = withHost(url, candidateHost);
    if (!seen.has(candidate)) {
      seen.add(candidate);
      out.push(candidate);
    }
  };

  if (host.startsWith(WWW_PREFIX)) {
    const apex = host.slice(WWW_PREFIX.length);
    add(`m.${apex}`); // mobile_subdomain
    add(apex); // drop_www
  } else if (!host.startsWith("m.") && host.split(".").length === 2) {
    add(`m.${host}`); // am_prefix (apex hosts only)
  }

  return out;
}
