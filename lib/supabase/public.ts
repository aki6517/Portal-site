import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// cookieに依存しない匿名クライアント。公開ページ（トップ・一覧・詳細など）の
// データ取得はこれを使う。cookies()を読まないため Server Components から
// unstable_cache 経由で安全にキャッシュ共有できる。
// 読めるのはRLSの「published viewable by everyone」等、公開ポリシーが
// 許可しているデータのみ（event_views_daily/event_redirects等の
// service_role専用テーブルは引き続き lib/supabase/service.ts を使う）。
export const createSupabasePublicClient = () =>
  createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
