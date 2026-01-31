# 実装方針・手順書

**作成日**: 2026-01-31  
**最終更新日**: 2026-01-31  
**バージョン**: 1.0  

## 1. このドキュメントの位置付け

本書はMVP実装の具体手順をまとめる。

- 要件: `docs/01_requirements.md`
- アーキテクチャ: `docs/02_architecture.md`
- DB: `docs/03_database.md`
- API: `docs/04_api.md`
- サイトマップ/SEO: `docs/05_sitemap.md`
- デプロイ/運用: `docs/06_deployment.md`

UIプロトタイプは `fukuoka-stage---night's-coffee/stitch/` 配下に格納されている。実装ではデザイン/レイアウトは踏襲しつつ、**ユーザー向け文言は原則日本語**に統一する。

---

## 2. リポジトリ/実装の前提

現状 `fukuoka-stage---night's-coffee/` はViteプロトタイプ（`App.tsx` 等）を含む。MVP実装では Next.js 15（App Router）を正式実装とするため、以下いずれかを採用する：

1) **置き換え方式（推奨）**: 既存Vite資産は `prototype/` に退避し、ルートをNext.js構成へ変更  
2) **並存方式**: `apps/web` にNext.jsを新規作成し、Viteは参考として残す

以降の記述は「Next.js 15プロジェクト」を前提とする。

---

## 3. 環境変数（例）

最低限:
- `NEXT_PUBLIC_SITE_URL`（例: `https://fukuoka-stage.com`）
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`（PV集計・301・サーバー専用処理で使用）
- `GEMINI_API_KEY`（AI機能）
- `RECAPTCHA_SITE_KEY` / `RECAPTCHA_SECRET_KEY`（contact）
- `RESEND_API_KEY` / `CONTACT_TO_EMAIL` / `CONTACT_FROM_EMAIL`（contact送信）

---

## 4. Supabase セットアップ

### 4.1 Auth
- Provider:
  - Google OAuth（メイン）
  - Email Magic Link（保険）
- 劇団オンボーディング:
  - ログイン後、`theater_members` が無ければ `/register` で劇団情報入力へ誘導
  - 送信後は `theaters.status='pending'` の“審査中”画面へ遷移

### 4.2 Database
- `docs/03_database.md` のマイグレーションを適用（`theaters/theater_members/events/event_views_daily/event_redirects/promotions` 等）
- `UNIQUE(category, slug)` を必ず作成（URL衝突回避）
- RLS:
  - 公開公演は誰でも閲覧可
  - 劇団メンバーは自劇団の公演のみCRUD可
  - 未承認の劇団は `published` にできない（RLSで防ぐ）
  - `event_views_daily/event_redirects` は service_role のみ更新

### 4.3 Storage（方針）
- Bucket例:
  - `events`（チラシ/メイン画像）
  - `theaters`（ロゴ）
- ポリシー:
  - 劇団メンバーは自劇団のアップロードのみ許可（パス設計で分離するか、API経由の署名URLで制御）

---

## 5. Next.js 実装概要

### 5.1 ルーティング（公開）
- `/` トップ
- `/events` 公演一覧
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
- `/admin`（TinaCMS）

---

## 6. 公演詳細ページ（SEO + 301 + PV）

### 6.1 取得ロジック（category + slug）
- `events` から `status='published'` かつ `category/slug` で取得
- 取得できない場合:
  1) `event_redirects(from_category, from_slug)` を参照
  2) `to_event_id` があるなら、その公演の最新 `category/slug` へ **301** でリダイレクト
  3) 無ければ `notFound()`

### 6.2 構造化データ
- Event（TheaterEvent）JSON-LD
- BreadcrumbList JSON-LD

### 6.3 PV計測（直近30日）
- 公演詳細表示時に `POST /api/views` を呼び、`event_views_daily` と `events.views` を更新
- 二重カウント対策:
  - Cookie（例: `viewed:{event_id}:{YYYY-MM-DD}`）で1日1回程度に抑制
  - 追加でIP/UAレート制限（429）も実施

---

## 7. 公演一覧 / 人気順（直近30日PV）

### 7.1 直近30日PVの集計
- `event_views_daily` を `view_date >= CURRENT_DATE - 30` で合算し、`views_30d` を算出
- 一覧ソート（人気順）・トップのTRENDINGで使用

### 7.2 検索
- タイトル/劇団名/あらすじ:
  - MVP: ILIKE + pg_trgm（`docs/03_database.md` の任意マイグレーション）

---

## 8. 劇団ダッシュボード（/theater）

### 8.1 状態ゲート
- `theater_members` が無い → `/register`（オンボーディング）
- `theaters.status='pending'|'rejected'|'suspended'` → “審査中/停止中”画面（公開操作は不可）
- `approved` → 通常ダッシュボード

### 8.2 公演CRUD（events字段）
フォーム項目は `docs/03_database.md` の `events` 字段に一致させる。
- `category`, `slug`, `title`, `description`
- `start_date`, `end_date`
- `venue_id`, `venue`, `venue_address`, `venue_lat`, `venue_lng`
- `price_general`, `price_student`
- `tags`（text[]）
- `image_url`, `flyer_url`（Storage）
- `ticket_url`
- `cast`（JSONB配列: `{name, role, image_url}`）
- `status`（draft/published/archived）

### 8.3 URL変更時（301自動作成）
`category` または `slug` を変更した場合:
- 更新前の `(category, slug)` を `event_redirects(from_category, from_slug)` として保存
- 以降、旧URLは常に新URLへ301

### 8.4 削除
- 非公開（推奨）: `status='archived'`
- 完全削除: `DELETE events`（復元不可・強い確認）

---

## 9. API実装（Route Handlers）

詳細は `docs/04_api.md` を参照。実装時の注意点だけ記す。

- **AI/301/PV** は改ざん耐性のため、サーバーで `SUPABASE_SERVICE_ROLE_KEY` を使用してDB更新する
- 公演CRUDは基本RLSで守るが、URL変更時の `event_redirects` 作成は service_role に寄せる（クライアント直更新を禁止）

---

## 10. sitemap/robots（日次）

- `app/sitemap.ts`: `revalidate=86400`。公開ページのみを列挙
- `app/robots.ts`: `/admin /theater /register /api` を Disallow

---

## 11. UI文言（日本語化）方針

### 11.1 原則
- 公開サイト/劇団ダッシュボードの文言は **日本語**
- 英語はブランド名等に限定（例: FUKUOKA STAGE）
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
