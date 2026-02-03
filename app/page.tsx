import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Brain,
  Calendar,
  Heart,
  Search,
  Smile,
  Sparkles,
  Drama,
} from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

type TrendingEvent = {
  id: string;
  title: string;
  category: string;
  slug: string;
  start_date: string;
  image_url?: string | null;
  flyer_url?: string | null;
};

type CategoryRow = {
  id: string;
  name: string;
  icon: string | null;
  sort_order?: number | null;
};

const formatDate = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
  }).format(date);
};

const getTrendingEvents = async () => {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const service = createSupabaseServiceClient();
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const sinceDate = since.toISOString().slice(0, 10);
    const { data: views } = await service
      .from("event_views_daily")
      .select("event_id, views")
      .gte("view_date", sinceDate);
    const map = new Map<string, number>();
    (views ?? []).forEach((row) => {
      const total = map.get(row.event_id) ?? 0;
      map.set(row.event_id, total + (row.views ?? 0));
    });
    const ranked = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    const ids = ranked.map(([id]) => id);
    if (ids.length === 0) return [];
    const { data: events } = await service
      .from("events")
      .select("id, title, category, slug, start_date, image_url, flyer_url")
      .eq("status", "published")
      .in("id", ids);
    const byId = new Map(events?.map((event) => [event.id, event]) ?? []);
    return ranked
      .map(([id]) => byId.get(id))
      .filter(Boolean) as TrendingEvent[];
  }

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("events")
    .select("id, title, category, slug, start_date, image_url, flyer_url")
    .eq("status", "published")
    .order("start_date", { ascending: true })
    .limit(3);
  return (data ?? []) as TrendingEvent[];
};

const getCategories = async () => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("categories")
    .select("id, name, icon, sort_order")
    .order("sort_order", { ascending: true })
    .limit(8);
  return (data ?? []) as CategoryRow[];
};

export default async function Home() {
  const [trending, categories] = await Promise.all([
    getTrendingEvents(),
    getCategories(),
  ]);
  const categoryMap = new Map(categories.map((category) => [category.id, category]));
  const featured = trending[0];
  const featuredImage = featured?.image_url || featured?.flyer_url || null;
  const featuredHref = featured
    ? `/events/${featured.category}/${featured.slug}`
    : "/events";
  const moodCards = [
    {
      title: "とにかく笑いたい",
      tags: "#コメディ #コント #爆笑",
      href: "/events/comedy",
      color: "bg-pop-yellow",
      icon: Smile,
      iconTone: "text-ink",
    },
    {
      title: "心を揺さぶりたい",
      tags: "#感動 #人間ドラマ #青春",
      href: "/events/conversation",
      color: "bg-pop-blue",
      icon: Heart,
      iconTone: "text-white",
    },
    {
      title: "没頭して考えたい",
      tags: "#サスペンス #社会派 #衝撃",
      href: "/events/experimental",
      color: "bg-pop-purple",
      icon: Brain,
      iconTone: "text-white",
    },
  ];
  const categoryPalette = [
    "bg-pop-yellow",
    "bg-pop-pink",
    "bg-pop-blue",
    "bg-pop-green",
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16">
      <section className="mt-2">
        <div className="card-retro p-6 md:p-8">
          <div className="flex items-center justify-center gap-2 text-center">
            <Sparkles size={20} className="text-pop-yellow" />
            <h2 className="font-display text-xl md:text-2xl">
              今、どんな気分？
            </h2>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {moodCards.map((card) => {
              const Icon = card.icon;
              return (
                <Link
                  key={card.title}
                  href={card.href}
                  className="group relative rounded-xl border-2 border-ink bg-white p-6 text-center shadow-hard-sm transition-all hover:-translate-y-1 hover-shadow-hard"
                >
                  <div
                    className={`absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink p-2 ${card.color} transition-transform group-hover:scale-110`}
                  >
                    <Icon size={22} className={card.iconTone} />
                  </div>
                  <h3 className="mt-4 font-display text-lg">{card.title}</h3>
                  <p className="mt-1 text-xs font-bold text-ink/60">
                    {card.tags}
                  </p>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      <section className="mt-8 md:mt-10">
        <div className="card-retro relative overflow-hidden p-6 md:p-12 shadow-hard-lg">
          <div className="absolute right-0 top-0 h-40 w-40 -translate-y-1/2 translate-x-1/2 rounded-full bg-pop-yellow blur-3xl opacity-20 md:h-64 md:w-64" />
          <div className="relative z-10 grid gap-8 md:gap-12 lg:grid-cols-2 lg:items-center">
            <div>
              <div className="mb-3 inline-block rounded-full border-2 border-ink bg-pop-pink px-3 py-1 text-[10px] font-black text-white shadow-hard-sm md:text-xs">
                NEW RELEASE
              </div>
              <h1 className="font-display text-4xl leading-none text-ink md:text-5xl lg:text-6xl">
                FUKUOKA
                <br />
                <span className="bg-[linear-gradient(90deg,var(--pop-blue),var(--pop-green))] bg-clip-text text-transparent">
                  ACT
                </span>
                <br />
                PORTAL.
              </h1>
              <p className="mt-4 text-sm font-bold leading-relaxed text-ink/70 md:text-base">
                福岡の演劇シーンを、もっとポップに。
                <br className="hidden md:inline" />
                今週末、あなたの心揺さぶる1ステージを見つけよう。
              </p>

              <form
                action="/events"
                method="get"
                className="mt-6 flex w-full flex-col gap-2 rounded-lg border-2 border-ink bg-paper p-2 shadow-hard sm:w-auto sm:flex-row"
              >
                <input
                  type="text"
                  name="q"
                  placeholder="キーワード検索..."
                  className="w-full bg-transparent px-3 py-2 text-sm font-bold text-ink outline-none placeholder:text-ink/30 sm:w-56"
                />
                <button
                  type="submit"
                  className="btn-retro btn-ink w-full px-4 py-2 text-sm sm:w-auto"
                >
                  <Search size={18} />
                  <span className="sm:hidden">検索</span>
                </button>
              </form>

              <div className="mt-4 flex flex-wrap gap-3 text-sm">
                <Link href="/events" className="btn-retro btn-ink">
                  公演を探す
                </Link>
                <Link href="/calendar" className="btn-retro btn-surface">
                  カレンダー
                </Link>
                <Link href="/blog" className="btn-retro btn-surface">
                  ブログ
                </Link>
              </div>
            </div>

            <Link href={featuredHref} className="group relative mt-4 lg:mt-0">
              <div className="absolute inset-0 translate-x-2 translate-y-2 rounded-xl bg-ink" />
              <div className="relative aspect-video overflow-hidden rounded-xl border-2 border-ink bg-white transition-transform group-hover:-translate-x-1 group-hover:-translate-y-1">
                {featuredImage ? (
                  <Image
                    src={featuredImage}
                    alt={featured?.title ?? "ピックアップ公演"}
                    fill
                    unoptimized
                    className="object-cover grayscale transition-all duration-500 group-hover:grayscale-0"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-surface-muted text-xs font-bold text-zinc-600">
                    公演画像を準備中
                  </div>
                )}
                <div className="absolute bottom-0 left-0 w-full bg-gradient-to-t from-black/80 to-transparent p-4 pt-12 text-white">
                  <span className="inline-block rounded border-2 border-ink bg-pop-yellow px-2 py-0.5 text-[10px] font-black text-ink shadow-hard-sm">
                    PICK UP
                  </span>
                  <h3 className="mt-2 font-display text-xl md:text-2xl">
                    {featured?.title ?? "最新の公演を準備中"}
                  </h3>
                  <p className="text-xs font-bold opacity-80 md:text-sm">
                    {featured?.start_date
                      ? formatDate(featured.start_date)
                      : "最新情報を更新してください"}
                  </p>
                </div>
              </div>
            </Link>
          </div>
        </div>
      </section>

      <section className="mt-12">
        <div className="mb-6 flex items-center gap-3 md:mb-8">
          <div className="h-3 w-3 rounded-full border-2 border-ink bg-pop-blue md:h-4 md:w-4" />
          <h2 className="font-display text-2xl text-ink md:text-3xl">
            CATEGORIES
          </h2>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
          {categories.map((category, index) => {
            const color = categoryPalette[index % categoryPalette.length];
            return (
              <Link
                key={category.id}
                href={`/events/${category.id}`}
                className="group rounded-lg border-2 border-ink bg-white p-4 text-center shadow-hard-sm transition-all hover:-translate-y-1 hover-shadow-hard md:p-6"
              >
                <span
                  className={`mb-2 inline-flex items-center justify-center rounded-full border-2 border-ink p-2 md:mb-3 md:p-3 ${color}`}
                >
                  {category.icon ? (
                    <span className="text-base">{category.icon}</span>
                  ) : (
                    <Drama size={20} className="text-ink md:h-6 md:w-6" />
                  )}
                </span>
                <div className="text-sm font-bold text-ink md:text-base">
                  {category.name}
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="mt-12">
        <div className="mb-6 flex items-end justify-between md:mb-8">
          <div className="flex items-center gap-3">
            <div className="h-3 w-3 rounded-full border-2 border-ink bg-pop-pink md:h-4 md:w-4" />
            <h2 className="font-display text-2xl text-ink md:text-3xl">
              TRENDING
            </h2>
          </div>
          <Link
            href="/events?sort=popular"
            className="flex items-center gap-1 border-b-2 border-ink pb-1 text-xs font-bold transition-colors hover:border-pop-blue hover:text-pop-blue"
          >
            VIEW ALL <ArrowRight size={12} />
          </Link>
        </div>

        {trending.length === 0 ? (
          <div className="card-retro p-6 text-sm text-zinc-700">
            直近30日PV上位の公演がここに表示されます。
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-3">
            {trending.map((event) => {
              const image = event.image_url || event.flyer_url;
              const categoryLabel =
                categoryMap.get(event.category)?.name ?? event.category;
              return (
                <Link
                  key={event.id}
                  href={`/events/${event.category}/${event.slug}`}
                  className="group cursor-pointer rounded-lg border-2 border-ink bg-white p-3 shadow-hard transition-all hover:-translate-y-1 hover-shadow-hard-lg"
                >
                  <div className="relative mb-4 aspect-[4/3] overflow-hidden rounded border-2 border-ink bg-surface-muted">
                    {image ? (
                      <Image
                        src={image}
                        alt={event.title}
                        fill
                        unoptimized
                        className="object-cover grayscale transition-all duration-500 group-hover:grayscale-0"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs font-bold text-zinc-600">
                        画像準備中
                      </div>
                    )}
                    <div className="absolute right-2 top-2 rounded border border-ink bg-pop-yellow px-2 py-1 text-[10px] font-bold text-ink shadow-hard-sm">
                      {categoryLabel}
                    </div>
                  </div>
                  <h3 className="font-display text-xl leading-tight transition-colors group-hover:text-pop-pink">
                    {event.title}
                  </h3>
                  <p className="mb-3 text-xs font-bold text-ink/60">
                    {categoryLabel}
                  </p>
                  <div className="flex items-center justify-between border-t-2 border-dashed border-zinc-200 pt-3">
                    <div className="flex items-center gap-1 text-xs font-bold text-ink/70">
                      <Calendar size={12} /> {formatDate(event.start_date)}
                    </div>
                    <div className="rounded-sm bg-ink px-2 py-1 text-xs font-bold text-white">
                      予約可
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <section className="mt-12 rounded-2xl border-2 border-ink bg-white p-8 shadow-hard-lg">
        <div className="grid gap-6 md:grid-cols-[1.2fr_1fr] md:items-center">
          <div>
            <h2 className="font-display text-2xl">劇団の方へ</h2>
            <p className="mt-2 text-sm text-ink/70">
              ログイン後、劇団情報を登録すると公演の作成・編集ができます。
            </p>
            <div className="mt-4 flex flex-wrap gap-3 text-sm">
              <Link href="/register" className="btn-retro btn-ink">
                ログイン / 登録
              </Link>
              <Link href="/theater" className="btn-retro btn-surface">
                劇団ダッシュボード
              </Link>
            </div>
          </div>
          <ol className="space-y-3 text-sm text-zinc-800">
            <li className="rounded-xl border-2 border-ink bg-surface px-4 py-3 shadow-hard-sm">
              1. Google またはメールリンクでログイン
            </li>
            <li className="rounded-xl border-2 border-ink bg-surface px-4 py-3 shadow-hard-sm">
              2. 劇団情報を登録（すぐに公演作成が可能）
            </li>
            <li className="rounded-xl border-2 border-ink bg-surface px-4 py-3 shadow-hard-sm">
              3. 公演を作成 → 公開（下書き/非公開もOK）
            </li>
          </ol>
        </div>
      </section>
    </div>
  );
}
