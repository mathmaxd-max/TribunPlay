import type * as engine from "@tribunplay/engine";

export type SetupLibrarySearchMode = "name" | "hash";

export type SetupLibraryFilterState = {
  query: string;
  searchMode: SetupLibrarySearchMode;
  armyMin: number | "";
  armyMax: number | "";
  tribunHeight: 0 | 1 | 2 | 3;
};

const isSubsequenceMatchCaseInsensitive = (needleRaw: string, haystackRaw: string): boolean => {
  const needle = needleRaw.trim().toLowerCase();
  if (!needle) return true;
  const haystack = haystackRaw.toLowerCase();
  let j = 0;
  for (let i = 0; i < haystack.length && j < needle.length; i += 1) {
    if (haystack[i] === needle[j]) j += 1;
  }
  return j === needle.length;
};

export const filterSetupLibraryItems = (
  items: engine.SetupLibraryItem[],
  filter: SetupLibraryFilterState,
): engine.SetupLibraryItem[] => {
  const query = filter.query.trim();
  const minArmy = filter.armyMin === "" ? null : filter.armyMin;
  const maxArmy = filter.armyMax === "" ? null : filter.armyMax;

  return items.filter((item) => {
    const queryTarget = filter.searchMode === "name" ? item.name : item.hash;
    if (query.length > 0 && !isSubsequenceMatchCaseInsensitive(query, queryTarget)) return false;
    if (minArmy !== null && item.armySize < minArmy) return false;
    if (maxArmy !== null && item.armySize > maxArmy) return false;
    if (filter.tribunHeight !== 0 && item.tribunHeight !== filter.tribunHeight) return false;
    return true;
  });
};
