export const buildIlikeFilter = (query: string, fields: string[]) => {
  const safe = query.replace(/[%_]/g, "\\$&").replace(/,/g, " ").trim();
  if (!safe) return "";
  const pattern = `%${safe}%`;
  return fields.map((field) => `${field}.ilike.${pattern}`).join(",");
};
