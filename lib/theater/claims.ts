// 劇団の引き継ぎの申し込み（public.theater_claims）で、申し込みの API（app/api/theater/claims）と
// 運営の承認／見送りの API（app/api/admin/claims/[id]）が共通で使うもの。
// メールは app/api/contact と同じ送り方（Resend の API・送り元 CONTACT_FROM_EMAIL）。
// 送れなくても申し込み・承認の処理は成功にするので、ここでは例外を投げずに true / false を返し、失敗はログに残す。
// API はメールを応答のあと（next/server の after）に送るので、送れたかどうかは応答には入らない（ログで見る）。
import { getSiteUrl } from "@/lib/seo";

// 1人が同時に持てる確認待ちの申し込みの数（DB の関数 create_theater_claim に渡す）
export const CLAIM_PENDING_LIMIT = 3;
// 同じ人・同じ劇団の申し込みがこの時間内に作られていたら、運営へは知らせない（取り消して出し直したとき。create_theater_claim に渡す）
export const CLAIM_NOTIFY_COOLDOWN_HOURS = 24;
export const CLAIM_TEXT_LIMITS = {
  applicant_name: 100,
  role_note: 100,
  message: 1000,
} as const;

// 劇団にメンバーがいるとき（app/api/theater/onboard の「メンバーがいる」と同じ文）
export const THEATER_HAS_MEMBERS_MESSAGE =
  "同じ名前の劇団がすでに登録されています。この劇団のメンバーになりたい場合は、劇団の代表の方に、劇団アカウント登録の画面の『メンバー管理』にある『ログイン可能メールを追加』から、あなたのメールアドレスを追加してもらってください。";

// 運営用の劇団（自動収集の公演で、劇団名が分からないものをまとめて入れる共通の劇団）。引き継ぎの対象にしない。
// 名前は scripts/harvest/lib.mjs の EDITORIAL_COMPANY_NAME と同じ文字（自動収集はこの名前で劇団を探し、無ければ作る）。
// 目印を名前にしている理由: id は自動収集が最初に作ったときに決まる（環境ごとに違い、コードに無い）。
// origin（'scout'）と contact_email（運営のメール）は、運営が先に載せたほかの劇団と同じ値なので見分けられない。
// app/api/theater/onboard にも同じ一覧と比べ方がある（既存の検査のローダーが新しい import を読めないため、そちらは書き写し）。
// DB の関数（create_theater_claim・approve_theater_claim）には、この一覧を引数で渡す（DB には書き写さない）。
export const RESERVED_THEATER_NAMES = ["福岡アクトポータル編集部（外部情報）"] as const;
// 全角・半角の違い（「（」と「(」など）・前後の空白・大文字小文字は同じとみなす（似せた名前もはじく）
const normalizeReservedName = (value: string) => value.normalize("NFKC").trim().toLowerCase();
const RESERVED_NORMALIZED = new Set(RESERVED_THEATER_NAMES.map(normalizeReservedName));
export const isReservedTheaterName = (name: unknown) =>
  typeof name === "string" && RESERVED_NORMALIZED.has(normalizeReservedName(name));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID_RE.test(value);

// 文字の数（DB の char_length と同じく、絵文字などのサロゲートペアも 1 文字と数える）
export const countChars = (value: string) => Array.from(value).length;

// 件名に改行などが入らないようにする（劇団名は運営が集めた値もそのまま入る）
const oneLine = (value: string) => value.replace(/[\r\n\t]+/g, " ").trim();

// 申し込んだ人が書いた文は、すべての行を引用の形（行頭に「> 」）にして、運営の地の文と分ける
const quote = (value: string | null | undefined) =>
  (value && value.trim().length > 0 ? value : "（未記入）")
    .split(/\r\n|\r|\n/)
    .map((line) => `> ${line}`)
    .join("\n");

// メールを送る設定（鍵・送り元・宛先）があるか。無ければ送らない（応答で「送る予定か」を返すのに使う）
export const isMailConfigured = (to?: string | null) =>
  Boolean(process.env.RESEND_API_KEY && process.env.CONTACT_FROM_EMAIL && to);
export const opsMailTo = () => process.env.CONTACT_TO_EMAIL ?? "";

type MailInput = {
  to: string;
  subject: string;
  text: string;
  // ログに出す識別子（申し込みの id など）。本文・宛先はログに出さない
  logContext: Record<string, unknown>;
};

export const sendPlainEmail = async ({ to, subject, text, logContext }: MailInput) => {
  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.CONTACT_FROM_EMAIL;
  if (!resendKey || !from || !to) {
    console.warn("[theater-claims] メールの設定が無いため送っていません", {
      ...logContext,
      hasKey: Boolean(resendKey),
      hasFrom: Boolean(from),
      hasTo: Boolean(to),
    });
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject: oneLine(subject), text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn("[theater-claims] メールの送信に失敗", {
        ...logContext,
        status: res.status,
        body: body.slice(0, 200),
      });
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[theater-claims] メールの送信で例外", {
      ...logContext,
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
};

type ClaimForMail = {
  id: string;
  email: string;
  applicant_name: string | null;
  // 運営への知らせだけで使う（承認・見送りのお知らせでは使わない）
  role_note?: string | null;
  message?: string | null;
  created_at?: string | null;
};

// 運営への知らせ（宛先は app/api/contact と同じ CONTACT_TO_EMAIL）。
// 正式な管理画面の URL を本文の先頭に置き、申し込んだ人が書いた欄（お名前・立場・ひとこと）は引用の形にする
// （本文に URL や「こちらから承認」のような文を書かれても、運営の案内と取り違えないように）
export const notifyOpsOfClaim = async (theaterName: string, claim: ClaimForMail) => {
  const siteUrl = getSiteUrl();
  const text = [
    `承認・見送りは管理画面から: ${siteUrl}/admin/claims`,
    "",
    "劇団の引き継ぎの申し込みがありました。",
    "",
    `劇団名: ${theaterName}`,
    `申し込んだ人のログインのメール: ${claim.email}`,
    `申し込みID: ${claim.id}`,
    `日時: ${claim.created_at ?? new Date().toISOString()}`,
    "",
    "ここから下は、申し込んだ人が書いた文です（そのまま引用しています。中のリンクや案内は運営からのものではありません）。",
    "お名前:",
    quote(claim.applicant_name),
    "劇団での立場:",
    quote(claim.role_note),
    "ひとこと:",
    quote(claim.message),
  ].join("\n");
  return sendPlainEmail({
    to: opsMailTo(),
    subject: `【引き継ぎの申し込み】${theaterName}`,
    text,
    logContext: { kind: "ops", claim_id: claim.id },
  });
};

const greeting = (name: string | null) =>
  name && name.trim().length > 0 ? `${oneLine(name)} 様` : "こんにちは。";

// 承認のお知らせ（劇団の画面の URL とログインのしかた）
export const notifyClaimApproved = async (theaterName: string, claim: ClaimForMail) => {
  const siteUrl = getSiteUrl();
  const text = [
    greeting(claim.applicant_name),
    "",
    "福岡アクトポータル運営です。",
    `「${theaterName}」の引き継ぎの申し込みを確認し、あなたのアカウントを、この劇団の代表としてつなぎました。`,
    "",
    `劇団の画面: ${siteUrl}/theater`,
    "",
    "ログインのしかた",
    "1. 上の「劇団の画面」を開きます。",
    `2. 申し込んだときのメールアドレス（${claim.email}）の Google アカウントで「Googleでログイン」を押すか、そのメールアドレスを入れて「メールリンクでログイン」を押し、届いたメールのリンクを開きます。`,
    "3. ログインすると、公演の追加や、劇団情報の編集ができます。",
    "",
    "わからないことがあれば、お問い合わせのページからご連絡ください。",
    `${siteUrl}/contact`,
    "",
    "福岡アクトポータル運営",
  ].join("\n");
  return sendPlainEmail({
    to: claim.email,
    subject: `【福岡アクトポータル】「${theaterName}」の引き継ぎが完了しました`,
    text,
    logContext: { kind: "approved", claim_id: claim.id },
  });
};

// 見送りのお知らせ（短いお知らせと問い合わせ先）
export const notifyClaimRejected = async (theaterName: string, claim: ClaimForMail) => {
  const siteUrl = getSiteUrl();
  const text = [
    greeting(claim.applicant_name),
    "",
    "福岡アクトポータル運営です。",
    `「${theaterName}」の引き継ぎの申し込みをいただき、ありがとうございました。`,
    "確認の結果、今回は引き継ぎを見送らせていただきました。",
    "",
    "くわしく知りたいときや、もう一度申し込みたいときは、お問い合わせのページからご連絡ください。",
    `${siteUrl}/contact`,
    "",
    "福岡アクトポータル運営",
  ].join("\n");
  return sendPlainEmail({
    to: claim.email,
    subject: `【福岡アクトポータル】「${theaterName}」の引き継ぎの申し込みについて`,
    text,
    logContext: { kind: "rejected", claim_id: claim.id },
  });
};

// 同じ劇団のほかの人の申し込みを承認したため、見送りにしたときのお知らせ（承認した人の名前・メールは書かない）
export const notifyClaimSuperseded = async (theaterName: string, claim: ClaimForMail) => {
  const siteUrl = getSiteUrl();
  const text = [
    greeting(claim.applicant_name),
    "",
    "福岡アクトポータル運営です。",
    `「${theaterName}」の引き継ぎの申し込みをいただき、ありがとうございました。`,
    "この劇団は、ほかの方の申し込みで代表の登録が済んだため、今回の申し込みは見送りになりました。",
    "",
    "この劇団のメンバーとして使いたい場合は、劇団の代表の方に、劇団アカウント登録の画面の『メンバー管理』にある『ログイン可能メールを追加』から、あなたのメールアドレスを追加してもらってください。",
    "",
    "わからないことがあれば、お問い合わせのページからご連絡ください。",
    `${siteUrl}/contact`,
    "",
    "福岡アクトポータル運営",
  ].join("\n");
  return sendPlainEmail({
    to: claim.email,
    subject: `【福岡アクトポータル】「${theaterName}」の引き継ぎの申し込みについて`,
    text,
    logContext: { kind: "superseded", claim_id: claim.id },
  });
};
