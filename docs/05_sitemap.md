# サイトマップ設計書

## 1. サイト構造概要

### 1.1 階層設計（3階層以内）

```
/ (トップ)
├── /events/ (公演一覧)
│   └── /events/[category]/ (カテゴリー別 公演一覧)
│       └── /events/[category]/[slug]/ (個別公演詳細)
├── /blog/ (ブログ一覧)
│   └── /blog/[slug]/ (ブログ記事詳細)
├── /calendar/ (カレンダー)
├── /register/ (劇団ログイン・オンボーディング) ※noindex
├── /theater/ (劇団ダッシュボード) ※noindex
├── /about/ (運営者情報)
├── /contact/ (お問い合わせ)
├── /privacy-policy/ (プライバシーポリシー)
└── /admin/ (TinaCMS 管理画面) ※noindex
```

**方針**:
- SEO対象は公開ページのみ（`/events/*`, `/blog/*`、固定ページ）
- `register/theater/admin/api` は検索流入を狙わないため **noindex** とし、`robots.txt` でもクロール抑制

---

## 2. URL設計ルール

### 2.1 URLの基本
- シンプルで意味のある単語を使用
- ハイフン（`-`）で区切る（アンダースコアは使用しない）
- すべて小文字
- パラメータは最小限

### 2.2 `/events/[category]/[slug]` の仕様
- `category` は主カテゴリの `categories.id`（例: `comedy`, `musical`）。`events.categories`（2つ目からのカテゴリ）はURLを持たないタグで、一覧の絞り込みにだけ使う
- `slug` は劇団が公演フォームで入力する英字（例: `nights-coffee`）。英小文字・数字・ハイフンだけ、1〜80文字、先頭・末尾のハイフンと連続は不可（`lib/event-slug.ts`。画面とAPIで同じ検査）
- `(category, slug)` は一意（`uniq_events_category_slug`）。ほかの公演と重なる値・ほかの公演の旧URL（`event_redirects`）と重なる値は、APIが 409 で断る（自動で `-2` などは付けない）
- 公開中の公演の `category` または `slug` を変更してURLが変わる場合は、旧URLを `event_redirects` に登録し、**旧URL→新URLへ308** で転送する
- `/events/{2つ目からのカテゴリ}/{slug}` で開かれたときは、そのURLの転送（`event_redirects`）が無ければ、主カテゴリのURLへ308で送る

### 2.3 URL例

| ページ種類 | URL例 | 説明 |
|------------|-------|------|
| トップ | `https://fukuoka-stage.com/` | ルート |
| 公演一覧 | `https://fukuoka-stage.com/events/` | 全公演 |
| カテゴリー別 | `https://fukuoka-stage.com/events/comedy/` | コメディ公演 |
| 公演詳細 | `https://fukuoka-stage.com/events/comedy/nights-coffee/` | 「夜明けのコーヒー」 |
| ブログ一覧 | `https://fukuoka-stage.com/blog/` | 全記事 |
| ブログ詳細 | `https://fukuoka-stage.com/blog/fukuoka-theater-guide/` | 「福岡の劇場ガイド」 |
| カレンダー | `https://fukuoka-stage.com/calendar/` | 公演カレンダー |
| 劇団ログイン | `https://fukuoka-stage.com/register/` | ログイン/オンボーディング（noindex） |
| 劇団ダッシュボード | `https://fukuoka-stage.com/theater/` | 投稿・編集（noindex） |

---

## 3. ナビゲーション構造

### 3.1 グローバルナビゲーション（ヘッダー）

```
[ロゴ] 福岡アクトポータル
  ├─ 公演を探す (/events/)
  ├─ カレンダー (/calendar/)
  ├─ ブログ (/blog/)
  ├─ 劇団の方へ (/register/ または /theater/)
  └─ 運営者情報 (/about/)

[検索バー] 🔍 キーワード検索
```

**ログイン時の挙動**:
- 劇団ユーザーがログイン済みの場合、ヘッダーの「劇団の方へ」は `/theater/` に遷移
- 未ログインの場合は `/register/` に遷移

---

### 3.2 パンくずリスト（公演詳細ページ）

```
TOP > 公演を探す > コメディ > 夜明けのコーヒー
```

**JSON-LD（例）**:
```json
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "TOP", "item": "https://fukuoka-stage.com/" },
    { "@type": "ListItem", "position": 2, "name": "公演を探す", "item": "https://fukuoka-stage.com/events/" },
    { "@type": "ListItem", "position": 3, "name": "コメディ", "item": "https://fukuoka-stage.com/events/comedy/" },
    { "@type": "ListItem", "position": 4, "name": "夜明けのコーヒー", "item": "https://fukuoka-stage.com/events/comedy/nights-coffee/" }
  ]
}
```

---

## 4. sitemap.xml（動的生成）

### 4.1 方針
- Next.js（App Router）の `app/sitemap.ts` で生成
- 更新頻度は **1時間ごと**：`revalidate = 3600`（`app/sitemap.ts`）
- 生成対象は公開ページのみ
  - 公演一覧 `/events/`
  - カテゴリー別一覧 `/events/[category]/`
  - 公演詳細 `/events/[category]/[slug]/`（`status = 'published'` で、公開日が来ていて、noindex でないもの。URLは主カテゴリ）
  - ブログ `/blog/` `/blog/[slug]/`（TinaCMSのコンテンツ）
  - 固定ページ（/about, /contact, /privacy-policy）

### 4.2 実装例（概略）

```ts
// app/sitemap.ts
import type { MetadataRoute } from 'next'

export const revalidate = 3600

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // 1) categories を取得（Supabase）
  // 2) published events を取得（Supabase）
  // 3) blog slugs を取得（Tina content）
  // 4) 下記形式の配列を返す
  return [
    { url: 'https://fukuoka-stage.com/', changeFrequency: 'daily', priority: 1.0 },
    { url: 'https://fukuoka-stage.com/events/', changeFrequency: 'daily', priority: 0.9 },
    { url: 'https://fukuoka-stage.com/blog/', changeFrequency: 'weekly', priority: 0.8 },
    { url: 'https://fukuoka-stage.com/calendar/', changeFrequency: 'daily', priority: 0.7 },
    { url: 'https://fukuoka-stage.com/about/', changeFrequency: 'monthly', priority: 0.5 },
    { url: 'https://fukuoka-stage.com/contact/', changeFrequency: 'yearly', priority: 0.4 },
    { url: 'https://fukuoka-stage.com/privacy-policy/', changeFrequency: 'yearly', priority: 0.3 },
    // ... /events/[category]/ , /events/[category]/[slug] , /blog/[slug]
  ]
}
```

---

## 5. robots.txt

### 5.1 方針
- 公開ページはクロール許可
- 管理/投稿/認証/内部APIはクロール不要

```
# https://fukuoka-stage.com/robots.txt
User-agent: *
Allow: /
Disallow: /admin/
Disallow: /theater/
Disallow: /register/
Disallow: /api/

Sitemap: https://fukuoka-stage.com/sitemap.xml
```

---

## 6. ページ別メタデータ（SEO）例

### 6.1 公演詳細（`/events/[category]/[slug]/`）

```tsx
// app/events/[category]/[slug]/page.tsx
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const event = await getEventByCategorySlug(params.category, params.slug);

  return {
    title: `${event.title} | 福岡アクトポータル`,
    description:
      event.description
      || `${event.company}による公演「${event.title}」の詳細。開催日時、会場、料金、チケット予約はこちら。`,
    alternates: {
      canonical: `https://fukuoka-stage.com/events/${event.category}/${event.slug}/`,
    },
    openGraph: {
      title: event.title,
      description: event.description,
      url: `https://fukuoka-stage.com/events/${event.category}/${event.slug}/`,
      images: [{ url: event.image_url || event.flyer_url }],
      type: 'article',
    },
  };
}
```

---

## 7. 内部リンク戦略（要点）

### 7.1 トップページからのリンク
1. 「今の気分で選ぶ」
   - 笑い → `/events/comedy/`
   - 感動 → `/events/conversation/`
   - 思考 → `/events/experimental/`
2. ピックアップ（運営者が手動設定）
3. TRENDING
   - **直近30日PV上位** の公演へリンク

### 7.2 公演詳細ページからのリンク
- パンくず：`/events/` → `/events/[category]/` → 詳細
- 関連公演：同カテゴリ（or 同劇団）を最大3件

---

## 8. ページ遷移フロー例

### 8.1 気分から公演を探す

```
1. トップ（/）
  ↓
2. 「笑い」を選択
  ↓
3. コメディ公演一覧（/events/comedy/）
  ↓
4. 公演詳細（/events/comedy/nights-coffee/）
  ↓
5. チケット予約（外部サイト）
```

---

**作成日**: 2026-01-31  
**最終更新日**: 2026-11-27  
**バージョン**: 2.1  
**作成者**: Claude Code (AI Assistant)
