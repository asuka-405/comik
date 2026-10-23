import type { Filter, TriState } from "./types";

export const F = {
  header: (key: string, name: string): Filter => ({ type: "header", key, name }),
  separator: (key: string): Filter => ({ type: "separator", key }),
  text: (key: string, name: string, state = ""): Filter => ({ type: "text", key, name, state }),
  checkbox: (key: string, name: string, state = false): Filter => ({ type: "checkbox", key, name, state }),
  tri: (key: string, name: string, state: TriState = 0): Filter => ({ type: "tristate", key, name, state }),
  select: (key: string, name: string, options: string[], values?: string[], state = 0): Filter => ({ type: "select", key, name, options, values, state }),
  sort: (key: string, name: string, options: string[], values?: string[], state = { index: 0, ascending: false }): Filter => ({ type: "sort", key, name, options, values, state }),
  group: (key: string, name: string, filters: Filter[]): Filter => ({ type: "group", key, name, filters }),
};

export function flattenFilters(filters: Filter[]): Filter[] {
  return filters.flatMap((f) => (f.type === "group" ? [f, ...flattenFilters(f.filters)] : [f]));
}

export function findFilter<T extends Filter["type"]>(filters: Filter[], key: string, type: T): Extract<Filter, { type: T }> | undefined {
  return flattenFilters(filters).find((f) => f.key === key && f.type === type) as Extract<Filter, { type: T }> | undefined;
}

/** Value (or label) currently chosen in a select filter. */
export function selectedValue(f: Extract<Filter, { type: "select" | "sort" }>): string {
  const idx = f.type === "sort" ? f.state.index : f.state;
  return f.values?.[idx] ?? f.options[idx] ?? "";
}

/** Keys of all checked/included members of a group. */
export function included(group: Filter | undefined): string[] {
  if (!group || group.type !== "group") return [];
  return group.filters.filter((f) => (f.type === "checkbox" && f.state) || (f.type === "tristate" && f.state === 1)).map((f) => f.key);
}
export function excluded(group: Filter | undefined): string[] {
  if (!group || group.type !== "group") return [];
  return group.filters.filter((f) => f.type === "tristate" && f.state === 2).map((f) => f.key);
}

export function cloneFilters(filters: Filter[]): Filter[] {
  return JSON.parse(JSON.stringify(filters)) as Filter[];
}

export function hasActiveFilters(filters: Filter[]): boolean {
  return flattenFilters(filters).some((f) => {
    switch (f.type) {
      case "text":
        return f.state.length > 0;
      case "checkbox":
        return f.state;
      case "tristate":
        return f.state !== 0;
      case "select":
        return f.state !== 0;
      case "sort":
        return f.state.index !== 0 || f.state.ascending;
      default:
        return false;
    }
  });
}
