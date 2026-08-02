# 公演情報 自動収集パイプライン（harvest）設計

2026-08-02設計。目的: ぽんプラザホール・甘棠館Show劇場・北九州芸術劇場などの公演情報が
ポータルに載っていない問題を、外部の公式ソースからの月次自動収集で解消する。

## 情報ソース（アダプタ3本）

| source | 取得方法 | 備考 |
|--------|---------|------|
| `fpap` | FPAP公演カレンダーの公開Google CalendarをiCalで取得 | `https://calendar.google.com/calendar/ical/ab9b5ce4d3bf0cb83265338ab8262a72e3c5c34851c0ea4b5f42b71404b7b751%40group.calendar.google.com/public/basic.ics`。劇団が自己登録→FPAPが掲載する一次情報。SUMMARY=公演名/LOCATION=会場/DESCRIPTIONに日程・詳細。1公演日=1VEVENTのことが多い |
| `pomplaza` | `http://pomplazahall.jp/files/event_YYMM.pdf`（月別・命名規則固定）をGeminiで構造化 | 公式イベントカレンダーPDF。pdftotext -layoutでも読めるが格子レイアウトのためLLM構造化＋厳密バリデーションを採用 |
| `qgeki` | `https://q-geki.jp/events/` 一覧→ジャンル=演劇の個別ページをHTML解析 | 北九州芸術劇場公式。FPAPには北九州の情報がほぼ無いため必須 |

## パイプライン（scripts/harvest/index.mjs）

1. **fetch**: 各アダプタが生データ取得（`--fixtures <dir>` 指定時はローカルファイルから読む）
2. **normalize**: 公演レコードに正規化 `{source, source_key, title, company, venue_text, dates[{date,times[]}], description, source_urls[]}`
   - 同一公演（タイトル+会場）の複数日程は1レコードにグルーピング
3. **filter**: 演劇以外（ワークショップ・講座・抽選会・休館日等）はキーワード/ジャンルで除外
4. **dedupe**:
   - 台帳: `harvest_items(source, source_key)` unique — 同じソース項目は二度と登録しない（冪等）
   - 既存イベント: 会場（venue_id or venue文字列）×日程重なり×タイトル類似（正規化後bigram Jaccard≥0.55）→スキップ
5. **venue解決**: `lib/venues/normalize.ts` と同一アルゴリズム（NFKC→括弧除去→ホール語分離→name/aliases照合）
6. **書き込み**（service role直INSERT）:
   - theaters: company名でci検索→なければ `origin='scout', status='approved'` で作成。company不明時は共通劇団「福岡アクトポータル編集部（外部情報）」
   - events: `status='published'`（品質ゲート通過時）or `'draft'`。`source_urls`に出典URL（詳細ページに「主催者はご自身で更新できます」告知が出る既存挙動を利用）
   - **品質ゲート（publishの条件）**: タイトルあり・日付が対象期間内・会場名あり・演劇と判定。満たさない場合はdraft
   - slug: `hv-{source}-{yyyymm}-{hash6}`、category: キーワード推定（musical/comedy/dance/student/conte）→デフォルト `drama`
7. **report**: Resendで pugwriting@gmail.com に実行サマリ（公開N件/draft N件/スキップN件/エラー）をメール

## スケジュール（.github/workflows/harvest.yml）

- cron `0 21 27 * *`（毎月28日 6:00 JST）= 月末回・翌月分を取り込み → **月初には反映済み**
- cron `0 21 1 * *`（毎月2日 6:00 JST）= 月初回・取りこぼし回収
- `workflow_dispatch` で手動実行可（inputs: dry_run / sources / window_days）
- 取得対象ウィンドウ: 実行日から70日先まで（`--window-days`）

## 運用ルール

- 収集イベントの修正・非公開化は `/admin/events` から（既存フロー）
- 自動公開を止めたいときは workflow の `HARVEST_PUBLISH=false`（全部draftになる）
- ソース側の構造変化で0件になった場合、メールレポートに「前回比」警告を出す（silent failure対策）
- portal-scout（学生演劇・draft専用）とは独立。scoutの「draftのみ」原則はSNS由来の非構造情報用であり、本パイプラインは会場公式/FPAP一次情報のため品質ゲート付き自動公開とする（2026-08-02 西山くん指示）

## 必要なGitHub Secrets

`NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `GEMINI_API_KEY` / `RESEND_API_KEY` / `HARVEST_REPORT_TO` / `CONTACT_FROM_EMAIL`
