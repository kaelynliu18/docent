export type ArtistRow = {
  id: string;
  name: string;
  birthYear: number | null;
  deathYear: number | null;
  sitelinks: number;
};
export type MovementRow = { id: string; name: string };
export type MuseumRow = {
  id: string;
  name: string;
  city: string | null;
  country: string | null;
  lat: number | null;
  lon: number | null;
  website: string | null;
  sitelinks: number;
};
export type ArtworkRow = {
  id: string;
  title: string;
  artistId: string;
  year: number | null;
  imageFile: string | null;
  sitelinks: number;
  museumId: string | null;
  inPool: boolean;
  /** 0–1; set by the fame pass (pool paintings only). */
  fame?: number;
  /** Depicts nudity, or genre nude/erotic art. */
  nudity?: boolean;
};

/** Everything ingestion produces; also the shape of fixtures/seed.json. */
export type Dataset = {
  artists: ArtistRow[];
  movements: MovementRow[];
  artistMovements: { artistId: string; movementId: string }[];
  museums: MuseumRow[];
  artworks: ArtworkRow[];
  artworkMovements: { artworkId: string; movementId: string; source: "artwork" | "artist" }[];
  genres: { id: string; name: string }[];
  artworkGenres: { artworkId: string; genreId: string }[];
  museumArtistHoldings: { museumId: string; artistId: string; paintingCount: number }[];
  museumMovementHoldings: { museumId: string; movementId: string; paintingCount: number }[];
};
