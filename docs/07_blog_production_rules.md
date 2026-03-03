# ブログ制作ルール（運用固定）

最終更新: 2026-03-01

本ドキュメントは、`/blog` と `/blog/[slug]` の制作・編集時に必ず守る運用ルールです。  
デザイン基準は `docs/01_requirements.md`（4.1〜4.4, 5.3）を前提に、本プロジェクトで合意した実装仕様を固定化しています。

---

## 1. 対象範囲

- TinaCMSで編集する記事 (`content/blog/*.md`)
- 記事一覧 (`/blog`)
- 記事詳細 (`/blog/[slug]`)
- 記事本文レンダリング（Markdown）
- 著者情報表示
- 構造化データ（BlogPosting / Organization / FAQPage）

---

## 2. フロントマター運用

- `date` は ISO 8601 形式で入力する（例: `2026-02-28T05:01:59.341Z`）
- 画面表示の日付フォーマットは固定で `YYYY/MM.DD`（例: `2026/02.28`）
- `author` / `author_role` / `author_profile` / `author_image` / `organization_name` / `organization_url` は可能な限り入力する
- `author_profile` は `|` 区切りで複数入力する

---

## 3. Markdown執筆ルール

### 3.1 見出し

- H2を章見出し、H3を節見出しとして使う（階層を飛ばさない）
- H2はH3より目立つデザイン、ただしフォント系統はH3と揃える
- H3は左ボーダー系デザインを維持する

### 3.2 強調（太字）

- 太字は半角アスタリスク2個で記述する: `**強調したい文**`
- 全角記号（`＊`）や不完全な記法（閉じ忘れ）は禁止
- TinaCMS上で太字に見えても、保存後のMarkdownを必ず確認する

### 3.3 箇条書き

- 通常のMarkdownリスト（`-` または `*`）を使う
- 見た目はCSSで赤チェックマーク化するため、本文に手入力で `✓` は入れない

### 3.4 テーブル

- テーブルは必ずヘッダー行を入れる
- 1行目をデータ行にしない（ヘッダー欠落事故防止）
- 推奨フォーマット:

```md
| ジャンル | 内容 | 主な団体 |
| --- | --- | --- |
| **演劇（ストリートプレイ）** | 新劇や小劇場といった複数のジャンルがある | [文学座](http://www.bungakuza.com/) / [劇団乾電池](https://www.tokyo-kandenchi.com/) |
```

- 「主な団体」は1件ずつ個別リンク化する
- 複数リンクは ` / ` で区切る

### 3.5 リンク

- 外部リンクは通常のMarkdownリンク `[表示名](https://...)` を使う
- レンダラー側で `target="_blank" rel="noopener noreferrer"` が自動付与される
- 生HTMLの埋め込みは禁止（`html: false`）

### 3.6 固定文言の自動リンク補完

- 以下の文言は、本文にプレーンテキストで書かれても自動で公式サイトリンク化される  
  `福岡の劇団「万能グローブ ガラパゴスダイナモス」（通称ガラパ）`
- リンク先は固定で `https://www.galapagos-dynamos.com/`
- 既に手動リンクで囲まれている場合は手動リンクを優先し、二重リンク化しない

---

## 4. 著者情報カードルール

- 配置は「冒頭説明の後、本文の前」に固定
- アイコンの右隣に「肩書き + 名前」を横並びで表示し、縦に伸ばしすぎない
- 画像は `public/authors/` 配下を使用（例: `/authors/nishiyama-akihiro.jpg`）
- 著者プロフィールは箇条書き2〜3点で簡潔にする

---

## 5. 構造化データルール

- 記事詳細で `BlogPosting` を出力する
  - `author` は `Person`
  - `publisher` は `Organization`
- `Organization` のJSON-LDを別途出力する
- FAQは記事内の「よくある質問」セクションから生成する
  - H2に `よくある質問` を含める
  - 各H3を質問、続く本文を回答として扱う

---

## 6. デザイン固定事項（本文）

- H2: H3より大きいサイズ、背景強調あり、章区切りとして視認できること
- H3: H2より控えめ、左ボーダーでサブ節感を出す
- UL: 赤チェックマーク表示
- TABLE: モバイルで横スクロール可能にする
- `ul/ol/table/blockquote/code/a` は `content-prose` 系クラスで統一

---

## 7. 公開前チェックリスト

- [ ] `npm run content:check` が成功する
- [ ] H2/H3の階層と見た目差が適切
- [ ] 太字が実ページで反映されている
- [ ] ULが赤チェックマーク表示
- [ ] テーブルにヘッダーがあり、モバイルで横スクロールできる
- [ ] 「主な団体」が1件ずつリンクになっている
- [ ] 日付表示が `YYYY/MM.DD`
- [ ] 著者カード（画像・肩書き・名前）が崩れていない
- [ ] FAQ構造化データが生成されている

---

## 8. 反映・障害時の確認手順

1. TinaCMSで保存（GitHub自動コミット）
2. VercelのProductionデプロイ完了を確認
3. `npm run publish:verify -- --domain portal.galapagos-dynamos.com --slug <slug>` を実行
4. ブラウザをハードリロード（Shift + Reload）
5. まだ反映されない場合:
   - 対象記事のMarkdown（`content/blog/*.md`）に変更が入っているか確認
   - `date` / `slug` / 表記法（特に太字・テーブルヘッダー）を確認
   - 必要に応じて再デプロイを実行

---

## 9. 本番運用の固定ルール（再発防止）

- Production配信ブランチは **`main` 固定**
- 作業フォルダは **`fukuoka-stage---night's-coffee` のみ使用**
- `portal-main-clean` は廃止済み（再作成しない）
- デプロイ前に必ず `npm run deploy:check` を実行する

`deploy:check` は次を自動検証する:

- 現在ブランチが `main`
- 未コミット/未追跡ファイルがない
- 主要ファイル（ブログレンダラー・対象記事・著者画像・運用ルール）が存在する

---

## 10. 本番反映の標準手順（一本化）

1. `fukuoka-stage---night's-coffee` で `main` にいることを確認
2. 記事/コード修正を保存
3. `npm run deploy:check`
4. `git add -A && git commit -m "..." && git push origin main`
5. VercelのProductionデプロイ完了を確認
6. `vercel inspect <production-url>` で Deploy Commit が `main` HEAD と一致しているか確認
7. `/admin` と対象記事ページをハードリロードして表示確認
