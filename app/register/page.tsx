"use client";

import { useEffect, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type MeResponse = {
  data?: {
    theater: { id: string; name: string; status: string } | null;
    member: { role: string } | null;
    theaters?: { id: string; name: string; status: string; role: string }[];
    stats?: {
      memberCount: number;
      inviteCount: number;
      totalAllowed: number;
    };
    invites?: { id: string; email: string; status: string; created_at: string }[];
    joinedFromInvite?: boolean;
    pendingInvite?: { id: string; theater_id: string } | null;
  };
  error?: { code: string; message: string };
};

// 劇団の引き継ぎの申し込み（app/api/theater/claims）
type ClaimSummary = {
  id: string;
  theater_id: string;
  theater_name: string | null;
  status: string;
  created_at: string;
};
type ClaimTarget = { id: string; name: string; message: string };

const CLAIMABLE_FALLBACK_MESSAGE =
  "この劇団は、福岡アクトポータル運営がすでに情報を載せています。下の『引き継ぎを申し込む』から申し込むと、運営が確認してから、あなたのアカウントをこの劇団の代表としてつなぎます。";
const CLAIM_SENT_MESSAGE =
  "申し込みを受け付けました。運営が確認してから、ご登録のメールアドレスにお知らせします（ふだんは数日以内）。";
const CLAIM_ALREADY_PENDING_MESSAGE =
  "この劇団の引き継ぎは、すでに申し込み済みです。運営の確認をお待ちください。";
const CLAIM_FAILED_MESSAGE =
  "申し込みに失敗しました。時間をおいてもう一度お試しください。続く場合は福岡アクトポータル運営にお問い合わせください。";
const CLAIM_UNCONFIRMED_MESSAGE =
  "申し込みを受け付けたかどうかを確かめられませんでした。画面を読み込み直して、上に「申し込み中です」と出ているか確かめてください。";
const CLAIM_CANCELLED_MESSAGE = "引き継ぎの申し込みを取り消しました。";
const CLAIM_CANCEL_FAILED_MESSAGE =
  "取り消しに失敗しました。時間をおいてもう一度お試しください。続く場合は福岡アクトポータル運営にお問い合わせください。";
const CLAIM_NETWORK_MESSAGE =
  "通信に失敗しました。インターネットへのつながりを確かめて、もう一度お試しください。";

const formatClaimDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "日付不明";
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Tokyo",
  }).format(date);
};

// 劇団登録（app/api/theater/onboard）の 409 THEATER_CLAIMABLE の data.theater を取り出す
const readClaimableTheater = (json: unknown) => {
  const theater = (json as { data?: { theater?: { id?: unknown; name?: unknown } } } | null)?.data?.theater;
  return typeof theater?.id === "string" && typeof theater?.name === "string"
    ? { id: theater.id, name: theater.name }
    : null;
};

// 申し込み 1 件の形を確かめる（サーバーの応答は unknown として受けて、形が違う行は使わない）
const readClaimSummary = (value: unknown): ClaimSummary | null => {
  const v = value as Partial<Record<keyof ClaimSummary, unknown>> | null;
  if (
    typeof v !== "object" || v === null ||
    typeof v.id !== "string" || typeof v.theater_id !== "string" ||
    typeof v.status !== "string" || typeof v.created_at !== "string" ||
    !(v.theater_name === null || v.theater_name === undefined || typeof v.theater_name === "string")
  ) {
    return null;
  }
  return {
    id: v.id,
    theater_id: v.theater_id,
    theater_name: typeof v.theater_name === "string" ? v.theater_name : null,
    status: v.status,
    created_at: v.created_at,
  };
};

// 自分の確認待ちの申し込みを読む（GET /api/theater/claims の data.pending）。読めなかったら null（画面には出さず、ログに残す）
const fetchMyClaims = async (): Promise<ClaimSummary[] | null> => {
  try {
    const res = await fetch("/api/theater/claims", { cache: "no-store" });
    if (!res.ok) {
      console.error("[register] 引き継ぎの申し込みの読み込みに失敗", { status: res.status });
      return null;
    }
    const json: unknown = await res.json().catch(() => null);
    const pending = (json as { data?: { pending?: unknown } } | null)?.data?.pending;
    if (!Array.isArray(pending)) {
      console.error("[register] 引き継ぎの申し込みの一覧の形が違う");
      return null;
    }
    const rows = pending.map(readClaimSummary);
    if (rows.some((row) => row === null)) {
      console.error("[register] 引き継ぎの申し込みの一覧に形が違う行がある（その行は出さない）");
    }
    return rows.filter((row): row is ClaimSummary => row !== null && row.status === "pending");
  } catch (err) {
    console.error("[register] 引き継ぎの申し込みの読み込みに失敗", err);
    return null;
  }
};

const getTheaterStatusCopy = (status: string) => {
  switch (status) {
    case "pending":
      return { label: "運営確認中" };
    case "approved":
      return { label: "承認済み" };
    case "rejected":
      return { label: "差し戻し" };
    case "suspended":
      return { label: "停止中" };
    default:
      return { label: status };
  }
};

const getInviteStatusCopy = (status: string) => {
  switch (status) {
    case "pending":
      return {
        label: "未確認（未ログイン）",
        tone: "text-amber-700",
        bg: "bg-amber-50",
      };
    case "accepted":
      return { label: "有効", tone: "text-green-700", bg: "bg-green-50" };
    case "revoked":
      return { label: "無効", tone: "text-zinc-600", bg: "bg-zinc-100" };
    default:
      return { label: status, tone: "text-zinc-700", bg: "bg-zinc-50" };
  }
};

// Supabase のログイン（メールのリンク・Google・ログアウト）の失敗を、劇団の人が読む日本語にする。
// 決め手は error.code（@supabase/auth-js の ErrorCode）・status・name で、英語の error.message は
// 画面に出さず console.error に残す。知らない失敗は、操作ごとの決まった文にする。
// （app/theater/page.tsx と app/register/page.tsx で同じ内容）
type AuthErrorLike =
  | { name?: string; code?: string; status?: number; message?: string }
  | null
  | undefined;
type AuthAction = "otp" | "oauth" | "signout";
const AUTH_FALLBACK_MESSAGES: Record<AuthAction, string> = {
  otp: "ログイン用のメールを送れませんでした。時間をおいてもう一度お試しください。続く場合は福岡アクトポータル運営にお問い合わせください。",
  oauth:
    "Googleでのログインを始められませんでした。時間をおいてもう一度お試しください。続く場合は福岡アクトポータル運営にお問い合わせください。",
  signout: "ログアウトできませんでした。時間をおいてもう一度お試しください。",
};
const describeAuthError = (error: AuthErrorLike, action: AuthAction) => {
  console.error(`[register] ログインの操作（${action}）に失敗`, {
    name: error?.name,
    code: error?.code,
    status: error?.status,
    message: error?.message,
  });
  const code = error?.code ?? "";
  // 回数の制限（メールの送りすぎ・操作のしすぎ）
  if (code === "over_email_send_rate_limit") {
    return "ログイン用のメールを短い時間に送りすぎたため、いまは送れません。しばらく（数分〜1時間ほど）待ってから、もう一度お試しください。";
  }
  if (code === "over_request_rate_limit" || error?.status === 429) {
    return "短い時間にログインの操作が続いたため、いまは受け付けられません。しばらく待ってから、もう一度お試しください。";
  }
  // 通信の失敗（auth-js は通信断・502〜504 を AuthRetryableFetchError にする）
  if (error?.name === "AuthRetryableFetchError" || code === "request_timeout") {
    return "通信に失敗しました。インターネットへのつながりを確かめて、もう一度お試しください。";
  }
  if (action === "otp") {
    if (code === "email_address_invalid" || code === "validation_failed") {
      return "メールアドレスの形が正しくありません。入力し直してください。";
    }
    if (code === "email_address_not_authorized") {
      return "このメールアドレスには、いまログイン用のメールを送れません。福岡アクトポータル運営にお問い合わせください。";
    }
    if (code === "signup_disabled" || code === "otp_disabled" || code === "email_provider_disabled") {
      return "いまはメールでのログイン・新規登録を受け付けていません。福岡アクトポータル運営にお問い合わせください。";
    }
  }
  if (action === "oauth" && (code === "provider_disabled" || code === "oauth_provider_not_supported")) {
    return "いまは Google でのログインを使えません。メールのリンクでログインしてください。";
  }
  if (code === "captcha_failed") {
    return "確認に失敗しました。画面を読み込み直してから、もう一度お試しください。";
  }
  return AUTH_FALLBACK_MESSAGES[action];
};

// Google のログインやメールのリンクから、エラー付きで戻ってきたときの案内。
// signInWithOAuth は遷移の時点では error: null を返すので、Google 側でのキャンセルなどの失敗は、
// 戻り先の URL の error・error_code・error_description（クエリとハッシュの両方）に入る。
// 拾ったら URL から消す（再読み込みで同じ案内が出続けないように）。英語の error_description は console.error に残す。
// （app/theater/page.tsx と app/register/page.tsx で同じ内容）
const AUTH_REDIRECT_KEYS = ["error", "error_code", "error_description"] as const;
const takeAuthRedirectError = () => {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  const pick = (key: string) => url.searchParams.get(key) ?? hash.get(key);
  const found = { error: pick("error"), code: pick("error_code"), description: pick("error_description") };
  if (!found.error && !found.code && !found.description) return null;
  for (const key of AUTH_REDIRECT_KEYS) {
    url.searchParams.delete(key);
    hash.delete(key);
  }
  const nextHash = hash.toString();
  window.history.replaceState(
    window.history.state,
    "",
    `${url.pathname}${url.search}${nextHash ? `#${nextHash}` : ""}`
  );
  return found;
};
const describeAuthRedirectError = (found: {
  error: string | null;
  code: string | null;
  description: string | null;
}) => {
  console.error("[register] ログインの戻り先の URL にエラー", found);
  const code = found.code ?? "";
  if (code === "otp_expired") {
    return "ログイン用のリンクの期限が切れているか、すでに使われています。もう一度ログイン用のメールを送ってください。";
  }
  if (["flow_state_expired", "flow_state_not_found", "bad_oauth_state", "bad_oauth_callback", "bad_code_verifier"].includes(code)) {
    return "ログインの手続きの期限が切れたか、途中で止まりました。もう一度ログインしてください。";
  }
  if (code === "provider_disabled" || code === "oauth_provider_not_supported") {
    return "いまは Google でのログインを使えません。メールのリンクでログインしてください。";
  }
  if (code === "signup_disabled") {
    return "いまは新規登録を受け付けていません。福岡アクトポータル運営にお問い合わせください。";
  }
  if (code === "user_banned") {
    return "このアカウントではログインできません。福岡アクトポータル運営にお問い合わせください。";
  }
  if (code === "over_request_rate_limit" || code === "over_email_send_rate_limit") {
    return "短い時間にログインの操作が続いたため、いまは受け付けられません。しばらく待ってから、もう一度お試しください。";
  }
  if (found.error === "access_denied") {
    return "Googleでのログインが完了しませんでした（キャンセルされたか、許可されませんでした）。もう一度お試しください。";
  }
  return "ログインできませんでした。時間をおいてもう一度お試しください。続く場合は福岡アクトポータル運営にお問い合わせください。";
};

export default function RegisterPage() {
  const supabase = createSupabaseBrowserClient();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "sent">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [me, setMe] = useState<MeResponse["data"] | null>(null);
  const [authState, setAuthState] = useState<
    "loading" | "loggedOut" | "loggedIn"
  >("loading");
  const [onboardMessage, setOnboardMessage] = useState<string | null>(null);
  const [onboarding, setOnboarding] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [meCheckStatus, setMeCheckStatus] = useState<
    "idle" | "checking" | "ok" | "error"
  >("idle");
  const [meCheckMessage, setMeCheckMessage] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteStatus, setInviteStatus] = useState<
    "idle" | "loading" | "sent" | "error"
  >("idle");
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);
  const [inviteRemoveId, setInviteRemoveId] = useState<string | null>(null);
  const [members, setMembers] = useState<
    { user_id: string; role: string; email: string }[]
  >([]);
  const [memberRemoveId, setMemberRemoveId] = useState<string | null>(null);
  const [onboardForm, setOnboardForm] = useState({
    name: "",
    contact_email: "",
    website_url: "",
    description: "",
    sns_x_url: "",
    sns_instagram_url: "",
    sns_facebook_url: "",
  });
  // 劇団の引き継ぎの申し込み
  const [myClaims, setMyClaims] = useState<ClaimSummary[]>([]);
  // 申し込みの一覧の取得の番号（世代）。取得を始めるとき・取り消しが成功したときに進め、最新の番号の応答だけを反映する
  // （古い応答があとから届いて、確認待ちが消えたり、取り消した行が戻ったりしないように）
  const claimsLoadSeq = useRef(0);
  // 劇団名の入力欄の今の値（劇団登録の応答が返ったときに、送ったときの名前と比べる）
  const onboardNameRef = useRef("");
  const [claimTarget, setClaimTarget] = useState<ClaimTarget | null>(null);
  const [claimForm, setClaimForm] = useState({
    applicant_name: "",
    role_note: "",
    message: "",
  });
  // 申し込みの送信中・送信済み・失敗を、劇団の id ごとに持つ（劇団 A の応答が遅れて返っても、劇団 B の欄には出さない）
  const [claimResults, setClaimResults] = useState<
    Record<string, { status: "loading" | "sent" | "error"; message: string | null }>
  >({});
  const setClaimResult = (
    theaterId: string,
    value: { status: "loading" | "sent" | "error"; message: string | null } | null
  ) =>
    setClaimResults((prev) => {
      const next = { ...prev };
      if (value) next[theaterId] = value;
      else delete next[theaterId];
      return next;
    });
  const [cancelingClaimId, setCancelingClaimId] = useState<string | null>(null);
  const [claimNotice, setClaimNotice] = useState<
    { tone: "ok" | "error"; text: string } | null
  >(null);

  // ログインの戻り先の URL のエラー（Google でのキャンセルなど）を拾って案内する
  useEffect(() => {
    const found = takeAuthRedirectError();
    if (found) setMessage(describeAuthRedirectError(found));
  }, []);

  useEffect(() => {
    const refreshAuth = async () => {
      setMeCheckStatus("checking");
      setMeCheckMessage(null);
      setAuthState("loading");

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setUserEmail(null);
        setMe(null);
        setAuthState("loggedOut");
        setMeCheckStatus("ok");
        return;
      }

      setUserEmail(user.email ?? null);
      setOnboardForm((prev) =>
        prev.contact_email
          ? prev
          : { ...prev, contact_email: user.email ?? "" }
      );
      setAuthState("loggedIn");
      // 確認待ちの引き継ぎの申し込みがあれば、登録フォームの上に出す（読めなくても画面は止めない）
      const loadSeq = ++claimsLoadSeq.current;
      void fetchMyClaims().then((claims) => {
        if (claims && loadSeq === claimsLoadSeq.current) setMyClaims(claims);
      });

      try {
        const res = await fetch("/api/theater/me", { cache: "no-store" });
        if (res.status === 401) {
          setMe(null);
          setMeCheckStatus("error");
          setMeCheckMessage(
            "ログイン状態はありますが、サーバー側でセッションが確認できません。ログアウト→再ログイン後に再度お試しください。"
          );
          return;
        }
        if (!res.ok) {
          const json = (await res.json().catch(() => null)) as
            | MeResponse
            | null;
          setMeCheckStatus("error");
          setMeCheckMessage(
            json?.error?.message ?? "ログイン状態の確認に失敗しました。"
          );
          return;
        }
        const json = (await res.json()) as MeResponse;
        setMe(json.data ?? null);
        if (json.data?.member?.role === "owner") {
          const membersRes = await fetch("/api/theater/members", {
            cache: "no-store",
          });
          if (membersRes.ok) {
            const membersJson = (await membersRes.json()) as {
              data?: { members: { user_id: string; role: string; email: string }[] };
            };
            setMembers(membersJson.data?.members ?? []);
          }
        } else {
          setMembers([]);
        }
        setMeCheckStatus("ok");
      } catch {
        setMeCheckStatus("error");
        setMeCheckMessage("ネットワークエラーで確認に失敗しました。");
      }
    };

    refreshAuth();
  }, []);

  const signInWithGoogle = async () => {
    setMessage(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/register`,
      },
    });
    if (error) {
      setMessage(describeAuthError(error, "oauth"));
    }
  };

  const signInWithMagicLink = async () => {
    setStatus("loading");
    setMessage(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/register`,
      },
    });
    if (error) {
      setMessage(describeAuthError(error, "otp"));
      setStatus("idle");
      return;
    }
    setStatus("sent");
  };

  const submitOnboarding = async () => {
    // 送ったときの劇団名。応答が返るまでに入力欄の名前を変えたら、その応答は画面に反映しない
    const sentName = onboardForm.name.trim();
    setOnboarding(true);
    setOnboardMessage(null);
    setClaimTarget(null);
    const res = await fetch("/api/theater/onboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(onboardForm),
    });
    // 本文が JSON でない応答（サーバーの前段のエラーページなど）でも止まらないようにする
    const json = (await res.json().catch(() => null)) as
      | (MeResponse & { error?: { code: string; message: string } })
      | null;
    if (onboardNameRef.current.trim() !== sentName) {
      setOnboarding(false);
      return;
    }
    // 運営が先に載せた劇団（メンバーが 0 人）と同じ名前: 引き継ぎの申し込み欄を出す
    const claimable =
      res.status === 409 && json?.error?.code === "THEATER_CLAIMABLE"
        ? readClaimableTheater(json)
        : null;
    if (claimable) {
      setClaimTarget({
        ...claimable,
        message: json?.error?.message ?? CLAIMABLE_FALLBACK_MESSAGE,
      });
      // 前に失敗していたら、もう一度申し込めるように戻す（送信中・送信済みはそのまま）
      if (claimResults[claimable.id]?.status === "error") setClaimResult(claimable.id, null);
      setOnboarding(false);
      return;
    }
    if (!res.ok) {
      // サーバーが場合ごとの日本語の文を返す（ログイン切れはログインし直しの案内、権限の問題は運営への問い合わせ）
      setOnboardMessage(json?.error?.message ?? "登録に失敗しました。時間をおいてもう一度お試しください。");
      setOnboarding(false);
      return;
    }
    setOnboardMessage(
      "劇団を追加しました。/theater で操作対象を切り替えて編集できます。"
    );
    setOnboardForm({
      name: "",
      contact_email: userEmail ?? "",
      website_url: "",
      description: "",
      sns_x_url: "",
      sns_instagram_url: "",
      sns_facebook_url: "",
    });
    onboardNameRef.current = "";
    setOnboarding(false);
  };

  const submitClaim = async () => {
    if (!claimTarget) return;
    // 送ったときの劇団。応答はこの劇団の欄にだけ反映する
    const targetId = claimTarget.id;
    setClaimResult(targetId, { status: "loading", message: null });
    setClaimNotice(null);
    try {
      const res = await fetch("/api/theater/claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          theater_id: targetId,
          applicant_name: claimForm.applicant_name,
          role_note: claimForm.role_note,
          message: claimForm.message,
        }),
      });
      const json: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const errorMessage = (json as { error?: { message?: unknown } } | null)?.error?.message;
        setClaimResult(targetId, {
          status: "error",
          message: typeof errorMessage === "string" ? errorMessage : CLAIM_FAILED_MESSAGE,
        });
        return;
      }
      const data = (json as { data?: { claim?: unknown; already_pending?: unknown } } | null)?.data;
      const claim = readClaimSummary(data?.claim);
      if (!claim || claim.theater_id !== targetId || claim.status !== "pending") {
        // 受け付けられたかを確かめられない。申し込み中の表示（一覧の読み直し）で確かめてもらう
        console.error("[register] 引き継ぎの申し込みの応答の形が違う");
        setClaimResult(targetId, { status: "error", message: CLAIM_UNCONFIRMED_MESSAGE });
      } else {
        setClaimResult(targetId, {
          status: "sent",
          message: data?.already_pending === true ? CLAIM_ALREADY_PENDING_MESSAGE : CLAIM_SENT_MESSAGE,
        });
      }
      const loadSeq = ++claimsLoadSeq.current;
      const claims = await fetchMyClaims();
      if (claims && loadSeq === claimsLoadSeq.current) setMyClaims(claims);
    } catch (err) {
      console.error("[register] 引き継ぎの申し込みの通信に失敗", err);
      setClaimResult(targetId, { status: "error", message: CLAIM_NETWORK_MESSAGE });
    }
  };

  const cancelClaim = async (claim: ClaimSummary) => {
    if (
      !confirm(
        `『${claim.theater_name ?? "この劇団"}』の引き継ぎの申し込みを取り消します。よろしいですか？`
      )
    ) {
      return;
    }
    setCancelingClaimId(claim.id);
    setClaimNotice(null);
    try {
      const res = await fetch("/api/theater/claims", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claim_id: claim.id }),
      });
      const json: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const errorMessage = (json as { error?: { message?: unknown } } | null)?.error?.message;
        setClaimNotice({
          tone: "error",
          text: typeof errorMessage === "string" ? errorMessage : CLAIM_CANCEL_FAILED_MESSAGE,
        });
      } else {
        // 取り消す前に始まった一覧の取得の応答は使わない（取り消した行が戻らないように）
        claimsLoadSeq.current += 1;
        setMyClaims((prev) => prev.filter((item) => item.id !== claim.id));
        setClaimNotice({ tone: "ok", text: CLAIM_CANCELLED_MESSAGE });
        // 取り消した劇団の申し込み欄を開いていたら、もう一度申し込めるように戻す
        setClaimResult(claim.theater_id, null);
      }
    } catch (err) {
      console.error("[register] 引き継ぎの申し込みの取り消しの通信に失敗", err);
      setClaimNotice({ tone: "error", text: CLAIM_NETWORK_MESSAGE });
    } finally {
      setCancelingClaimId(null);
    }
  };

  const submitInvite = async () => {
    setInviteStatus("loading");
    setInviteMessage(null);
    const res = await fetch("/api/theater/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail }),
    });
    const json = (await res.json()) as {
      error?: { message: string };
    };
    if (!res.ok) {
      setInviteStatus("error");
      setInviteMessage(json.error?.message ?? "追加に失敗しました");
      return;
    }
    setInviteStatus("sent");
    setInviteMessage("メールを追加しました。");
    setInviteEmail("");

    // re-fetch latest state (counts and invites)
    try {
      const refreshed = await fetch("/api/theater/me", { cache: "no-store" });
      const refreshedJson = (await refreshed.json()) as MeResponse;
      setMe(refreshedJson.data ?? null);
      if (refreshedJson.data?.member?.role === "owner") {
        const membersRes = await fetch("/api/theater/members", {
          cache: "no-store",
        });
        if (membersRes.ok) {
          const membersJson = (await membersRes.json()) as {
            data?: { members: { user_id: string; role: string; email: string }[] };
          };
          setMembers(membersJson.data?.members ?? []);
        }
      } else {
        setMembers([]);
      }
    } catch {
      // ignore
    }
  };

  const removeInvite = async (inviteId: string) => {
    setInviteRemoveId(inviteId);
    setInviteMessage(null);
    const res = await fetch("/api/theater/invite", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inviteId }),
    });
    const json = (await res.json()) as { error?: { message: string } };
    if (!res.ok) {
      setInviteStatus("error");
      setInviteMessage(json.error?.message ?? "追加メールの削除に失敗しました");
      setInviteRemoveId(null);
      return;
    }
    setInviteStatus("sent");
    setInviteMessage("追加メールを削除しました。");
    setInviteRemoveId(null);
    try {
      const refreshed = await fetch("/api/theater/me", { cache: "no-store" });
      const refreshedJson = (await refreshed.json()) as MeResponse;
      setMe(refreshedJson.data ?? null);
    } catch {}
  };

  const removeMember = async (userId: string) => {
    setMemberRemoveId(userId);
    setInviteMessage(null);
    const res = await fetch("/api/theater/members", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    const json = (await res.json()) as { error?: { message: string } };
    if (!res.ok) {
      setInviteStatus("error");
      setInviteMessage(json.error?.message ?? "メンバーの削除に失敗しました");
      setMemberRemoveId(null);
      return;
    }
    setInviteStatus("sent");
    setInviteMessage("メンバーを削除しました。");
    setMemberRemoveId(null);
    try {
      const refreshed = await fetch("/api/theater/me", { cache: "no-store" });
      const refreshedJson = (await refreshed.json()) as MeResponse;
      setMe(refreshedJson.data ?? null);
      if (refreshedJson.data?.member?.role === "owner") {
        const membersRes = await fetch("/api/theater/members", {
          cache: "no-store",
        });
        if (membersRes.ok) {
          const membersJson = (await membersRes.json()) as {
            data?: { members: { user_id: string; role: string; email: string }[] };
          };
          setMembers(membersJson.data?.members ?? []);
        }
      }
    } catch {}
  };


  const pendingInvites =
    me?.invites?.filter((inv) => inv.status === "pending") ?? [];
  const totalInUse =
    (me?.stats?.memberCount ?? 0) + (me?.stats?.inviteCount ?? 0);
  const limitReached =
    me?.stats?.totalAllowed !== undefined &&
    totalInUse >= me.stats.totalAllowed;
  const pendingClaims = myClaims.filter((claim) => claim.status === "pending");
  // 開いている申し込み欄（劇団）の送信の状態
  const currentClaimResult = claimTarget ? claimResults[claimTarget.id] : undefined;
  const claimStatus = currentClaimResult?.status ?? "idle";
  const claimMessage = currentClaimResult?.message ?? null;
  const canSubmitClaim =
    claimForm.applicant_name.trim().length > 0 &&
    claimForm.role_note.trim().length > 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-10">
      <div className="card-retro p-7">
        <h1 className="font-display text-2xl">劇団アカウント登録 / ログイン</h1>
        <p className="mt-2 text-sm text-zinc-700">
          初めての方は「Googleでログイン」または「メールリンクでログイン」からアカウントを登録してください。その後は登録したアドレスからログインできます。
        </p>
        <p className="mt-2 text-sm text-zinc-700">
          大学演劇部・高校演劇部・学生プロデュース公演も大歓迎です。学生の劇団・サークルもぜひ登録してください。
        </p>
      </div>

      <div className="card-retro p-6 text-sm">
        <div className="text-xs font-black tracking-wide text-zinc-700">
          現在の状態
        </div>
        <div className="mt-2 font-medium">
          状態:{" "}
          {authState === "loggedIn"
            ? "ログイン中"
            : authState === "loggedOut"
            ? "ログアウト中"
            : "確認中"}
        </div>
        {userEmail && (
          <div className="mt-1 text-zinc-600">メール: {userEmail}</div>
        )}
        {meCheckStatus === "checking" && (
          <div className="mt-2 text-xs text-zinc-600">
            サーバー側の状態を確認しています...
          </div>
        )}
        {meCheckStatus === "error" && meCheckMessage && (
          <div className="mt-2 text-xs text-red-700">{meCheckMessage}</div>
        )}
        {userEmail && (
          <button
            onClick={async () => {
              await supabase.auth.signOut();
              location.href = "/register";
            }}
            className="btn-retro btn-surface mt-3 text-xs"
          >
            ログアウト
          </button>
        )}
      </div>

      {authState === "loggedIn" && me?.theater && (
        <div className="space-y-5">
          <div className="card-retro p-6 text-sm">
            <div className="text-xs font-black tracking-wide text-zinc-700">
              ログイン済み
            </div>
            <div className="mt-2 text-base font-semibold">
              劇団: {me.theater.name}
            </div>
            {Array.isArray(me.theaters) && me.theaters.length > 1 && (
              <div className="mt-2 text-xs text-zinc-700">
                管理可能な劇団: {me.theaters.length}件
              </div>
            )}
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <span className="badge-retro bg-secondary shadow-hard-sm">
                ステータス: {getTheaterStatusCopy(me.theater.status).label}
              </span>
              {me.stats && (
                <span className="badge-retro bg-surface shadow-hard-sm">
                  登録メール数: {totalInUse}/{me.stats.totalAllowed ?? 2}
                </span>
              )}
            </div>
            {me.joinedFromInvite && (
              <div className="mt-3 rounded-2xl border-2 border-ink bg-surface-muted px-3 py-2 text-xs text-zinc-700 shadow-hard-sm">
                追加済みメールで初回ログインしたため、劇団メンバーとして有効化しました。
              </div>
            )}
            <a href="/theater" className="link-retro mt-3 inline-block text-sm">
              劇団ダッシュボードへ
            </a>
          </div>

          {me.member?.role === "owner" ? (
            <div className="card-retro p-6 text-sm">
              <div className="font-display text-lg">メンバー管理</div>
              <p className="mt-1 text-xs text-zinc-700">
                追加 → 未確認 → 初回ログインで有効化、の流れです。メール送信は行いません。
              </p>

              <div className="mt-4 rounded-2xl border-2 border-ink bg-surface-muted p-4 shadow-hard-sm">
                <div className="text-sm font-black">
                  ログイン可能メールを追加
                </div>
                <p className="mt-1 text-xs text-zinc-600">
                  この劇団にログインできるメールは最大2件までです。
                </p>
                {me.stats && (
                  <p className="mt-1 text-xs text-zinc-500">
                    現在: {totalInUse}/{me.stats.totalAllowed ?? 2}
                  </p>
                )}
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input
                    className="input-retro flex-1"
                    placeholder="追加するメールアドレス"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    disabled={limitReached}
                  />
                  <button
                    onClick={submitInvite}
                    disabled={
                      !inviteEmail || inviteStatus === "loading" || limitReached
                    }
                    className="btn-retro btn-ink"
                  >
                    {inviteStatus === "loading" ? "追加中..." : "追加する"}
                  </button>
                </div>
                {limitReached && (
                  <p className="mt-2 text-xs text-red-700">
                    上限に達しています。未確認メールの削除またはメンバー削除で枠を空けてください。
                  </p>
                )}
                {inviteMessage && (
                  <p
                    className={`mt-2 text-xs ${
                      inviteStatus === "error"
                        ? "text-red-700"
                        : "text-green-700"
                    }`}
                  >
                    {inviteMessage}
                  </p>
                )}
              </div>

              {pendingInvites.length > 0 && (
                <div className="mt-4 space-y-2 text-xs text-zinc-700">
                  <div className="font-semibold">未確認の追加メール</div>
                  {pendingInvites.map((inv) => {
                    const copy = getInviteStatusCopy(inv.status);
                    return (
                      <div
                        key={inv.id}
                        className="rounded-2xl border-2 border-ink bg-surface px-3 py-2 shadow-hard-sm"
                      >
                        <div className="font-medium">{inv.email}</div>
                        <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-600">
                          <span
                            className={`badge-retro ${copy.bg} ${copy.tone}`}
                          >
                            {copy.label}
                          </span>
                          <button
                            onClick={() => removeInvite(inv.id)}
                            disabled={inviteRemoveId === inv.id}
                            className="text-red-700 underline disabled:opacity-50"
                          >
                            {inviteRemoveId === inv.id ? "削除中..." : "削除"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="mt-4 space-y-2 text-xs text-zinc-700">
                <div className="font-semibold">現在のメンバー</div>
                {members.length === 0 && (
                  <div className="rounded-2xl border-2 border-dashed border-ink bg-surface px-3 py-2 text-[12px] text-zinc-500 shadow-hard-sm">
                    まだメンバーは登録されていません。
                  </div>
                )}
                {members.map((m) => (
                  <div
                    key={m.user_id}
                    className="flex items-center justify-between rounded-2xl border-2 border-ink bg-surface px-3 py-2 shadow-hard-sm"
                  >
                    <div>
                      <div className="font-medium">{m.email}</div>
                      <div className="text-[11px] text-zinc-500">
                        役割: {m.role}
                      </div>
                    </div>
                    {m.role !== "owner" && (
                      <button
                        onClick={() => removeMember(m.user_id)}
                        disabled={memberRemoveId === m.user_id}
                        className="text-red-700 underline disabled:opacity-50"
                      >
                        {memberRemoveId === m.user_id ? "削除中..." : "削除"}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="card-retro p-6 text-sm text-zinc-700">
              メンバー管理はオーナーのみ操作できます。
            </div>
          )}
        </div>
      )}

      {authState === "loggedOut" && (
        <div className="space-y-4">
          <button onClick={signInWithGoogle} className="btn-retro btn-ink w-full">
            Googleでログイン
          </button>

          <div className="card-retro p-5">
            <label className="text-xs font-black tracking-wide text-zinc-700">
              メールアドレス
            </label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder="you@example.com"
              className="input-retro mt-2"
            />
            <button
              onClick={signInWithMagicLink}
              disabled={!email || status === "loading"}
              className="btn-retro btn-surface mt-3 w-full disabled:opacity-50"
            >
              {status === "loading" ? "送信中..." : "メールリンクでログイン"}
            </button>
            {status === "sent" && (
              <p className="mt-2 text-xs text-green-700">
                ログインリンクを送信しました。メールをご確認ください。
              </p>
            )}
          </div>

          {message && <p className="text-xs text-red-700">エラー: {message}</p>}
        </div>
      )}

      {authState === "loggedIn" && !me?.theater && me?.pendingInvite && (
        <div className="card-retro bg-secondary p-5 text-sm text-zinc-800">
          追加済みメールでログインしました。劇団メンバー登録を有効化しています…
          もしこのまま進まない場合は、ページを再読み込みするか、もう一度ログインしてください。
        </div>
      )}

      {authState === "loggedIn" && (pendingClaims.length > 0 || claimNotice) && (
        <div className="card-retro space-y-3 bg-secondary p-5 text-sm text-zinc-800">
          {pendingClaims.map((claim) => (
            <div
              key={claim.id}
              className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <p>
                『{claim.theater_name ?? "劇団"}』の引き継ぎを申し込み中です（{formatClaimDate(claim.created_at)}）。運営の確認をお待ちください。
              </p>
              <button
                type="button"
                onClick={() => cancelClaim(claim)}
                disabled={cancelingClaimId === claim.id}
                className="self-start text-xs text-red-700 underline disabled:opacity-50 sm:self-center"
              >
                {cancelingClaimId === claim.id ? "取り消し中..." : "申し込みを取り消す"}
              </button>
            </div>
          ))}
          {claimNotice && (
            <p
              className={`text-xs ${
                claimNotice.tone === "error" ? "text-red-700" : "text-green-700"
              }`}
            >
              {claimNotice.text}
            </p>
          )}
        </div>
      )}

      {authState === "loggedIn" && (
        <div className="card-retro p-6">
          <h2 className="font-display text-lg">劇団情報の登録 / 追加</h2>
          <p className="mt-1 text-sm text-zinc-700">
            1つのアカウントで複数の劇団を追加できます。追加後は /theater で
            操作対象の劇団を切り替えられます。
          </p>
          <div className="mt-4 space-y-3 text-sm">
            <input
              className="input-retro"
              placeholder="劇団名"
              value={onboardForm.name}
              onChange={(e) => {
                setOnboardForm({ ...onboardForm, name: e.target.value });
                onboardNameRef.current = e.target.value;
                // 劇団名を変えたら、前の名前の引き継ぎの申し込み欄は閉じる
                setClaimTarget(null);
              }}
            />
            <input
              className="input-retro"
              placeholder="連絡先メール"
              value={onboardForm.contact_email}
              onChange={(e) =>
                setOnboardForm({
                  ...onboardForm,
                  contact_email: e.target.value,
                })
              }
            />
            <input
              className="input-retro"
              placeholder="公式サイトURL（任意）"
              value={onboardForm.website_url}
              onChange={(e) =>
                setOnboardForm({
                  ...onboardForm,
                  website_url: e.target.value,
                })
              }
            />
            <textarea
              className="textarea-retro"
              placeholder="劇団紹介（任意）"
              value={onboardForm.description}
              onChange={(e) =>
                setOnboardForm({
                  ...onboardForm,
                  description: e.target.value,
                })
              }
            />
          </div>
          <button
            onClick={submitOnboarding}
            disabled={onboarding}
            className="btn-retro btn-ink mt-4 w-full disabled:opacity-50"
          >
            {onboarding ? "送信中..." : "劇団情報を送信"}
          </button>
          {onboardMessage && (
            <p className="mt-2 text-xs text-zinc-700">{onboardMessage}</p>
          )}
          {claimTarget && (
            <div className="mt-4 rounded-2xl border-2 border-ink bg-surface-muted p-4 text-sm shadow-hard-sm">
              <div className="text-sm font-black">
                「{claimTarget.name}」の引き継ぎを申し込む
              </div>
              {claimStatus !== "sent" && (
                <p className="mt-1 text-xs text-zinc-700">{claimTarget.message}</p>
              )}
              {claimStatus === "sent" ? (
                <p className="mt-3 text-xs text-green-700">{claimMessage}</p>
              ) : (
                <>
                  <div className="mt-3 space-y-3">
                    <input
                      className="input-retro"
                      placeholder="お名前"
                      maxLength={100}
                      value={claimForm.applicant_name}
                      onChange={(e) =>
                        setClaimForm({ ...claimForm, applicant_name: e.target.value })
                      }
                    />
                    <input
                      className="input-retro"
                      placeholder="劇団での立場（例：主宰、制作）"
                      maxLength={100}
                      value={claimForm.role_note}
                      onChange={(e) =>
                        setClaimForm({ ...claimForm, role_note: e.target.value })
                      }
                    />
                    <textarea
                      className="textarea-retro"
                      placeholder="ひとこと（任意）"
                      maxLength={1000}
                      value={claimForm.message}
                      onChange={(e) =>
                        setClaimForm({ ...claimForm, message: e.target.value })
                      }
                    />
                  </div>
                  <button
                    onClick={submitClaim}
                    disabled={claimStatus === "loading" || !canSubmitClaim}
                    className="btn-retro btn-ink mt-3 w-full disabled:opacity-50"
                  >
                    {claimStatus === "loading" ? "送信中..." : "引き継ぎを申し込む"}
                  </button>
                  {!canSubmitClaim && (
                    <p className="mt-2 text-xs text-zinc-600">
                      お名前と劇団での立場を入れると、申し込めます。
                    </p>
                  )}
                  {claimStatus === "error" && claimMessage && (
                    <p className="mt-2 text-xs text-red-700">{claimMessage}</p>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
