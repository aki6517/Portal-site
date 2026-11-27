"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  id: string;
  theaterName: string;
  email: string;
};

// app/api/admin/claims/[id] の応答。notification は「お知らせのメールを送る予定か」（送れたかどうかは応答のあとに決まる）
type ActionResponse = {
  data?: { notification?: "scheduled" | "not_configured"; superseded?: number };
  error?: { message?: string };
} | null;

// 引き継ぎの申し込み 1 件の「承認する」「見送る」（app/api/admin/claims/[id] を呼ぶ）
export default function ClaimActions({ id, theaterName, email }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState<"approve" | "reject" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // 処理が済んだら、結果の文（メールを送る予定か）を読めるように、一覧はすぐには読み直さない（「一覧を更新する」で読み直す）
  const [done, setDone] = useState(false);

  const run = async (action: "approve" | "reject") => {
    const question =
      action === "approve"
        ? `「${theaterName}」の代表として ${email} をつなぎます。同じ劇団へのほかの申し込みは見送りになります。よろしいですか？`
        : `「${theaterName}」への ${email} の申し込みを見送ります。よろしいですか？`;
    if (!window.confirm(question)) return;
    setSaving(action);
    setMessage(null);
    let res: Response;
    let json: ActionResponse = null;
    try {
      res = await fetch(`/api/admin/claims/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      json = (await res.json().catch(() => null)) as ActionResponse;
    } catch (error) {
      console.error("[admin/claims] 承認・見送りの通信に失敗", error);
      setMessage("通信に失敗しました。もう一度お試しください。");
      setSaving(null);
      return;
    }
    if (!res.ok) {
      setMessage(json?.error?.message ?? "更新に失敗しました。");
      setSaving(null);
      return;
    }
    const doneText = action === "approve" ? "承認しました。" : "見送りました。";
    const mail =
      json?.data?.notification === "scheduled"
        ? "お知らせのメールをこのあと送ります（届かなかったときはサーバーのログに残ります）。"
        : "メールの設定が無いため、お知らせは送れません。必要なら手で連絡してください。";
    const others =
      action === "approve" && (json?.data?.superseded ?? 0) > 0
        ? `同じ劇団へのほかの申し込み ${json?.data?.superseded} 件を見送りにしました（その人たちにもお知らせを送ります）。`
        : "";
    setMessage(`${doneText}${mail}${others}`);
    setSaving(null);
    setDone(true);
  };

  if (done) {
    return (
      <div className="flex max-w-xs flex-col items-end gap-2">
        <span className="text-right text-[11px] text-zinc-700">{message}</span>
        <button
          type="button"
          onClick={() => router.refresh()}
          className="rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-700"
        >
          一覧を更新する
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => run("approve")}
          disabled={saving !== null}
          className="rounded-md border border-zinc-900 bg-zinc-900 px-3 py-1 text-xs text-white disabled:opacity-50"
        >
          {saving === "approve" ? "承認中..." : "承認する"}
        </button>
        <button
          type="button"
          onClick={() => run("reject")}
          disabled={saving !== null}
          className="rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-700 disabled:opacity-50"
        >
          {saving === "reject" ? "見送り中..." : "見送る"}
        </button>
      </div>
      {message && <span className="text-[11px] text-zinc-600">{message}</span>}
    </div>
  );
}
