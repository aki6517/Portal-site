import Link from "next/link";

export default function Home() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <section className="rounded-2xl border border-zinc-200 bg-zinc-50 p-8">
        <h1 className="text-3xl font-bold">FUKUOKA STAGE</h1>
        <p className="mt-3 text-sm text-zinc-600">
          福岡の演劇公演を「今の気分」で探せるポータルサイト。
        </p>
        <div className="mt-6 flex flex-wrap gap-3 text-sm">
          <Link
            href="/events"
            className="rounded-full border border-zinc-900 px-4 py-2 font-medium hover:bg-zinc-900 hover:text-white"
          >
            公演を探す
          </Link>
          <Link
            href="/calendar"
            className="rounded-full border border-zinc-200 px-4 py-2 hover:bg-white"
          >
            カレンダー
          </Link>
          <Link
            href="/blog"
            className="rounded-full border border-zinc-200 px-4 py-2 hover:bg-white"
          >
            ブログ
          </Link>
        </div>
      </section>

      <section className="mt-10 grid gap-6 md:grid-cols-3">
        <div className="rounded-xl border border-zinc-200 p-6">
          <h2 className="text-lg font-semibold">今の気分で選ぶ</h2>
          <p className="mt-2 text-sm text-zinc-600">
            笑い / 感動 / 思考 から公演を探す導線を実装予定。
          </p>
        </div>
        <div className="rounded-xl border border-zinc-200 p-6">
          <h2 className="text-lg font-semibold">注目の公演</h2>
          <p className="mt-2 text-sm text-zinc-600">
            運営者がピックアップする3公演を表示予定。
          </p>
        </div>
        <div className="rounded-xl border border-zinc-200 p-6">
          <h2 className="text-lg font-semibold">TRENDING</h2>
          <p className="mt-2 text-sm text-zinc-600">
            直近30日PV上位の公演を表示予定。
          </p>
        </div>
      </section>
    </div>
  );
}
