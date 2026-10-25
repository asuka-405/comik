import { mediaOf, type CategoryRow, type MangaRow } from "./types";

export function splitLegacyCategories(categories: CategoryRow[], manga: MangaRow[], timestamp: number): { categories: CategoryRow[]; manga: MangaRow[] } {
  const migratedCategories = categories.map((category) => ({ ...category, kind: category.kind ?? "comic" as const }));
  const replacements = new Map<string, string>();
  for (const kind of ["novel", "anime"] as const) {
    for (const category of migratedCategories) {
      if (!manga.some((item) => mediaOf(item) === kind && item.categoryIds.includes(category.id))) continue;
      const id = `${category.id}::${kind}`;
      replacements.set(`${kind}:${category.id}`, id);
      migratedCategories.push({ ...category, id, kind, modifiedAt: Math.max(category.modifiedAt, timestamp) });
    }
  }
  return {
    categories: migratedCategories,
    manga: manga.map((item) => {
      const kind = mediaOf(item);
      if (kind === "comic") return item;
      const categoryIds = item.categoryIds.map((id) => replacements.get(`${kind}:${id}`) ?? id);
      return categoryIds.every((id, index) => id === item.categoryIds[index])
        ? item
        : { ...item, categoryIds, modifiedAt: Math.max(item.modifiedAt, timestamp) };
    }),
  };
}