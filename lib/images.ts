/** Commons thumbnails are hotlinked; we only store the file name. */
export function commonsImage(file: string | null | undefined, width = 800): string | null {
  if (!file) return null;
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=${width}`;
}

export function commonsPage(file: string | null | undefined): string | null {
  if (!file) return null;
  return `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file.replace(/ /g, "_"))}`;
}

export function wikidataPage(qid: string) {
  return `https://www.wikidata.org/wiki/${qid}`;
}
