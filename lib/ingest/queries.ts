/** SPARQL text only. Every query is small enough to finish well under 60 s. */

const values = (v: string, ids: string[]) => `VALUES ?${v} { ${ids.map((id) => `wd:${id}`).join(" ")} }`;
const enLabel = (v: string, out: string) =>
  `?${v} rdfs:label ?${out} . FILTER(LANG(?${out}) = "en")`;

/** Pass 1: pool paintings in one sitelink band. */
export function poolBandQuery(min: number, max: number | null): string {
  const filter = max == null ? `?sl >= ${min}` : `?sl >= ${min} && ?sl <= ${max}`;
  return `SELECT ?p ?pLabel ?artist ?image ?inception ?sl WHERE {
  ?p wdt:P31 wd:Q3305213 ; wikibase:sitelinks ?sl .
  FILTER(${filter})
  ?p wdt:P18 ?image ; wdt:P170 ?artist .
  ${enLabel("p", "pLabel")}
  OPTIONAL { ?p wdt:P571 ?inception }
}`;
}

/**
 * Paintings that depict nudity. Wikidata models it as many items ("nudity",
 * "naked woman", "clothed male, naked female", "male nudity"…), so match the
 * English label rather than a fixed list. "breastfeeding" is deliberately not matched.
 */
export const NUDITY_LABEL_RE = "nud|naked|^breasts?$|vulva|penis|genital";
export function nudityQuery(ids: string[]): string {
  return `SELECT DISTINCT ?p WHERE {
  ${values("p", ids)}
  ?p wdt:P180 ?d . ?d rdfs:label ?dl . FILTER(LANG(?dl) = "en")
  FILTER(REGEX(?dl, "${NUDITY_LABEL_RE}", "i"))
}`;
}

/** Genre names that also mean nudity. */
export const NUDITY_GENRE_RE = /\b(nude|erotic)/i;

/** Movements, genres, collections (with end-time and coordinate flags) and enwiki article for paintings. */
export function artworkDetailsQuery(ids: string[]): string {
  return `SELECT ?p ?move ?moveLabel ?genre ?genreLabel ?coll ?end ?coord ?article WHERE {
  ${values("p", ids)}
  {
    ?p wdt:P135 ?move . ${enLabel("move", "moveLabel")}
  } UNION {
    ?p wdt:P136 ?genre . ${enLabel("genre", "genreLabel")}
  } UNION {
    ?p p:P195 ?st . ?st ps:P195 ?coll .
    OPTIONAL { ?st pq:P582 ?end }
    OPTIONAL { ?coll wdt:P625 ?coord }
  } UNION {
    ?article schema:about ?p ; schema:isPartOf <https://en.wikipedia.org/> .
  }
}`;
}

export function artistsQuery(ids: string[]): string {
  return `SELECT ?a ?aLabel ?birth ?death ?sl ?move ?moveLabel WHERE {
  ${values("a", ids)}
  ?a wikibase:sitelinks ?sl .
  OPTIONAL { ${enLabel("a", "aLabel")} }
  OPTIONAL { ?a wdt:P569 ?birth }
  OPTIONAL { ?a wdt:P570 ?death }
  OPTIONAL { ?a wdt:P135 ?move . ${enLabel("move", "moveLabel")} }
}`;
}

/** Pass 2: painting counts per (artist, current collection with coordinates). */
export function holdingsQuery(artistIds: string[]): string {
  return `SELECT ?artist ?coll (COUNT(DISTINCT ?p) AS ?n) WHERE {
  ${values("artist", artistIds)}
  ?p wdt:P170 ?artist ; wdt:P31 wd:Q3305213 ; p:P195 ?st .
  ?st ps:P195 ?coll .
  FILTER NOT EXISTS { ?st pq:P582 ?end }
  FILTER EXISTS { ?coll wdt:P625 ?c }
} GROUP BY ?artist ?coll`;
}

/** Pass 2b: named works with images, to list "what to see" at each museum. */
export function namedWorksQuery(artistIds: string[]): string {
  return `SELECT ?p ?pLabel ?artist ?coll ?sl ?image ?inception WHERE {
  ${values("artist", artistIds)}
  ?p wdt:P170 ?artist ; wdt:P31 wd:Q3305213 ; wdt:P18 ?image ; wikibase:sitelinks ?sl ; p:P195 ?st .
  ?st ps:P195 ?coll .
  FILTER NOT EXISTS { ?st pq:P582 ?end }
  FILTER EXISTS { ?coll wdt:P625 ?c }
  ${enLabel("p", "pLabel")}
  OPTIONAL { ?p wdt:P571 ?inception }
}`;
}

/** Pass 3: museum details. */
export function museumsQuery(ids: string[]): string {
  return `SELECT ?m ?mLabel ?coord ?sl ?cityLabel ?countryLabel ?website ?parent WHERE {
  ${values("m", ids)}
  ?m wdt:P625 ?coord ; wikibase:sitelinks ?sl .
  ${enLabel("m", "mLabel")}
  OPTIONAL { ?m wdt:P361 ?parent . ?parent wdt:P625 ?pc }
  OPTIONAL { ?m wdt:P131 ?city . ${enLabel("city", "cityLabel")} }
  OPTIONAL { ?m wdt:P17 ?country . ${enLabel("country", "countryLabel")} }
  OPTIONAL { ?m wdt:P856 ?website }
}`;
}
