# 福岡演劇公演ポータルサイト「福岡アクトポータル」要件定義書

## 1. プロジェクト概要

### 1.1 目的
福岡の演劇シーンを活性化し、ユーザーが「今の気分」で気軽に公演を探せるポータルサイトを構築する。演劇を身近にし、劇団と観客をつなぐプラットフォームとして機能させる。

### 1.2 ターゲットユーザー
- **プライマリ**: 福岡エリアの演劇愛好家（20代〜50代）
- **セカンダリ**: 福岡の劇団関係者、公演主催者

### 1.3 運営者
万能グローブガラパゴスダイナモス（福岡の劇団）

### 1.4 解決する課題
- 演劇公演の情報が散在しており、一元的に探しにくい
- 「今の気分」に合った公演を直感的に見つけられない
- 劇団側も効率的に宣伝できるプラットフォームが必要

---

## 2. 技術要件（SEO最適化重視）

### 2.1 技術スタック

#### フロントエンド
- **Next.js 15** (App Router)
  - Server-Side Rendering (SSR) でSEO最適化
  - Static Site Generation (SSG) で高速化
  - Image Optimization（next/image）
- **TypeScript**: 型安全性とコード品質向上
- **Tailwind CSS**: ユーティリティファーストCSSフレームワーク
- **React 19**: UIライブラリ

#### バックエンド・API
- **Next.js API Routes**: サーバーレス API（Edge Functions）
- **Supabase Edge Functions**: データベース処理、認証、ストレージ

#### データベース
- **Supabase (PostgreSQL)**
  - Row Level Security（RLS）によるセキュリティ
  - リアルタイムAPI
  - 無料プランで開始（500MB DB、1GB ストレージ）

#### CMS
- **TinaCMS**
  - Git-based CMS（コンテンツはGitリポジトリで管理）
  - リアルタイムプレビュー
  - `/admin`でWordPress風の管理画面を提供
  - 無料プラン（2ユーザー、無制限コンテンツ）

#### AI機能
- **Gemini 2.5 Flash**: チラシ画像解析（メイン、90-95%精度）
- **Gemini 2.5 Pro**: チラシ画像解析（フォールバック、95-98%精度、信頼度<80%時）
- **Gemini 3.0 Flash**: SNS宣伝文自動生成

#### カレンダー
- **FullCalendar**: オープンソースのカレンダーライブラリ

#### インフラ
- **Vercel**: Next.jsホスティング（Pro: ¥3,000/月）
- **Supabase**: データベース＋認証＋ストレージ（Free: ¥0/月、将来Pro: ¥3,750/月）
- **Cloudflare**: DNS＋CDN（無料）
- **SSL/TLS証明書**: Vercelが自動提供（Let's Encrypt）

#### 開発ワークフロー
- **Git**: バージョン管理（GitHub）
- **GitHub Actions**: CI/CD（自動テスト、デプロイ）
- **Vercel自動デプロイ**: `git push` → 自動ビルド → デプロイ

#### 月額コスト
| 項目 | 月額 |
|------|------|
| Gemini API（チラシ解析＋SNS生成） | ¥3-5 |
| Vercel Pro | ¥3,000 |
| Supabase Free | ¥0 |
| TinaCMS Free | ¥0 |
| ドメイン | ¥150 |
| **合計** | **¥3,150-3,155/月** |

### 2.2 Google SEO準拠要件（最重要）

#### 2.2.1 サイト構造
1. **論理的な階層構造**（3階層以内）
   ```
   / (トップ)
   ├── /events/ (公演一覧)
   │   ├── /events/[category]/ (カテゴリ別 公演一覧)
   │   └── /events/[category]/[slug]/ (個別公演詳細)
   ├── /blog/ (ブログ一覧)
   │   └── /blog/[slug]/ (ブログ記事詳細)
   ├── /register/ (劇団ログイン・登録導線)
   ├── /theater/ (劇団ダッシュボード: 公演投稿・編集) ※要ログイン
   ├── /about/ (運営者情報)
   ├── /contact/ (お問い合わせ)
   └── /privacy-policy/ (プライバシーポリシー)
   ```

2. **URL設計規則**（Google推奨）
   - シンプルで意味のある単語を使用
   - ハイフン（`-`）で区切る（アンダースコアは使用しない）
   - 全て小文字
   - パラメータは最小限に
   - 例: `https://fukuoka-stage.com/events/comedy/nights-coffee/`
   - **slugの一意性**:
     - ルーティングが`/events/[category]/[slug]`のため、`(category, slug)`の組み合わせは全公演で一意であること
     - 競合時は自動で`-2`等のサフィックスを付与し、URL衝突を回避する
   - **URL変更時のSEO維持**:
     - `category` または `slug` の変更でURLが変わる場合、旧URL → 新URLへ **301リダイレクト**を作成する
     - canonical は常に新URLを指すこと

#### 2.2.2 構造化マークアップ（Schema.org）
すべてのページに適切なJSON-LD形式の構造化データを実装：

1. **公演詳細ページ**: Event Schema
   ```json
   {
     "@context": "https://schema.org",
     "@type": "Event",
     "name": "公演タイトル",
     "startDate": "2025-05-20T19:00",
     "endDate": "2025-05-22T21:00",
     "location": {
       "@type": "Place",
       "name": "ぽんプラザホール",
       "address": {
         "@type": "PostalAddress",
         "streetAddress": "博多区祇園町8-3",
         "addressLocality": "福岡市",
         "addressRegion": "福岡県",
         "postalCode": "812-0038",
         "addressCountry": "JP"
       }
     },
	     "offers": {
	       "@type": "Offer",
	       "price": "2500",
	       "priceCurrency": "JPY",
	       "url": "https://fukuoka-stage.com/events/comedy/nights-coffee/",
	       "availability": "https://schema.org/InStock"
	     },
     "performer": {
       "@type": "PerformingGroup",
       "name": "劇団名"
     }
   }
   ```

2. **パンくずリスト**: BreadcrumbList Schema（全ページ）
3. **組織情報**: Organization Schema（トップページ、Aboutページ）
4. **ブログ記事**: Article Schema（ブログ詳細ページ）

#### 2.2.3 HTML最適化
1. **タイトルタグ**:
   - 各ページ固有
   - 60文字以内
   - 主要キーワードを前方に配置
   - 形式: `[ページタイトル] | 福岡アクトポータル - 福岡演劇公演ポータル`

2. **メタディスクリプション**:
   - 各ページ固有
   - 155文字以内
   - 1-2文の簡潔な説明
   - アクションを促す文言を含む

3. **headタグ内の有効性**:
   - `<title>`, `<meta>`, `<link>`, `<script>`, `<style>`のみ
   - 無効な要素（`<iframe>`, `<img>`等）は配置しない

4. **セマンティックHTML**:
   - 見出しタグ（h1〜h6）の論理的な階層
   - h1は1ページに1つ
   - リスト（`<ul>`, `<ol>`）の適切な使用
   - テーブル（`<table>`）は表形式データのみに使用

5. **画像最適化**:
   - すべての画像に`alt`属性（具体的で簡潔な説明）
   - WebP形式の使用（フォールバックあり）
   - `loading="lazy"`の適用（ファーストビュー外の画像）
   - レスポンシブ画像（`srcset`, `sizes`）

6. **ロゴのテキスト化**:
   - ロゴは画像のみに依存せず、テキストレイヤーも含める
   - SVGロゴ（テキスト要素を含む）または CSS + Webフォント
   - 画像ロゴの場合も、`alt`属性に「福岡アクトポータル - 福岡演劇公演ポータル」を明記
   - Googleがロゴのテキスト内容を確実に認識できるようにする

#### 2.2.4 リンク構造
1. **クロール可能なリンク**:
   - すべてのリンクは`<a href="">`形式
   - JavaScriptのみのリンクは使用しない（`onclick`のみは不可）
   - フラグメント（`#`）をルーティングに使用しない

2. **外部リンク**:
   - 万能グローブガラパゴスダイナモス公式サイトへのリンク
   - `rel="noopener"`属性を付与

3. **内部リンク**:
   - 関連公演へのリンク
   - カテゴリーページへのリンク
   - ブログ記事間の相互リンク

#### 2.2.5 パフォーマンス最適化
**目標**: PageSpeed Insights スコア 90点以上

1. **画像最適化**:
   - WebP形式（JPEG/PNGフォールバック）
   - 適切なサイズ調整（レスポンシブ）
   - lazy loading

2. **CSS/JS最適化**:
   - CSSの最小化（minify）
   - クリティカルCSSのインライン化
   - JSの遅延読み込み（defer, async）
   - 不要なプラグインの削除

3. **キャッシュ設定**:
   - ブラウザキャッシュ
   - Vercel/Cloudflare のCDNキャッシュ活用（静的アセット）
   - Next.js のキャッシュ機構（Route Cache / Data Cache / ISR等）の適切な利用

4. **フォント最適化**:
   - システムフォントの優先使用
   - Webフォント使用時は`font-display: swap`

#### 2.2.6 クロール・インデックス最適化
1. **robots.txt**:
   ```
   User-agent: *
   Disallow: /admin/
   Disallow: /theater/
   Disallow: /api/
   Allow: /

   Sitemap: https://fukuoka-stage.com/sitemap.xml
   ```

2. **XMLサイトマップ**:
   - Next.js（App Router）の`app/sitemap.ts`で生成（推奨）
   - 最大50,000URL
   - 優先度、更新頻度の設定
   - **更新頻度**: 日次で十分（24hキャッシュ/再生成）

3. **canonicalタグ**:
   - すべてのページに正規URLを指定（Next.js Metadataで管理）
   - 重複コンテンツの回避

4. **noindexタグ**:
   - 管理画面（`/admin/`, `/theater/`）、APIエンドポイントには`noindex`

---

## 3. 機能要件

### 3.1 MVP機能（Phase 1: 必須）

#### 3.1.1 トップページ（`/`）
1. **「今の気分で選ぶ」セクション**（サイズ控えめ）:
   - 3つの選択肢: 笑い / 感動 / 思考
   - アイコンとタイトルのみのシンプルなデザイン
   - クリックで該当カテゴリーの公演一覧へ遷移

2. **「注目の公演」ピックアップ欄**（新規追加）:
   - 3つの公演を広告枠として表示
   - サムネイル画像、タイトル、日付
   - 運営者が手動で設定可能（管理用UI または Supabase Studio）

3. **キーワード検索バー**:
   - 公演タイトル、劇団名、タグで検索
   - 検索結果ページへ遷移

4. **カテゴリー一覧**:
   - コメディ、会話劇、ミュージカル、古典・時代劇、ダンス、学生演劇、コント、実験的
   - アイコン付きのグリッド表示

5. **TRENDING（注目の公演）**:
   - **人気の公演（PV上位）を3つ表示**
   - **人気順の定義**: 直近30日間のPV
   - カード形式（画像、タイトル、劇団名、日付）

#### 3.1.2 公演一覧ページ（`/events/`）
1. **公演リスト**:
   - グリッド/リスト表示切替
   - 各公演カード: 画像、タイトル、劇団名、日付、場所、料金、カテゴリータグ

2. **フィルター機能**:
   - 期間フィルター: すべて / 今週末 / 来月
   - カテゴリーフィルター
   - 料金フィルター（スライダー）

3. **ソート機能**:
   - 開催日順（デフォルト）
   - 人気順（直近30日PV）
   - 料金の安い順/高い順

4. **ページネーション**:
   - 1ページあたり12件表示
   - 番号付きページネーション

#### 3.1.3 公演詳細ページ（`/events/[category]/[slug]/`）
1. **パンくずリスト**:
   - TOP > 公演一覧 > カテゴリー > 公演タイトル

2. **ヒーローセクション**:
   - メインビジュアル（大きめの画像）
   - 公演タイトル（h1）
   - カテゴリータグ
   - 「笑い度」「エモさ」などの感情タグ

3. **公演情報**:
   - 開催日時
   - 開催場所（Googleマップ埋め込み）
   - 料金（一般、学生）
   - 主催劇団名

4. **ストーリー**:
   - あらすじ（400文字程度）

5. **キャスト情報**:
   - キャスト一覧（写真、名前、役名）

6. **チケット情報（サイドバー）**:
   - 予約ボタン（CoRich等の外部サイトへのリンク）
   - SNSシェアボタン（Twitter/X、LINE）

7. **関連公演**:
   - 同じカテゴリーの公演を3つ表示

#### 3.1.4 ブログ機能（`/blog/`、`/blog/[slug]/`）
1. **ブログ一覧ページ**（`/blog/`）:
   - 記事リスト（カード形式）
   - カテゴリーフィルター
   - タグクラウド
   - ページネーション

2. **ブログ詳細ページ**（`/blog/[slug]/`）:
   - パンくずリスト
   - 記事タイトル（h1）
   - 公開日、更新日
   - カテゴリー、タグ
   - 本文
   - 著者情報
   - 関連記事（3件）
   - コメント欄（任意: Disqus 等。MVPでは無しでも可）

#### 3.1.5 劇団登録ページ（`/register/`）
1. **認証（ログイン）**:
   - Supabase Auth
     - Google OAuth（メイン）
     - メールMagic Link（保険）

2. **オンボーディング（最小）**:
   - 「ログイン → 劇団情報入力 → 管理者承認」
   - 劇団情報（例）: 劇団名、連絡先メール、公式サイトURL、SNS、紹介文、ロゴ

3. **劇団ダッシュボード（`/theater/`）での公演CRUD**:
   - **作成（新規公演投稿）**
     - チラシ画像アップロード（最優先）
       - ドラッグ&ドロップ or ファイル選択
       - 対応形式: JPEG, PNG, WebP
       - 最大サイズ: 10MB
     - AI自動解析ボタン（Gemini）
       - 公演タイトル / 開催日時 / 会場名 / 料金 / あらすじ / キャスト / カテゴリー などを自動抽出
       - ハイブリッド戦略:
         1. Gemini 2.5 Flash
         2. 信頼度スコア < 80% の場合、Gemini 2.5 Pro
     - 手動編集（AI解析結果を修正可能、全手入力も可能）
     - 公開/非公開（下書き）を選択可能（承認フローは不要）
   - **編集**
     - 公開後も編集可能（日時変更・キャスト差し替え等）
   - **削除**
     - 劇団側で削除可能（SEO観点で「非公開（アーカイブ）」も選択肢として残す）
   - **AI SNS宣伝文生成（任意）**
     - 公演情報から自動生成（Gemini 3.0 Flash）
     - X/Twitter、Instagram、Facebook用の3パターン
     - 絵文字、ハッシュタグ自動追加
     - コピペ用のテキストボックス表示

#### 3.1.6 固定ページ
1. **運営者情報ページ**（`/about/`）:
   - 万能グローブガラパゴスダイナモスの紹介
   - 公式サイトへのリンク（`rel="noopener"`）
   - サイトの目的・ビジョン

2. **お問い合わせページ**（`/contact/`）:
   - Next.js のお問い合わせフォーム（Route Handler で送信）
   - reCAPTCHA v3

3. **プライバシーポリシー**（`/privacy-policy/`）:
   - 個人情報の取り扱い
   - Cookie使用について
   - Google Analyticsについて

#### 3.1.7 共通要素
1. **ヘッダー**:
   - ロゴ
   - グローバルナビゲーション（公演を探す / ブログ / 劇団の方へ / 運営者情報）
   - ハンバーガーメニュー（モバイル）

2. **フッター**:
   - サイトロゴ
   - フッターナビゲーション
   - SNSリンク
   - コピーライト

#### 3.1.8 カレンダー機能（`/calendar/`）（MVP）
1. **月次カレンダー表示**:
   - FullCalendarライブラリ使用
   - 公演開催日をカレンダーに表示
   - 日付クリックで該当公演一覧へ

2. **イベント表示**:
   - カレンダー上に公演タイトルを表示
   - カテゴリー色分け
   - ホバーで詳細プレビュー

3. **フィルター**:
   - カテゴリーフィルター
   - 会場フィルター

#### 3.1.9 AI機能（MVP）
1. **チラシ画像自動解析**:
   - Gemini 2.5 Flash（メイン）
   - Gemini 2.5 Pro（フォールバック）
   - JSON形式で構造化データ出力
   - 信頼度スコア計算

2. **SNS宣伝文自動生成**:
   - Gemini 3.0 Flash
   - 公演情報を魅力的な宣伝文に変換
   - X/Twitter、Instagram、Facebook用
   - 絵文字、ハッシュタグ自動挿入

### 3.2 将来機能（Phase 2: オプション）
- **AI感情分析強化**: あらすじから感情パラメーター（笑い、涙、思考）を自動抽出
- **ユーザー会員機能**: お気に入り登録、マイページ、通知設定
- **予約システムの内製化**: チケット販売機能（Stripe決済）
- **レビュー・評価機能**: ユーザーによる公演レビュー、星評価
- **多言語対応**: 英語、中国語、韓国語（Next.js i18n）
- **AI推薦エンジン**: ユーザーの閲覧履歴から公演をレコメンド

---

## 4. デザイン要件

### 4.1 デザインコンセプト
**ポップアート × レトロモダン**
福岡の演劇シーンを明るく、親しみやすく表現する。

### 4.2 カラーパレット
- **プライマリカラー**: `#FFD93D` (pop-yellow)
- **セカンダリカラー**: `#FF6B9D` (pop-pink)
- **アクセントカラー**: `#6BCF7F` (pop-green), `#4ECDC4` (pop-blue), `#A78BFA` (pop-purple)
- **テキストカラー**: `#1A1A1A` (ink)
- **背景カラー**: `#F9F7F1` (paper)

### 4.3 タイポグラフィ
- **見出し**: ゴシック体（源ノ角ゴシック or Noto Sans JP Bold）
- **本文**: ゴシック体（源ノ角ゴシック or Noto Sans JP Regular）
- **フォールバック**: `system-ui, -apple-system, sans-serif`

### 4.4 視覚的特徴
- **ハードシャドウ**: `box-shadow: 4px 4px 0 #1A1A1A;`
- **太い境界線**: `border: 2px solid #1A1A1A;`
- **角丸**: `border-radius: 8px;` (適度な丸み)
- **ホバーエフェクト**: 軽い移動（`transform: translate(-2px, -2px)`）

### 4.5 レスポンシブデザイン
- **モバイルファースト設計**
- **ブレークポイント**:
  - モバイル: `< 768px`
  - タブレット: `768px - 1024px`
  - デスクトップ: `> 1024px`

### 4.6 UI文言（言語）
- サイト内のユーザー向け文言は **原則日本語**（公開ページ・劇団ダッシュボード含む）
- 英語はブランド名など必要最小限に留める
- `fukuoka-stage---night's-coffee/stitch/` 配下のUIデータはプロトタイプとして扱い、実装時は英語文言を日本語へ置換する

---

## 5. 非機能要件

### 5.1 パフォーマンス
- **ページ読み込み時間**: 3秒以内（3G環境）
- **PageSpeed Insights スコア**: 90点以上（モバイル/デスクトップ）

#### 5.1.1 Core Web Vitals（必達指標）
Googleの2020年発表のCore Web Vitals指標に準拠。実際のユーザー体験において以下3指標が良好である必要があります。

1. **LCP (Largest Contentful Paint) - 最大視覚コンテンツの表示時間**
   - **目標**: 2.5秒以内
   - **測定対象**: ページ内で最も大きな画像またはテキストブロックの表示時間
   - **最適化施策**:
     - サーバーレスポンス時間の短縮（TTFB < 600ms）
     - 画像の最適化（WebP、適切なサイズ、lazy loading）
     - レンダリングブロックリソースの削減（CSS/JSの最小化）
     - CDN使用による配信高速化
   - **評価基準**:
     - Good: 0-2.5秒
     - Needs Improvement: 2.5-4.0秒
     - Poor: 4.0秒以上

2. **FID (First Input Delay) - 初回入力までの遅延時間**
   - **目標**: 100ミリ秒以下
   - **測定対象**: ユーザーが最初にページとインタラクション（クリック、タップ等）してからブラウザが応答するまでの時間
   - **最適化施策**:
     - JavaScriptの最小化とコード分割
     - 長時間実行されるJavaScriptタスクの分割
     - Webワーカーの活用（重い処理をメインスレッドから分離）
     - サードパーティスクリプトの遅延読み込み
   - **評価基準**:
     - Good: 0-100ms
     - Needs Improvement: 100-300ms
     - Poor: 300ms以上

3. **CLS (Cumulative Layout Shift) - 累積レイアウトシフト数**
   - **目標**: 0.1以下
   - **測定対象**: ページ読み込み中の予期しないレイアウト移動の合計スコア
   - **最適化施策**:
     - すべての画像・動画に`width`と`height`属性を指定
     - 広告、埋め込みコンテンツに予約領域を確保
     - Webフォントは`font-display: swap`または`optional`を使用
     - 動的コンテンツは既存コンテンツの下に挿入
   - **評価基準**:
     - Good: 0-0.1
     - Needs Improvement: 0.1-0.25
     - Poor: 0.25以上

**注意**: Googleは「Core Web Vitalsを構成する指標は、時間の経過とともに進化しています」と説明しているため、将来的に指標変更の可能性があります。現時点では上記3指標に注力します。

### 5.2 セキュリティ
- **SSL/TLS証明書**: 必須（Vercel自動提供）
- **Supabase Row Level Security (RLS)**:
  - データベースレベルのアクセス制御
  - 公開公演データ: 読み取りのみ許可（匿名ユーザー含む）
  - 劇団データ/公演データ: 自劇団のデータのみ作成・更新・削除を許可
  - 劇団の承認状態に応じて公開可否を制御（未承認は公開不可、等）
- **認証・認可**:
  - Supabase Auth（Google OAuth、メールMagic Link）
  - 2段階認証（管理者）
  - JWTトークンベースの認証
- **API セキュリティ**:
  - CORS設定（許可ドメインのみ）
  - Rate Limiting（Vercel Edge Middleware）
  - 環境変数でAPIキー管理（`.env.local`）
- **依存パッケージ**:
  - 定期的な脆弱性スキャン（`npm audit`）
  - Dependabotによる自動アップデート

### 5.3 アクセシビリティ
- **WCAG 2.1 Level AA準拠**
- **キーボードナビゲーション対応**
- **スクリーンリーダー対応**（ARIAラベル）
- **色のコントラスト比**: 4.5:1以上（本文）、3:1以上（見出し）

### 5.4 ブラウザ対応
- **デスクトップ**:
  - Chrome（最新版、1つ前）
  - Firefox（最新版、1つ前）
  - Safari（最新版、1つ前）
  - Edge（最新版、1つ前）
- **モバイル**:
  - iOS Safari（最新版、1つ前）
  - Android Chrome（最新版、1つ前）

### 5.5 バックアップ
- **自動バックアップ**: 日次（データベース + ファイル）
- **保持期間**: Supabase Freeは7日 / Proは30日
- **復元テスト**: 月次

---

## 6. コンテンツ要件

### 6.1 公演データ（初期登録）
既存のReact実装から移行する4つのモックイベント：
1. **夜明けのコーヒー**: 劇団〇〇、コメディ、2025.05.20-22、ぽんプラザホール、¥2,500
2. **青とサイダー**: Theater Blue、青春会話劇、2025.06.01-05、甘棠館Show劇場、¥3,000
3. **機械仕掛けのララバイ**: 劇団ギア、SF音楽劇、2025.06.10-12、福岡市民会館、¥4,500
4. **真夏の夜の悪夢**: Classic Remix、古典改変ホラー、2025.07.20、西鉄ホール、¥3,500

### 6.2 ブログ記事（初期作成）
- 「福岡の劇場ガイド」
- 「演劇初心者のための鑑賞マナー」
- 「万能グローブガラパゴスダイナモスとは？」
- 「今週末のおすすめ公演」

---

## 7. マイルストーン

### Phase 1: 設計・準備（1週間）
- [x] 要件定義書作成（本ドキュメント v2.0）
- [ ] アーキテクチャ設計書作成
- [ ] データベース設計書作成（Supabase）
- [ ] サイトマップ設計書作成
- [ ] ワイヤーフレーム作成
- [ ] ドメイン取得（`fukuoka-stage.com`）
- [ ] Vercel・Supabase アカウント作成
- [ ] GitHubリポジトリ作成

### Phase 2: 開発（3-4週間）
- [ ] Next.js 15 プロジェクト初期化
- [ ] Supabase データベーススキーマ構築
- [ ] TinaCMS セットアップ（`/admin`）
- [ ] トップページ開発（SSR）
- [ ] 公演一覧・詳細ページ開発
- [ ] ブログ一覧・詳細ページ開発（TinaCMS連携）
- [ ] 劇団ログイン/オンボーディング開発（`/register/`）
- [ ] 劇団ダッシュボード開発（`/theater/`：公演CRUD、画像アップロード、公開/非公開、削除）
- [ ] AI チラシ解析機能実装（Gemini 2.5 Flash/Pro）
- [ ] AI SNS宣伝文生成実装（Gemini 3.0 Flash）
- [ ] カレンダー機能実装（FullCalendar）
- [ ] 構造化データ実装（JSON-LD）
- [ ] SEO最適化（`app/sitemap.ts`、Metadata API）
- [ ] パフォーマンス最適化（next/image、Code Splitting）

### Phase 3: テスト（1週間）
- [ ] 機能テスト（Playwright E2E）
- [ ] SEOチェック（Google Search Console）
- [ ] パフォーマンステスト（PageSpeed Insights、Lighthouse）
- [ ] アクセシビリティテスト（axe DevTools）
- [ ] モバイル対応チェック
- [ ] ブラウザ互換性テスト
- [ ] AI機能精度検証（実際のチラシでテスト）

### Phase 4: リリース（1週間）
- [ ] Vercel本番環境デプロイ
- [ ] Supabase本番環境切替
- [ ] カスタムドメイン設定
- [ ] Google Analytics 4 設定
- [ ] Google Search Console登録
- [ ] SNS連携設定（OGP確認）
- [ ] 初期コンテンツ登録（4公演、3ブログ記事）
- [ ] 公開

---

## 8. 運用・保守

### 8.1 コンテンツ更新ワークフロー
#### ブログ記事更新（TinaCMS）
1. `/admin` にアクセス（TinaCMS管理画面）
2. ブログ記事を作成・編集（Markdownエディタ）
3. リアルタイムプレビュー確認
4. 「Save」→ GitHubに自動コミット
5. Vercel自動デプロイ（1-2分）

#### 劇団オンボーディング
1. 劇団がログイン（Google OAuth / メールMagic Link）
2. 劇団情報を入力して送信
3. 管理者が劇団を承認（承認後に公演の公開が可能）

#### 公演情報登録・更新（承認フローなし）
1. 劇団が `/theater/` から新規作成 or 編集
2. AI解析で入力補助（任意）
3. 保存（公開/非公開を劇団が選択）
4. 公開中の公演も、劇団が随時編集・削除可能

### 8.2 定期メンテナンス
- **依存パッケージ**: 月次アップデート（`npm update`）
- **Vercel・Supabase**: 自動アップデート（インフラ側で管理）
- **セキュリティスキャン**: 週次（`npm audit`、Dependabot）
- **バックアップ**:
  - Supabase: 自動バックアップ（7日間保持、Pro プランで30日）
  - Git: 全コンテンツがバージョン管理されている
- **パフォーマンスチェック**: 月次（PageSpeed Insights）

### 8.3 コンテンツ運用計画
- **公演情報**: 劇団からの登録随時（AI解析で効率化）
- **ブログ記事**: 週1回以上（TinaCMSで簡単更新）
- **ピックアップ公演**: 週1回更新
- **SNS宣伝**: 公演登録時にAI生成文をコピペして投稿

### 8.4 分析・改善
- **Google Analytics 4**: 月次レポート
- **Google Search Console**: 週次チェック
- **Vercel Analytics**: リアルタイム監視（ページ速度、エラー率）
- **ユーザーフィードバック収集**: 継続的（お問い合わせフォーム）

---

## 9. 成功指標（KPI）

### 9.1 SEO指標
- **検索順位**: 「福岡 演劇」「福岡 公演」で10位以内（3ヶ月後）
- **オーガニック流入**: 月間1,000セッション（6ヶ月後）
- **PageSpeed Insights スコア**: 90点以上維持

### 9.2 ユーザーエンゲージメント
- **直帰率**: 60%以下
- **平均セッション時間**: 2分以上
- **ページビュー/セッション**: 2.5以上

### 9.3 コンバージョン
- **公演詳細ページ閲覧**: 月間500PV（3ヶ月後）
- **外部チケット予約サイトへのクリック**: 月間50クリック（3ヶ月後）
- **劇団オンボーディング申請**: 月間5件（6ヶ月後）

---

## 10. リスクと対策

### 10.1 技術的リスク
| リスク | 影響 | 対策 |
|--------|------|------|
| Vercelのサービス停止 | 高 | Vercel Status監視、Cloudflare CDNでキャッシュ、静的ファイルバックアップ |
| Supabaseのデータ損失 | 高 | 自動バックアップ（7日保持）、重要データの定期エクスポート |
| Gemini APIの精度低下 | 中 | ハイブリッド戦略（Flash→Pro）、手動修正機能の提供 |
| Gemini API利用制限 | 中 | Rate Limitingで従量課金管理、エラーハンドリング |
| ページ速度低下 | 低 | Next.js最適化（SSR、ISR、next/image）、Core Web Vitals監視 |

### 10.2 運用リスク
| リスク | 影響 | 対策 |
|--------|------|------|
| TinaCMS操作に慣れない | 中 | マニュアル作成、WordPressライクなUI、オンボーディング |
| AI解析精度の不満 | 中 | 手動修正機能、Gemini 2.5 Pro フォールバック、実測データ改善 |
| 劇団からの登録が集まらない | 高 | AI解析で登録簡略化、劇団への直接営業、登録キャンペーン |
| SEO順位が上がらない | 中 | Next.js SSRでSEO最適化、コンテンツSEO強化、外部リンク獲得 |
| 月額コスト超過 | 低 | 無料プラン活用（Supabase、TinaCMS）、Gemini API使用量監視 |

---

## 11. 参考資料

### Google公式ドキュメント（SEO）
- [検索エンジン最適化（SEO）スターター ガイド](https://developers.google.com/search/docs/fundamentals/seo-starter-guide?hl=ja)
- [JavaScript SEO の基本](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics?hl=ja)
- [URL 構造のベスト プラクティス](https://developers.google.com/search/docs/crawling-indexing/url-structure?hl=ja)
- [クロール可能なリンク](https://developers.google.com/search/docs/crawling-indexing/links-crawlable?hl=ja)
- [構造化データ マークアップ](https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data?hl=ja)

### Next.js
- [Next.js Documentation](https://nextjs.org/docs)
- [Next.js SEO Best Practices](https://nextjs.org/learn/seo/introduction-to-seo)
- [Next.js Metadata API](https://nextjs.org/docs/app/building-your-application/optimizing/metadata)
- [Next.js Image Optimization](https://nextjs.org/docs/app/building-your-application/optimizing/images)

### Supabase
- [Supabase Documentation](https://supabase.com/docs)
- [Row Level Security (RLS)](https://supabase.com/docs/guides/auth/row-level-security)
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)

### TinaCMS
- [TinaCMS Documentation](https://tina.io/docs/)
- [TinaCMS Getting Started](https://tina.io/docs/setup-overview/)

### Gemini API
- [Gemini API Documentation](https://ai.google.dev/docs)
- [Gemini Vision API](https://ai.google.dev/tutorials/multimodal_vision_quickstart)

---

**作成日**: 2026-01-31
**最終更新日**: 2026-01-31
**バージョン**: 2.0
**作成者**: Claude Code (AI Assistant)

**更新履歴**:
- **v2.0 (2026-01-31)**: 技術スタック全面刷新（WordPress+PHP → Next.js 15 + Supabase + TinaCMS）
  - AI機能追加: チラシ画像解析（Gemini 2.5 Flash/Pro）、SNS宣伝文生成（Gemini 3.0 Flash）
  - カレンダー機能をMVPに追加（FullCalendar）
  - Git-based CMSワークフロー導入（TinaCMS）
  - 月額コスト試算追加（¥3,150-3,155/月）
  - セキュリティ、運用、リスク管理をNext.js環境に最適化
- v1.1 (2026-01-31): ロゴのテキスト化要件、Core Web Vitals詳細説明を追加
- v1.0 (2026-01-31): 初版作成（WordPress+PHP ベース）
