// 公演のスラッグ（公開URL /events/{category}/{slug} とサイトマップにそのまま
// 使われる英字名）の形式を検査する。
// 主な利用先:
//  - app/theater/events/_components/EventForm.tsx: 入力中のエラー表示と送信前の検査
//  - app/api/theater/events/route.ts（POST）・[id]/route.ts（PATCH）: 保存前の検査
// クライアントとサーバーの両方から import するため、Node 専用 API や React に
// 依存しない純粋関数と定数だけを置く。
//
// 許可する形（前後の空白を除いたあと）:
//  - 英小文字・数字・ハイフンだけ。先頭・末尾のハイフンと、ハイフンの連続は不可
//  - 1〜80文字
// 大文字は自動で小文字にしない（入力欄の表示と保存値がずれるため）。
// 形式違反として扱い、メッセージで英小文字を案内する。
// 自動収集（harvest）が作る hv- で始まるスラッグもこの形に収まる。

export const EVENT_SLUG_MAX_LENGTH = 80;

const EVENT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type EventSlugErrorReason = "empty" | "url" | "format" | "too_long";

export type EventSlugValidationResult =
  | { ok: true; slug: string }
  | { ok: false; reason: EventSlugErrorReason; message: string };

const FORMAT_MESSAGE =
  "英小文字（a〜z）・数字・ハイフン（-）だけで入力してください。ハイフンは先頭・末尾・連続では使えません。";

// 画面（EventForm）とAPIの400で同じ文言を使う。
export const EVENT_SLUG_ERROR_MESSAGES: Record<EventSlugErrorReason, string> = {
  // 空欄は必須チェック側で先に止める想定。ここまで来た場合は形式違反と同じ文言にする。
  empty: FORMAT_MESSAGE,
  url: "ここには公式サイトなどのURLは入れられません。公演名などを英小文字・数字・ハイフンで入れてください（例：kemonohito）。",
  format: FORMAT_MESSAGE,
  too_long: `${EVENT_SLUG_MAX_LENGTH}文字以内で入力してください。`,
};

// 編集時に、読み込んだときの形式外スラッグ（百年桃・mime_faust など）から
// 変えていない場合に欄の下へ出す控えめな注意。
export const EVENT_SLUG_LEGACY_UNCHANGED_NOTE =
  "今のURLのまま保存できます。変える場合は英小文字・数字・ハイフンで入力してください。";

// 公式サイトやXのURLがまるごと入った形を見分ける（https://… / www.… / x.com/…）。
// 全角で入力された「：／．」や「ｗｗｗ」も拾えるよう、判定にだけNFKC正規化を使う。
const looksLikeUrl = (value: string) => {
  const normalized = value.normalize("NFKC").toLowerCase();
  return (
    normalized.includes("://") ||
    normalized.includes("www.") ||
    normalized.includes("/")
  );
};

const invalid = (reason: EventSlugErrorReason): EventSlugValidationResult => ({
  ok: false,
  reason,
  message: EVENT_SLUG_ERROR_MESSAGES[reason],
});

export const validateEventSlug = (input: string): EventSlugValidationResult => {
  const slug = input.trim();
  if (!slug) return invalid("empty");
  if (looksLikeUrl(slug)) return invalid("url");
  if (!EVENT_SLUG_PATTERN.test(slug)) return invalid("format");
  if (slug.length > EVENT_SLUG_MAX_LENGTH) return invalid("too_long");
  return { ok: true, slug };
};
