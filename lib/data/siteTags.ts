import { unstable_cache } from "next/cache";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { throwIfSupabaseError } from "@/lib/data/supabaseError";

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

// キャッシュされる関数の中ではエラーを空にせず例外を投げる（＝空のタグをキャッシュしない）。
// 例外は下の getSiteTags が受ける。
const fetchSiteTags = async (): Promise<SiteTags> => {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return EMPTY_SITE_TAGS;
  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from("site_settings")
    .select("head_tag, body_start_tag, body_end_tag")
    .eq("id", 1)
    .maybeSingle();
  throwIfSupabaseError("site-tags", error);
  if (!data) return EMPTY_SITE_TAGS;
  return {
    head_tag: normalizeSnippet(data.head_tag),
    body_start_tag: normalizeSnippet(data.body_start_tag),
    body_end_tag: normalizeSnippet(data.body_end_tag),
  } satisfies SiteTags;
};

// admin/site-tagsで保存されると app/api/admin/site-tags/route.ts が
// revalidateTag("site-tags") を呼ぶので、それまでは1時間キャッシュでOK。
// ルートのレイアウト（app/layout.tsx）が呼ぶので、例外を外へ出すとサイト全体が落ちる。
// 取得に失敗したときは、その回だけ空のタグを返す。空のタグはデータのキャッシュには残らないが、
// その描画が事前生成・作り直し（ISR）のページとして保存されると、次の作り直しまではタグ無しのページが残る。
export const getSiteTags = async (): Promise<SiteTags> => {
  try {
    return await unstable_cache(fetchSiteTags, ["site-tags"], {
      tags: ["site-tags"],
      revalidate: 3600,
    })();
  } catch {
    return EMPTY_SITE_TAGS;
  }
};
