import type { Metadata } from "next";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default function TheaterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-6">
        <h1 className="font-display text-3xl tracking-tight">
          劇団ダッシュボード
        </h1>
        <p className="mt-2 text-sm text-zinc-700">
          公演の作成・編集・非公開・削除を行う管理画面です。
        </p>
      </div>
      {children}
    </div>
  );
}
