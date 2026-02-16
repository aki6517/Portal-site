type MaybeString = string | null | undefined;

const normalizeImageUrl = (value: MaybeString) => {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("/")) return trimmed;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  try {
    const parsed = new URL(trimmed);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
};

export const buildEventImageCandidates = (
  imageUrl: MaybeString,
  flyerUrl: MaybeString
) => {
  const normalized = [normalizeImageUrl(imageUrl), normalizeImageUrl(flyerUrl)]
    .filter((item): item is string => Boolean(item))
    .map((item) => item.trim());
  return Array.from(new Set(normalized));
};
