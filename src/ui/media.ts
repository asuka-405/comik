import type { MediaKind } from "@/core/types";

/** Words and routes for each kind of title, so pages can share one layout. */
export const MEDIA: Record<MediaKind, { plural: string; one: string; unit: string; units: string; short: string; shelfKicker: string; discover: string; route: string }> = {
  comic: { plural: "Comics", one: "comic", unit: "chapter", units: "chapters", short: "Ch.", shelfKicker: "Your shelf", discover: "/browse", route: "/" },
  novel: { plural: "Web novels", one: "novel", unit: "chapter", units: "chapters", short: "Ch.", shelfKicker: "Your novels", discover: "/browse?media=novels", route: "/novels" },
  anime: { plural: "Anime", one: "anime", unit: "episode", units: "episodes", short: "Ep.", shelfKicker: "Your anime", discover: "/browse?media=anime", route: "/anime" },
};

export const MEDIA_KINDS: MediaKind[] = ["comic", "novel", "anime"];
