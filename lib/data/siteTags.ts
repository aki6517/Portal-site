import { unstable_cache } from "next/cache";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export type SiteTags = {
  head_tag: string | null;
  body_start_tag: string | null;
  body_end_tag: string | null;
};

const EMPTY_SITE_TAGS: SiteTags = {
  head_tag: null,
  body_start_tag: null,
  body_end_tag: null,
};

const normalizeSnippet = (value?: string | null) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const fetchSiteTags = async (): Promise<SiteTags> => {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return EMPTY_SITE_TAGS;
  try {
    const service = createSupabaseServiceClient();
    const { data, error } = await service
      .from("site_settings")
      .select("head_tag, body_start_tag, body_end_tag")
      .eq("id", 1)
      .maybeSingle();
    if (error || !data) return EMPTY_SITE_TAGS;
    return {
      head_tag: normalizeSnippet(data.head_tag),
      body_start_tag: normalizeSnippet(data.body_start_tag),
      body_end_tag: normalizeSnippet(data.body_end_tag),
    } satisfies SiteTags;
  } catch {
    return EMPTY_SITE_TAGS;
  }
};

// admin/site-tagsで保存されると app/api/admin/site-tags/route.ts が
// revalidateTag("site-tags") を呼ぶので、それまでは1時間キャッシュでOK。
export const getSiteTags = () =>
  unstable_cache(fetchSiteTags, ["site-tags"], {
    tags: ["site-tags"],
    revalidate: 3600,
  })();
