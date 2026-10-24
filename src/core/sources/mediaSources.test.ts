import { describe, expect, it } from "vitest";
import { splitPublicDomainText } from "./gutenbergText";
import { mapAniListMedia } from "./anilistMedia";

describe("legal media sources", () => {
  it("splits Gutenberg public-domain books into chapter text", () => {
    expect(splitPublicDomainText(`Header\n*** START OF THE PROJECT GUTENBERG EBOOK TEST ***\nCHAPTER I\nFirst chapter.\n\nCHAPTER II\nSecond chapter.\n*** END OF THE PROJECT GUTENBERG EBOOK TEST ***`)).toEqual([
      { title: "CHAPTER I", text: "First chapter." },
      { title: "CHAPTER II", text: "Second chapter." },
    ]);
  });

  it("maps AniList metadata and only retains HTTPS streaming links", () => {
    const media = mapAniListMedia({
      id: 17,
      title: { english: "Example Anime", romaji: "Example", native: "例" },
      episodes: 12,
      status: "FINISHED",
      externalLinks: [
        { site: "Crunchyroll", url: "https://www.crunchyroll.com/series/example", type: "STREAMING" },
        { site: "Unsafe", url: "javascript:alert(1)", type: "STREAMING" },
        { site: "Forum", url: "https://example.com", type: "SOCIAL" },
      ],
    });
    expect(media.kind).toBe("anime");
    expect(media.episodeCount).toBe(12);
    expect(media.externalLinks).toEqual([{ site: "Crunchyroll", url: "https://www.crunchyroll.com/series/example" }]);
  });
});