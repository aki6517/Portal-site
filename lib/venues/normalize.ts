// venue文字列（劇団が自由入力する会場名）を venues テーブルの施設へ正規化する。
// 主な利用先:
//  - lib/data/calendar.ts: 週番組表で公演を「施設」単位の行にグルーピングする
//  - app/api/theater/events/route.ts・[id]/route.ts: 保存時にvenue_idを
//    自動セットする（ベストエフォート）
//
// 表記ゆれの正規化手順:
//  1. NFKC正規化（全角丸括弧(U+FF08/FF09)は半角の()に正規化される等）
//  2. 括弧とその中身を除去（全角/半角どちらにも対応。例:
//     "ベイサイドライブホール（ベイサイドプレイス博多）" → "ベイサイドライブホール"）
//  3. 前後の空白をtrim
//  4. 空白区切りの「末尾トークン」がホール語（大ホール/中ホール/…）と完全一致
//     する場合のみそれを分離する。「ぽんプラザホール」のようにホール語が
//     施設名そのものに含まれ、空白で区切られていないケースは分離しない
//  5. venues.name（同じ手順で正規化した上で）に完全一致、またはaliases
//     （同様に正規化）のいずれかに一致するものを探す

export type VenueRow = {
  id: string;
  name: string;
  aliases?: string[] | null;
};

export type NormalizedVenue = {
  venueId: string | null;
  facilityName: string;
  hallNote: string | null;
};

// 空白区切りの末尾トークンがこれと完全一致する場合のみホール注記として分離する。
// 「ホール」「劇場」単体は含めない（施設名自体に含まれるケースと衝突するため）。
const HALL_SUFFIX_TOKENS = new Set([
  "大ホール",
  "中ホール",
  "小ホール",
  "大劇場",
  "中劇場",
  "小劇場",
  "ミュージアムホール",
  "ハーモニーホール",
  "中練習室",
  "練習室",
  "イベントホール",
]);

const stripBrackets = (value: string) => value.replace(/[（(][^）)]*[）)]/g, "");

/**
 * venue文字列を「施設名」と「ホール注記（あれば）」に分解する。
 * 空白で区切られた最後のトークンがホール語と完全一致する時だけ分離する。
 */
export const splitVenueString = (
  raw?: string | null
): { facilityName: string; hallNote: string | null } => {
  const value = (raw ?? "").trim();
  if (!value) return { facilityName: "", hallNote: null };

  const normalized = stripBrackets(value.normalize("NFKC")).trim();
  const tokens = normalized.split(/\s+/).filter(Boolean);

  if (tokens.length >= 2) {
    const last = tokens[tokens.length - 1];
    if (HALL_SUFFIX_TOKENS.has(last)) {
      return {
        facilityName: tokens.slice(0, -1).join(" "),
        hallNote: last,
      };
    }
  }

  return { facilityName: normalized, hallNote: null };
};

const normalizeForCompare = (value: string) => stripBrackets(value.normalize("NFKC")).trim();

/**
 * venue文字列をvenuesテーブルの行に解決する。
 * facilityName（ホール注記を除いた部分）が venues.name またはaliasesの
 * いずれかと正規化後に完全一致すればそのIDを返す。マッチしなければ
 * venueId: null（呼び出し側は「その他の会場」等として扱う）。
 */
export const resolveVenue = (
  raw: string | null | undefined,
  venues: VenueRow[]
): NormalizedVenue => {
  const { facilityName, hallNote } = splitVenueString(raw);
  if (!facilityName) return { venueId: null, facilityName: "", hallNote };

  const target = normalizeForCompare(facilityName);
  const match = venues.find((venue) => {
    if (normalizeForCompare(venue.name) === target) return true;
    const aliases = venue.aliases ?? [];
    return aliases.some((alias) => normalizeForCompare(alias) === target);
  });

  return { venueId: match?.id ?? null, facilityName, hallNote };
};
