import type { JSDOM } from "jsdom";

/**
 * Structured page metadata — a partial-success path when Readability and the
 * reader fallback both come up empty (SPAs, paywalls, JS-gated pages still ship
 * OGP / Twitter Card / JSON-LD tags). Generic over any site.
 */
export interface PageMetadata {
  readonly author: string;
  readonly description: string;
  readonly published: string;
  readonly siteName: string;
  readonly title: string;
}

const ARTICLE_LD_TYPES = new Set([
  "article",
  "newsarticle",
  "blogposting",
  "techarticle",
  "report",
  "webpage",
]);

type MetaDoc = JSDOM["window"]["document"];

function metaContent(doc: MetaDoc, selectors: readonly string[]): string {
  for (const selector of selectors) {
    const content = doc
      .querySelector(selector)
      ?.getAttribute("content")
      ?.trim();
    if (content) {
      return content;
    }
  }
  return "";
}

function asName(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return value.map(asName).filter(Boolean).join(", ");
  }
  if (value && typeof value === "object") {
    const name = (value as { name?: unknown }).name;
    return typeof name === "string" ? name.trim() : "";
  }
  return "";
}

function flattenLd(node: unknown): Record<string, unknown>[] {
  if (Array.isArray(node)) {
    return node.flatMap(flattenLd);
  }
  if (node && typeof node === "object") {
    const record = node as Record<string, unknown>;
    const graph = record["@graph"];
    if (Array.isArray(graph)) {
      return graph.flatMap(flattenLd);
    }
    return [record];
  }
  return [];
}

function ldType(record: Record<string, unknown>): string[] {
  const type = record["@type"];
  if (typeof type === "string") {
    return [type.toLowerCase()];
  }
  if (Array.isArray(type)) {
    return type
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.toLowerCase());
  }
  return [];
}

function fromJsonLd(doc: MetaDoc): Partial<PageMetadata> {
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  for (const script of Array.from(scripts)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(script.textContent ?? "");
    } catch {
      continue;
    }
    for (const record of flattenLd(parsed)) {
      if (!ldType(record).some((type) => ARTICLE_LD_TYPES.has(type))) {
        continue;
      }
      return {
        author: asName(record.author),
        description:
          typeof record.description === "string"
            ? record.description.trim()
            : "",
        published:
          typeof record.datePublished === "string" ? record.datePublished : "",
        title: asName(record.headline ?? record.name),
      };
    }
  }
  return {};
}

export function extractMetadata(dom: JSDOM): PageMetadata {
  const doc = dom.window.document;
  const ld = fromJsonLd(doc);
  return {
    author:
      ld.author ||
      metaContent(doc, [
        'meta[name="author"]',
        'meta[property="article:author"]',
      ]),
    description:
      ld.description ||
      metaContent(doc, [
        'meta[property="og:description"]',
        'meta[name="twitter:description"]',
        'meta[name="description"]',
      ]),
    published:
      ld.published ||
      metaContent(doc, ['meta[property="article:published_time"]']),
    siteName: metaContent(doc, ['meta[property="og:site_name"]']),
    title:
      ld.title ||
      metaContent(doc, [
        'meta[property="og:title"]',
        'meta[name="twitter:title"]',
      ]) ||
      doc.title?.trim() ||
      "",
  };
}

/** Render metadata as a small markdown stub (title + byline + description). */
export function metadataToMarkdown(meta: PageMetadata): string {
  const parts: string[] = [];
  if (meta.title) {
    parts.push(`# ${meta.title}`);
  }
  const byline = [
    meta.author && `By ${meta.author}`,
    meta.published,
    meta.siteName,
  ]
    .filter(Boolean)
    .join(" · ");
  if (byline) {
    parts.push(`_${byline}_`);
  }
  if (meta.description) {
    parts.push(meta.description);
  }
  return parts.join("\n\n");
}
