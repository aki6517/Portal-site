"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function AdminTheatersError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[admin/theaters] Render error", {
      message: error.message,
      digest: error.digest,
    });
  }, [error]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <div className="rounded-2xl border-2 border-ink bg-surface p-6 shadow-hard">
        <h2 className="font-display text-2xl">劇団管理ページでエラーが発生しました</h2>
        <p className="mt-3 text-sm text-zinc-700">
          一時的な問題の可能性があります。再読み込みしても解消しない場合は運営にご連絡ください。
        </p>
        {error.digest && (
          <p className="mt-2 text-xs text-zinc-500">Digest: {error.digest}</p>
        )}
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={reset}
            className="btn-retro btn-ink"
          >
            再試行する
          </button>
          <Link href="/admin/contact" className="btn-retro btn-surface">
            お問い合わせ管理へ
          </Link>
        </div>
      </div>
    </div>
  );
}
