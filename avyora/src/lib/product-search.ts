/**
 * Accurate product search matching.
 * Avoids substring false positives (e.g. "rings" matching "earrings").
 */

const SYNONYMS: Record<string, string> = {
  earring: "earring",
  earrings: "earring",
  earing: "earring",
  earings: "earring",
  ring: "ring",
  rings: "ring",
  necklace: "necklace",
  necklaces: "necklace",
  pendant: "pendant",
  pendants: "pendant",
  bracelet: "bracelet",
  bracelets: "bracelet",
  bangle: "bracelet",
  bangles: "bracelet",
  anklet: "anklet",
  anklets: "anklet",
};

function stemToken(raw: string): string {
  const s = raw.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!s) return "";
  if (SYNONYMS[s]) return SYNONYMS[s];

  if (s.endsWith("ies") && s.length > 4) return s.slice(0, -3) + "y";
  if (s.endsWith("sses") && s.length > 4) return s.slice(0, -2);
  if (s.endsWith("s") && !s.endsWith("ss") && s.length > 3) {
    const singular = s.slice(0, -1);
    return SYNONYMS[singular] ?? singular;
  }
  return s;
}

export function tokenizeSearchText(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map(stemToken)
    .filter(Boolean);
}

function tokenMatches(queryToken: string, productToken: string): boolean {
  if (queryToken === productToken) return true;
  // Prefix only for longer typed queries — never let "ring" hit "earring".
  if (queryToken.length >= 4 && productToken.startsWith(queryToken)) return true;
  if (productToken.length >= 4 && queryToken.startsWith(productToken) && queryToken.length - productToken.length <= 2) {
    return true;
  }
  return false;
}

export type SearchableProductFields = {
  name?: string;
  shortDescription?: string;
  description?: string;
  category?: string;
  collection?: string;
  metal?: string;
  stone?: string;
  brand?: string;
  slug?: string;
  tags?: string[];
};

/** True when every query word matches a whole product word (after light stemming). */
export function productMatchesQuery(
  product: SearchableProductFields,
  query: string,
): boolean {
  const qTokens = tokenizeSearchText(query.trim());
  if (!qTokens.length) return true;

  const productTokens = new Set(
    tokenizeSearchText(
      [
        product.name,
        product.shortDescription,
        product.description,
        product.category,
        product.collection,
        product.metal,
        product.stone,
        product.brand,
        product.slug?.replace(/-/g, " "),
        ...(product.tags ?? []),
      ]
        .filter(Boolean)
        .join(" "),
    ),
  );

  return qTokens.every((qt) =>
    [...productTokens].some((pt) => tokenMatches(qt, pt)),
  );
}
