export default function EventsByCategoryPage({
  params,
}: {
  params: { category: string };
}) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-2xl font-bold">
        カテゴリー別 公演一覧: {params.category}
      </h1>
      <p className="mt-2 text-sm text-zinc-600">
        `/events/[category]/` の公演一覧を実装予定。
      </p>
    </div>
  );
}

