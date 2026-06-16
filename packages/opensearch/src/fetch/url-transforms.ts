/**
 * Generic, domain-agnostic URL transforms used to retry a blocked fetch.
 *
 * A blocked desktop URL sometimes succeeds on its mobile host (SSR mobile sites
 * are often less WAF-gated), or on the apex without `www.`. Transforms are pure
 * rules — they never name a specific site. Each returns a new URL or is skipped.
 */

const HTTP_PROTOCOLS = new Set(["http:", "https:"]);
const WWW_PREFIX = "www.";

// Two-label public suffixes where `b.c` is the registry, so `a.b.c` is an apex
// (e.g. example.co.uk), not a subdomain. Without this, the bare `parts === 2`
// check would skip apex domains under compound TLDs. A short, common-case list —
// not a full public-suffix list — covers the registrars we actually fetch from.
const COMPOUND_SUFFIXES = new Set([
  "co.uk",
  "org.uk",
  "me.uk",
  "ac.uk",
  "gov.uk",
  "com.au",
  "net.au",
  "org.au",
  "edu.au",
  "gov.au",
  "co.jp",
  "ne.jp",
  "or.jp",
  "co.nz",
  "org.nz",
  "co.za",
  "co.in",
  "com.br",
  "com.cn",
  "com.mx",
  "com.tr",
  "com.sg",
  "com.hk",
  "com.tw",
  "co.kr",
  "co.id",
  "co.il",
]);

/** Apex (registrable) host with no subdomain — the only hosts we add `m.` to. */
function isApexHost(host: string): boolean {
  const parts = host.split(".");
  if (parts.length === 2) {
    return true;
  }
  if (parts.length === 3) {
    return COMPOUND_SUFFIXES.has(`${parts[1]}.${parts[2]}`);
  }
  return false;
}

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
  } else if (!host.startsWith("m.") && isApexHost(host)) {
    add(`m.${host}`); // am_prefix (apex hosts only)
  }

  return out;
}
