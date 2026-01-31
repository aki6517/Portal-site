# 実装計画書

**作成日**: 2026-01-31  
**最終更新日**: 2026-01-31  
**バージョン**: 1.0  

## 1. 目的

福岡演劇公演ポータル「FUKUOKA STAGE」を、要件定義（`docs/01_requirements.md`）・アーキテクチャ（`docs/02_architecture.md`）・DB（`docs/03_database.md`）・API（`docs/04_api.md`）に整合する形でMVP実装する。

---

## 2. スコープ（MVP）

### 2.1 公開サイト（SEO対象）
- トップ（気分導線、ピックアップ、TRENDING=直近30日PV上位）
- 公演一覧（検索/フィルタ/ソート：開催日/人気=30日PV）
- カテゴリー別公演一覧（`/events/[category]/`）
- 公演詳細（`/events/[category]/[slug]/`、構造化データ、パンくず）
- ブログ（TinaCMS：一覧/詳細）
- カレンダー（FullCalendar）
- 固定（about/contact/privacy-policy）
- sitemap.xml（動的・日次更新）/ robots.txt

### 2.2 劇団向け機能（noindex）
- 認証（Supabase Auth：Google OAuth + Magic Link）
- 劇団オンボーディング（劇団情報入力 → 運営者承認）
- 劇団ダッシュボード（自劇団の公演管理）
- 公演CRUD（作成/編集/非公開（archived）/完全削除）
- AI：チラシ解析、SNS宣伝文生成（promotions保存）

### 2.3 SEO維持
- category/slug変更時の301リダイレクト（event_redirects）
- canonical/OGP/メタデータ整備

---

## 3. 非スコープ（後回し）
- 会員向けお気に入り・通知
- レビュー/評価
- 多言語対応（UIは日本語が基本）
- チケット販売内製化（Stripe）

---

## 4. 前提・決定事項（重要）

- URL: `/events/[category]/[slug]/`
- 人気順: 直近30日PV（`event_views_daily`）
- 劇団承認: 劇団アカウント（`theaters.status`）のみ承認フローあり。公演承認は無し
- `register/theater/admin/api` は noindex + robotsで抑制
- UIプロトタイプ: `fukuoka-stage---night's-coffee/stitch/`（実装時は **英語文言を日本語へ置換**）

---

## 5. マイルストーン（目安）

### Phase 0: 事前準備（1〜2日）
- Next.js 15プロジェクト初期化（既存Viteプロトタイプの扱いを決める）
- Tailwind・Lint/Format・環境変数整備
- Supabaseプロジェクト作成、Auth/Storage/DBの初期設定

### Phase 1: 公開サイト（1〜2週間）
- 公演一覧/詳細/カテゴリ（SEO・構造化データ含む）
- ブログ（TinaCMS）
- カレンダー

### Phase 2: 劇団機能（1〜2週間）
- 認証（Google+Magic Link）
- オンボーディング（theaters/theater_members）
- ダッシュボード（公演CRUD、画像アップロード）
- AI（解析・宣伝文）

### Phase 3: SEO/運用仕上げ（3〜5日）
- PV計測（event_views_daily）
- TRENDING/人気順の実装
- 301リダイレクト（event_redirects）
- sitemap/robotsの最終調整、Search Console導線

### Phase 4: テスト/リリース（3〜5日）
- Playwright E2E（最小）
- Lighthouse/PageSpeed/OGP確認
- Vercel本番デプロイ

---

## 6. 実装タスク（WBS）

### 6.1 基盤
- [ ] Next.js 15（App Router）初期化、Tailwind導入
- [ ] 環境変数設計（Supabase、Gemini、reCAPTCHA、サイトURL）
- [ ] Supabase migrations（`docs/03_database.md`）適用
- [ ] Storageバケット/ポリシー（theaters/events等）設定

### 6.2 認証・劇団オンボーディング
- [ ] `/register`：Google OAuth + Magic Link UI（日本語文言）
- [ ] 劇団オンボーディングAPI（`POST /api/theater/onboard`）
- [ ] `theaters.status` による公開制御（RLS + UIゲート）
- [ ] （運用）運営者が劇団承認する手順（Supabase Studio or 最小Admin UI）

### 6.3 公演CRUD（/theater）
- [ ] `/theater` ダッシュボード（自劇団の公演一覧、30日PV表示）
- [ ] `/theater/events/new`：ウィザード（画像→基本→日程/会場→詳細/公開）
- [ ] `/theater/events/[id]`：編集/非公開/削除（危険操作の確認）
- [ ] category/slug変更時の301作成（`event_redirects`）

### 6.4 公開サイト（/events）
- [ ] `/events`：一覧、検索、フィルタ、ソート（人気=30日PV）
- [ ] `/events/[category]`：カテゴリ別一覧
- [ ] `/events/[category]/[slug]`：詳細、JSON-LD、パンくず、関連公演
- [ ] 301リダイレクト解決（旧URL→新URL）

### 6.5 PV計測
- [ ] `POST /api/views`：日次集計（`event_views_daily`）＋総PV（`events.views`）更新
- [ ] 直近30日PVの集計クエリ/ビュー（一覧用）

### 6.6 ブログ（TinaCMS）
- [ ] `/admin`（Tina）セットアップ、記事作成フロー
- [ ] `/blog`、`/blog/[slug]`（一覧/詳細、SEO）

### 6.7 AI
- [ ] `POST /api/ai/analyze-flyer`（Gemini Vision）
- [ ] `POST /api/ai/generate-promotion`（promotions作成）
- [ ] 失敗/再実行/信頼度（ai_confidence）UX

### 6.8 SEO/インデックス
- [ ] `app/sitemap.ts`（日次、公開ページのみ）
- [ ] `app/robots.ts`（/admin /theater /register /api をDisallow）
- [ ] canonical/OGP/メタデータの統一

### 6.9 テスト・品質
- [ ] E2E（ログイン→オンボード→公演作成→公開→詳細閲覧）
- [ ] アクセシビリティ（フォーム、モーダル、色コントラスト）
- [ ] エラー/ログ（Sentry等は任意）

---

## 7. Definition of Done（完了条件）

### 公演詳細
- `/events/[category]/[slug]` がSSR/SSGで生成され、JSON-LD（Event + BreadcrumbList）が付く
- 旧URLが存在する場合、301で新URLへリダイレクトされる

### 劇団ダッシュボード
- 劇団がログインし、オンボーディング完了後に公演の作成/編集/非公開/削除ができる
- 未承認の劇団は `published` にできない（UIで理由提示、RLSでも防ぐ）

### 人気順
- 直近30日PVが一覧・TRENDINGに反映される（`event_views_daily`）

---

## 8. リスクと対策（実装視点）
- PV改ざん：`event_views_daily` は service_role 経由更新＋レート制限＋簡易デデュープ
- 画像アップロード：Storageポリシー/パス設計が曖昧だと詰む → 先に決める
- 301リダイレクト：UIでのURL変更が多いと事故る → 変更時は必ずリダイレクトを自動作成
- UI英語混在：`stitch`は参考、実装では日本語コピー辞書を持って統一

