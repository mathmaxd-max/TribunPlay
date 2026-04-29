const isSafeRelativePath = (value: string): boolean => {
  if (!value.startsWith("/")) return false;
  if (value.startsWith("//")) return false;
  if (value.includes("\\")) return false;
  if (/\s/.test(value)) return false;
  return true;
};

export const resolveNextPath = (rawNext: string | null | undefined): string => {
  if (!rawNext) {
    return "/";
  }

  const decoded = decodeURIComponent(rawNext);
  return isSafeRelativePath(decoded) ? decoded : "/";
};
