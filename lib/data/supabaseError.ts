// Supabase（PostgREST）の結果の error を例外に変える小さな共通関数。
//
// supabase-js は通信エラー（fetch failed など）も DB のエラーも例外にせず
// `{ data: null, error }` として返す。これを `data ?? []` で空として扱うと、
// unstable_cache に「空の結果」が残り、実在する公演が最大10分 404 になるなどの
// 不具合になる。unstable_cache は渡した関数が例外を投げたときは結果を保存しない
// （期限切れの値を読み取れた場合は、再取得に失敗してもその値を使う。revalidateTag の
// 直後など、キャッシュを読まずに取り直す場面では、例外がそのまま呼び出し元へ届く）ので、
// キャッシュされる関数の中ではこの関数で例外にする。
//
// ログに出すのは「どの取得か」・code・message の先頭行（200文字まで）の1行だけ。
// details（通信エラーの原因のスタックなど）・hint・鍵は出さない。ただし message は DB や
// PostgREST が返した文そのままなので、入力値（不正な値・検索語など）や、JSON でない応答の
// 本文の先頭が入ることがある。

type SupabaseErrorLike = {
  code?: string | null;
  message?: string | null;
} | null;

export const throwIfSupabaseError = (label: string, error: SupabaseErrorLike) => {
  if (!error) return;
  const code = error.code || "-";
  const message = (error.message ?? "").split("\n", 1)[0].slice(0, 200);
  console.error(`[data] ${label}: Supabase error code=${code} message=${message}`);
  throw new Error(`Supabase query failed: ${label}`);
};
