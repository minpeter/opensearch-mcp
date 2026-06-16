/**
 * Generic anti-bot / WAF interstitial detection for fetched pages.
 *
 * HTTP 200 is not success: WAF challenge pages (Cloudflare "Just a moment…",
 * DataDome, Imperva/Incapsula, Akamai) return 200 with readable boilerplate that
 * would otherwise be turned into markdown and ingested as if it were the page.
 *
 * Markers are vendor product strings, never site brand names. To avoid false
 * positives on legitimate pages that merely mention these words, "weak" phrase
 * markers only count when they appear in the <title> or the body is small;
 * "strong" markers are literal challenge tokens that essentially never occur in
 * real content and count unconditionally.
 */

const TITLE_REGEX = /<title[^>]*>([\s\S]*?)<\/title>/i;
const CHALLENGE_BODY_THRESHOLD = 3000;

// Literal challenge/WAF tokens — count on their own.
const STRONG_MARKERS = [
  "cf-chl-bypass",
  "/cdn-cgi/challenge-platform",
  "window._cf_chl_opt",
  "sec-if-cpt-container",
  "powered and protected by akamai",
  "request unsuccessful. incapsula incident",
] as const;

// Phrases that appear on challenge pages but could be quoted in real articles —
// require a <title> hit or a small body.
const WEAK_MARKERS = [
  "just a moment...",
  "attention required! | cloudflare",
  "checking your browser before accessing",
  "enable javascript and cookies to continue",
  "the requested url was rejected",
  "verify you are human",
  "access denied",
  "datadome",
] as const;

function titleText(lowerHtml: string): string {
  return lowerHtml.match(TITLE_REGEX)?.[1] ?? "";
}

/**
 * True when the HTML looks like an anti-bot challenge / block page rather than
 * real content. Caller should escalate (e.g. to the Jina reader) instead of
 * extracting markdown from it.
 */
export function isChallengePage(html: string): boolean {
  if (!html) {
    return false;
  }
  const lower = html.toLowerCase();

  if (STRONG_MARKERS.some((marker) => lower.includes(marker))) {
    return true;
  }

  const hit = WEAK_MARKERS.find((marker) => lower.includes(marker));
  if (!hit) {
    return false;
  }
  return (
    titleText(lower).includes(hit) || html.length < CHALLENGE_BODY_THRESHOLD
  );
}
