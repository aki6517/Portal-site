"use client"; // エラー画面（error.tsx）はクライアントコンポーネントである必要がある

import Link from "next/link";

// ページの描画中に例外が届いたとき（DB の一時エラーなど）に出す画面。
// ルートのレイアウト（ヘッダー・フッター）の内側に出る。
// エラーの中身（message・stack・digest）は画面に出さない（サーバーのログで見る）。
// 「もう一度試す」は retry()：サーバーのデータを取り直してから描き直す（reset() は取り直さない）。
export default function ErrorPage({ retry }: { retry: () => void }) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="card-retro p-6 md:p-8">
        <p className="heading-ja text-lg text-ink">
          ただいま情報を読み込めませんでした。少し時間をおいて、もう一度お試しください。
        </p>
        <div className="mt-6 flex flex-wrap gap-3 text-sm">
          <button
            type="button"
            onClick={() => retry()}
            className="btn-retro btn-ink"
          >
            もう一度試す
          </button>
          <Link href="/" className="btn-retro btn-surface">
            トップへ戻る
          </Link>
        </div>
      </div>
    </div>
  );
}
