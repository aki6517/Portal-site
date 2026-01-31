export default function EventDetailPage({
  params,
}: {
  params: { category: string; slug: string };
}) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-2xl font-bold">公演詳細</h1>
      <p className="mt-2 text-sm text-zinc-600">
        category: {params.category} / slug: {params.slug}
      </p>
      <p className="mt-4 text-sm text-zinc-600">
        構造化データ／パンくず／関連公演／PV計測を実装予定。
      </p>
    </div>
  );
}

