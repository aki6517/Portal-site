# 実装方針・手順書

**作成日**: 2026-01-31  
**最終更新日**: 2026-11-27  
**バージョン**: 1.1  

## 1. このドキュメントの位置付け

本書はMVP実装の具体手順をまとめる。

- 要件: `docs/01_requirements.md`
- アーキテクチャ: `docs/02_architecture.md`
- DB: `docs/03_database.md`（SQLファイルの順番は `docs/sql/README.md`）
- API: `docs/04_api.md`
- サイトマップ/SEO: `docs/05_sitemap.md`
- デプロイ/運用: `docs/06_deployment.md`

UIプロトタイプは `stitch/` 配下に格納されている。実装ではデザイン/レイアウトは踏襲しつつ、**ユーザー向け文言は原則日本語**に統一する。

---

## 2. リポジトリ/実装の前提

リポジトリのルートが Next.js 16（App Router）+ React 19 のプロジェクト（`package.json`）。以降の記述はこの構成を前提とする。

---

## 3. 環境変数（例）

最低限:
- `NEXT_PUBLIC_SITE_URL`（例: `https://fukuoka-stage.com`）
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`（劇団向けAPIの書き込み・PV集計・旧URLの登録と転送・サーバー専用処理で使用）
- `GEMINI_API_KEY`（AI機能）
- `RECAPTCHA_SITE_KEY` / `RECAPTCHA_SECRET_KEY`（contact）
- `RESEND_API_KEY` / `CONTACT_TO_EMAIL` / `CONTACT_FROM_EMAIL`（contact送信）

任意:
- `VIEW_HASH_SECRET`（PVの閲覧者の印の HMAC の鍵。無ければ `SUPABASE_SERVICE_ROLE_KEY` を使う）
- `GEMINI_ANALYZE_MODELS`（チラシ解析のモデル。カンマ区切り。無ければ `gemini-4-hydrogen`,`gemini-3.8-flash`）

---

## 4. Supabase セットアップ

### 4.1 Auth
- Provider:
  - Google OAuth（メイン）
  - Email Magic Link（保険）
- 劇団オンボーディング:
  - ログイン後、`theater_members` が無ければ `/theater` は「劇団情報が未登録です」と `/register` への案内を出す
  - `/register` で劇団情報を送信すると、劇団は `theaters.status='approved'` で作られ（即承認）、すぐに公演を登録・公開できる
  - 2人目は、劇団の `owner` が `/register` でメールを追加し（招待）、そのメールでログインすると所属になる（`GET /api/theater/me` が受諾する）

### 4.2 Database
- 空のDBを作る順番（詳細は `docs/sql/README.md`）:
  1. `docs/sql/001_init.sql` → （任意）`002_seed_sample.sql` → `003_update_theater_rules.sql` → `004_site_settings.sql`
  2. `docs/sql/006_events_multivalue_fields.sql`・`007_events_staff_fields.sql`（`supabase/migrations/` に無いので手で流す）
  3. `supabase/migrations/` を古い順にすべて（`005` から）
  - `user_settings` 表と、`categories` の `action`・`drama`・`serious` の行は、リポジトリのSQLでは作られない（別に用意が要る）
- 本番に流すのは `supabase/migrations/`（`supabase db push --linked`）
- `UNIQUE(category, slug)` を必ず作成（URL衝突回避。`001_init.sql` の `uniq_events_category_slug`）
- 書き込みと RLS（`docs/03_database.md` の「6.」）:
  - 公開公演は誰でも閲覧可
  - 劇団メンバーの公演・劇団・招待の書き込みは、APIの中で確かめてから service_role で行う。RLS では劇団メンバーは書けない（書き込みのポリシーは運営者 `is_admin()` だけ）
  - 未承認の劇団は `published` にできない（APIが 403 で断る）
  - `event_views_daily`・`event_redirects`・`event_view_marks` は service_role だけが読み書き

### 4.3 Storage（方針）
- Bucket:
  - `flyers-public`（チラシ画像・表示画像。無ければ `flyers`）。パスは `flyers/{uuid}.{拡張子}`
  - アップロードは `POST /api/storage/flyers` が service_role で行う。バケットが無ければ公開バケット（jpg・png・webp、5MBまで）として作る
- チラシ解析（`/api/ai/analyze-flyer`）は、このサイトの Storage の `flyers-public`・`flyers` バケットの `flyers/` 以下の画像だけを読む

---

## 5. Next.js 実装概要

### 5.1 ルーティング（公開）
- `/` トップ
- `/events` 公演一覧
- `/events/archive` 過去公演
- `/events/[category]` カテゴリ別一覧
- `/events/[category]/[slug]` 公演詳細
- `/blog` `/blog/[slug]`（Tina）
- `/calendar`
- `/about` `/contact` `/privacy-policy`
- `/sitemap.xml`（`app/sitemap.ts`）
- `/robots.txt`（`app/robots.ts`）

### 5.2 ルーティング（noindex）
- `/register`（ログイン・オンボーディング）
- `/theater`（劇団ダッシュボード）
- `/admin`（運営者画面）

---

## 6. 公演詳細ページ（SEO + 308 + PV）

### 6.1 取得ロジック（category + slug）
`app/events/[category]/[slug]/page.tsx` と `lib/data/events.ts`。`categories`（2つ目からのカテゴリ）はURLを持たないタグとして扱う。
1. 主カテゴリが一致する公開中の公演（`status='published'` で、`publish_at` が空か過去）→ そのまま表示
2. `event_redirects(from_category, from_slug)` を参照し、`to_event_id` があれば、その公演の今の `category/slug` へ **308**（`permanentRedirect`）
   - 転送先の公演が下書き・非公開・公開日前なら 404
   - 転送先の今のURLがこのURLそのものなら、転送せずに 3 へ進む
3. 同じ英字（slug）の別カテゴリの公開中の公演（`categories` にこのカテゴリを含む公演が先）→ その公演の正式URLへ **308**
4. どれも無ければ `notFound()`（404）

- 公演の検索・転送の読み取りが失敗したときは「無い」と扱わずに例外にする（一時的な失敗で正式URLが別の公演へ 308 されたり、404 がキャッシュに残ったりしないようにするため）

### 6.2 構造化データ
- Event（TheaterEvent）JSON-LD
- BreadcrumbList JSON-LD

### 6.3 PV計測（直近30日）
- 公演詳細表示時に `ViewCounter` が `POST /api/views` を呼ぶ
- 二重カウント対策:
  - Cookie（`viewed_{category}_{slug}` に JST の日付）で、同じブラウザは1日1回だけ呼ぶ
  - サーバーでは DB関数 `record_event_view` が、同じ閲覧者（IP＋User-Agent＋日付の HMAC）・公演・日は1回だけ、同じ IP・公演・日は5回まで数え、数えたときだけ `event_views_daily` と `events.views` をDBの中で +1 する
  - `Content-Type: application/json` 以外は 415。メモリ上のレート制限（IP×公演で60回/分。超えると 429）もある

---

## 7. 公演一覧 / 人気順（直近30日PV）

### 7.1 直近30日PVの集計
- `event_views_daily` を直近30日で合算する（一覧の人気順は `lib/data/events.ts` の `getViews30Map`、トップのTRENDINGは関数 `trending_events`。無ければ同じ集計をJSで行う）
- `events.views`（累計）は人気順には使わない

### 7.2 検索
- 公演の検索は `title`・`venue`・`company` の ILIKE（`lib/search.ts` の `buildIlikeFilter`）。`pg_trgm` の索引は無い

---

## 8. 劇団ダッシュボード（/theater）

### 8.1 状態ゲート
- 未ログイン → ログインの案内（Google・メールリンク）
- `theater_members` が無い → 「劇団情報が未登録です」と `/register` への案内
- 所属がある → 通常ダッシュボード（選択中の劇団の公演一覧。複数の劇団に所属していれば切り替えられる）
- 劇団の `status` で画面は分けない。`approved` でない劇団が公開（`published`）しようとすると、APIが 403 と日本語の理由を返し、画面がそのまま表示する

### 8.2 公演CRUD（events字段）
フォーム（`app/theater/events/_components/EventForm.tsx`）が送る項目は `docs/03_database.md` の `events` 字段に一致させる。
- `category`（主カテゴリ＝選んだカテゴリの先頭。URLに使う）, `categories`（選んだカテゴリすべて。2つ目からは一覧の絞り込み用のタグ）
- `slug`（英小文字・数字・ハイフン、1〜80文字。`lib/event-slug.ts` で画面とAPIが同じ検査をする）, `title`, `description`, `playwright`, `director`
- `publish_at`, `start_date`, `end_date`, `schedule_times`
- `reservation_start_at`, `reservation_label`, `reservation_links`, `ticket_url`
- `venue`, `venue_address`（`venue_id` はAPIが会場名から自動で入れる）
- `price_general`, `price_student`（円の整数。券種の「一般」「学生」から入る）, `ticket_types`
- `tags`（text[]）
- `image_url`, `flyer_url`, `analysis_flyer_url`（Storage）
- `cast`（JSONB配列: `{name, role, image_url}`）
- `ai_confidence`, `superseded_by`（後継公演）
- `status`（draft/published/archived）

### 8.3 URL変更時（旧URLの登録）
`PATCH /api/theater/events/{id}` で主カテゴリの組 `(category, slug)` を変えた場合:
- 保存前の公演が公開ページに出ていた（`published` で、`publish_at` が空か過去）ときだけ、更新の前に、保存前の主カテゴリの組を `event_redirects(from_category, from_slug)` にこの公演への転送として登録する
- その組がすでにほかの公演への転送として登録されていれば、上書きしない（転送先が空の行だけ、この公演に向け直す）。`categories` の組は登録しない
- 以降、旧URLは新URLへ **308**（6.1 の 2）
- 保存後の組がほかの公演の旧URLなら 409（`SLUG_RESERVED`）、ほかの公演が使っていれば 409（URLの重複）で、何も書かない

### 8.4 削除
- 非公開（推奨）: `status='archived'`
- 完全削除: `DELETE events`（復元不可・強い確認）

---

## 9. API実装（Route Handlers）

詳細は `docs/04_api.md` を参照。実装時の注意点だけ記す。

- 劇団向けAPI・AI・PV・旧URLの登録は、サーバーで `SUPABASE_SERVICE_ROLE_KEY` を使ってDBを更新する。ログイン・所属・オーナーだけの操作・入力の形・ほかの公演の旧URLの予約・承認済みの劇団かは、ルートの中で確かめる
- RLS はブラウザから anon キーで直接書けないようにする最後の守り（劇団メンバーの書き込みポリシーは無い）
- 劇団向けの画面に出す `error.message` は日本語の決まった文にする。DBのエラー文は応答に出さず `console.error` に残す。プログラムの分岐は `error.code` と HTTPステータスで行う

---

## 10. sitemap/robots

- `app/sitemap.ts`: `revalidate=3600`。公開ページのみを列挙（公演は公開中・公開日到来・noindex でないもの）
- `app/robots.ts`: `/admin/ /theater/ /register/ /api/` を Disallow（GPTBot は `/calendar` も）

---

## 11. UI文言（日本語化）方針

### 11.1 原則
- 公開サイト/劇団ダッシュボードの文言は **日本語**
- 英語はブランド名等に限定（例: 福岡アクトポータル）
- `stitch/*/code.html` の英語文言は、実装時に日本語コピーへ置換する

### 11.2 推奨：コピー辞書の用意
実装では、UI文言を散らさず1箇所で管理する（例: `lib/copy/ja.ts`）。

### 11.3 英→日 置換例（最低限）
- Login / Sign in → ログイン
- Continue with Google → Googleでログイン
- Magic link / Email link → メールリンクでログイン
- Theater dashboard → 劇団ダッシュボード
- New event → 新規公演
- Draft → 下書き
- Publish / Published → 公開 / 公開中
- Archive / Archived → 非公開 / 非公開中
- Delete permanently → 完全削除
- Save → 保存
- Save draft → 下書き保存
- Next / Back → 次へ / 戻る
- Upload → アップロード
- Analyze (AI) → AIで解析
- Generate promotion → 宣伝文を生成
- Under review → 審査中
- Contact support → お問い合わせ
