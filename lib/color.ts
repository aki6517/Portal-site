// 背景色の輝度(YIQ)から読みやすい文字色(ink/white)を選ぶ共通ヘルパー。
// カテゴリ色（categories.color）の上に載せる文字色を決めるために使う
// （app/calendar/WeekTimetable.tsx の公演帯、app/calendar/page.tsx の
// カテゴリチップの選択中表示、双方から利用する）。

const INK = "#111318";
const WHITE = "#ffffff";

/**
 * "#RGB" または "#RRGGBB" 形式の色から、その上に置く文字色（ink or white）を返す。
 * YIQ値（Darel Rex Finleyの式）が閾値128以上なら明るい背景とみなしinkを返す。
 * パースできない値が来た場合は安全側としてinkを返す。
 */
export const getReadableTextColor = (hexColor: string | null | undefined): string => {
  const hex = (hexColor ?? "").trim().replace(/^#/, "");
  const full = hex.length === 3
    ? hex.split("").map((c) => c + c).join("")
    : hex;

  if (full.length !== 6 || /[^0-9a-fA-F]/.test(full)) return INK;

  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;

  return yiq >= 128 ? INK : WHITE;
};
