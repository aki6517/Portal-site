export default function TheaterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">劇団ダッシュボード</h1>
        <p className="text-sm text-zinc-600">
          公演の作成・編集・非公開・削除を行う管理画面。
        </p>
      </div>
      {children}
    </div>
  );
}

