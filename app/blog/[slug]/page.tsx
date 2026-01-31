export default function BlogDetailPage({
  params,
}: {
  params: { slug: string };
}) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-2xl font-bold">ブログ記事</h1>
      <p className="mt-2 text-sm text-zinc-600">slug: {params.slug}</p>
    </div>
  );
}

