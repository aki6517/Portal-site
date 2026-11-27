# 実装指示書：DB の一時エラーを「公演なし」としてキャッシュしない＋小さな直し3つ

作業場所: `~/dev/portal-site-work-db-error-cache`（git worktree・枝 `fix/db-error-not-cached`・元は origin/main の `064e80d`）

> **実装後の追記（2026-11-27）**：レビューで次の点が変わった。今の正本はコードとコメント。
> - A-6 のエラー画面のボタンは `reset()` ではなく `retry()`（Next.js 16.3 以降の公式の書き方。`reset()` はデータを取り直さない）。
> - 管理画面のお問い合わせ一覧でも、取得のエラーを例外にする。
> - 公演ページの旧 URL の転送（`tryRedirect`）と、公演の検索・詳細の取得（`fetchEventIdBySlug`・`fetchEventById`）は、同じ日に先に main へ入った `80be1f3`（カテゴリのタグ扱い）が同じ直しを入れたので、このコミットではそちらをそのまま使う（`throwLookupError`・`throwRedirectLookupError`）。
> - おすすめ公演の「列が無い」フォールバックは、欠けている列が `featured_at` のときだけ。
> - 公演の詳細ページは動的に描くページ（`generateStaticParams` が無い）なので、ページ単位のキャッシュは無い。障害中に古いデータを返せるのは `unstable_cache` の段だけ。

<task>
【何をするか】
福岡アクトポータル（Next.js 16 App Router・Supabase・Vercel）の、既知の小さな問題を4つ直す。互いに独立している。

### A. DB の一時エラーが「空の結果」としてキャッシュされるのを止める（いちばん大事）

今の `lib/data/events.ts` は、ほとんどの取得が `const { data } = await …; return data ?? []` で、Supabase が `error` を返しても捨てている。その空の結果が `unstable_cache` に最大10分（カテゴリとサイトマップは1時間）残る。2026-11-27 に手元で実際に起きた（通信が一瞬切れたあと、カレンダーの「近日開催」が空のままになった）。
いちばん困るのは公演の詳細ページで、実在する公演が最大10分 404 になる（`getEventBySlug` が null を返し、ページが `notFound()` を呼ぶ）。

直し方の決まり（設計は決定済み。変えたいときは実装せず、報告の4に書く）:

1. **キャッシュされる関数の中で、Supabase が `error` を返したら例外を投げる。** 空の値を返さない。投げる前に `console.error` で「どの取得か」と `error.code`・`error.message` を1行で出す（鍵・URL・行の中身は出さない）。
2. **投げた例外は、ページまでそのまま届かせる。** ページ側で握りつぶして空の一覧を描かない（握りつぶすと、今度はページ単位のキャッシュに「空のページ」が残る）。`revalidate` のあるページ（`app/page.tsx`・`app/events/[category]/[slug]/page.tsx`・`app/sitemap.ts`）は、作り直しに失敗すると Next.js が前の正常なページを出し続ける。この動きは Next.js 16 の公式の文書（`node_modules/next/dist/docs/` と型定義）で確かめてから進める。確かめた場所を報告に書く。
3. **もとから「エラーは想定内」として作ってある分岐は残す。**
   - `fetchTrendingEvents` の `service.rpc("trending_events")` がエラーのときに、JS の集計へ回る分岐（そのまま）。ただし、回った先の取得と、そのあとの `events` の取得がエラーなら投げる。
   - `fetchFeaturedEvent` の `if (error) return null`：`featured_at` の列が無い DB のための分岐。**列が無いというエラー（PostgREST のコード。supabase-js の `PostgrestError.code` と PostgREST の公式の文書で確かめる）のときだけ null を返し、それ以外のエラーは投げる。** 本番の DB には `featured_at` の列も `trending_events` の関数もある（2026-11-27 に確認済み）。
   - `SUPABASE_SERVICE_ROLE_KEY` が無いときに空を返す早期リターン（そのまま）。
4. **`lib/data/siteTags.ts` はページを落とさない。** ここはルートのレイアウト（`app/layout.tsx`）が呼ぶので、例外を外へ出すとサイト全体が落ちる。キャッシュされる関数の中ではエラーで投げ（＝空をキャッシュしない）、**`getSiteTags` の外側で受けて、その回だけ `EMPTY_SITE_TAGS` を返す**。今の `try/catch` が空を返してキャッシュさせている点も同じ形に直す。
5. **`lib/data/calendar.ts` の `fetchWeekData`（174行あたりの3つの取得）も、1〜2 と同じ決まりで直す。**
6. **エラー画面を足す。** 今は `app/error.tsx` が無い。動的に描くページ（`/events`・`/events/[category]`・`/events/archive`・`/calendar`）で例外が届くと、Next.js の素っ気ない既定の画面になる。`app/error.tsx`（クライアントコンポーネント）を足し、「ただいま情報を読み込めませんでした。少し時間をおいて、もう一度お試しください。」と、もう一度試すボタン（`reset()`）、トップへのリンクを出す。見た目は既存のカード（太い枠・角丸・影）のクラスをそのまま使い、新しい色や書体を足さない。エラーの中身（message・stack・digest）は画面に出さない。
7. 例外を投げる処理は、小さな共通の関数にまとめてよい（例：`lib/data/` の中に、Supabase の結果を受けてエラーなら投げる関数を1つ）。**仕組みはこれ以上足さない**（再試行・前回の値を覚えておく層・独自のキャッシュは作らない）。

### B. `/admin/contact?status=new` の絞り込みが効かない

`app/admin/contact/page.tsx` が `searchParams` を await せずに読んでいる（Next.js 15 以降は Promise）。**このリポジトリのほかのページと同じ書き方に合わせる**：型は `{ status?: string } | Promise<{ status?: string }>`、読むときは `await Promise.resolve(searchParams)`（例：`app/events/page.tsx` 48〜52行、`app/events/archive/page.tsx` 50〜54行）。
`app/` の下のほかの `page.tsx`・`layout.tsx`・`route.ts` に、`searchParams` や `params` を await せずに読んでいる所が残っていないかも調べ、あれば同じ形で直す（無ければ「無かった」と報告する）。

### C. トップの画像の `priority` を、今の正しい書き方にする

`app/page.tsx` 178行あたりの `next/image` の `priority`。Next.js 16 での正しい属性を、**入っている版（16.4.6）の公式の文書と型定義（`node_modules/next/dist/docs/` と `node_modules/next/dist/` の Image の型）で確かめてから**直す。非推奨でなければ直さず、理由を報告する。推測で書き換えない。

### D. markdown-it の型の「何でもあり」をやめる

`types/markdown-it.d.ts` が `declare module "markdown-it";` の1行で、入っている `@types/markdown-it` を隠して全部 any にしている（eslint の error 14件の原因）。このファイルを消し、出てきた型エラーを**動きを変えずに**直す。
型の付け直しだけで済まない（変換の動きを変える必要がある・直す量が大きい）と分かったら、D は元に戻して、理由を報告の4に書く。

【対象ファイル（見込み）】
- `lib/data/events.ts`、`lib/data/calendar.ts`、`lib/data/siteTags.ts`、（足すなら）`lib/data/` の小さな共通関数1つ
- `app/error.tsx`（新規）
- `app/admin/contact/page.tsx`（B。ほかに見つかればそのファイル）
- `app/page.tsx`（C）
- `types/markdown-it.d.ts`（削除）と、markdown-it を使うファイル（`lib/content.ts` など）

【読む範囲】
- 読んでよい：`app/`、`lib/`、`types/`、`next.config.ts`、`eslint.config.mjs`、`tsconfig.json`、`package.json`、`CLAUDE.md`、`docs/04_api.md`、`node_modules/next/dist/docs/` と Next.js・supabase-js・markdown-it の型定義
- 読まなくていい：`scripts/`、`content/`、`supabase/`、`tina/`、`public/`、`.next/`、ほかの worktree

【完了条件】
- A〜D が上の決まりどおりに入っている（直さなかったものは理由つき）
- `npx tsc --noEmit` が通る
- `npm run lint` の error が、作業前より増えていない（作業前の件数を先に測って報告する。D が入れば減るはず）
- `npm run build` が通る（1回だけ実行してよい。本番の DB を読むだけで、書き込まない。ビルドのあと `git status` を見て、`tina/` など意図しないファイルが変わっていたら `git checkout -- <パス>` で戻し、報告する）
- A について、「エラーのとき例外が出ること」と「エラーの結果がキャッシュに残らないこと」を、自分で確かめた（方法は任せる。使った方法と実際の出力を報告する）

【背景】
- 公開ページは cookie に依存しないクライアントで読み、`unstable_cache` でキャッシュしている（`lib/data/events.ts` の冒頭のコメント）。
- このあと、せお（計画担当）が、手元の本番ビルドで「Supabase への通信だけを落とす」確認をする：通信を落としている間は、未生成の公演ページが 404 ではなくエラー（5xx）になり、`/events` はエラー画面、トップは前の正常なページのまま。通信を戻したら、同じ URL がすぐ正常に戻る（エラーがキャッシュされていない）。この確認に通る実装にする。
- リポジトリは公開（PUBLIC）。コメントやログに、鍵・メールアドレス・内部の URL を書かない。
</task>

<completeness_contract>
Resolve the task fully before stopping.
Do not stop at the first plausible answer.
Check whether there are follow-on fixes, edge cases, or cleanup needed for a correct result.
</completeness_contract>

<verification_loop>
Before finalizing, verify the result against the task requirements and the changed files or tool outputs.
If a check fails, revise the answer instead of reporting the first draft.

【このタスクの検証コマンド】（作業場所で実行する）
npx tsc --noEmit
npm run lint
npm run build
git status --short --untracked-files=all
</verification_loop>

<action_safety>
Keep changes tightly scoped to the stated task.
Avoid unrelated refactors, renames, or cleanup unless they are required for correctness.
Call out any risky or irreversible action before taking it.
子エージェント（Agent ツール）を使わず自分で実装する。レビューは外から別途回す。

【このタスクで触ってはいけないもの】
- `.env` で始まるファイル（開かない・書き換えない。`node_modules` と `.env.local` はシンボリックリンクなので、消したり作り直したりしない）
- `package.json`・`package-lock.json`（依存を足さない・上げない。`npm install` をしない）
- `scripts/`・`content/`・`supabase/`・`tina/`・`public/`・`app/api/`・`lib/supabase/`
- データベース（書き込みをしない。Supabase の MCP を使わない）
- git の commit・push・枝の切り替え・ほかの worktree（`~/dev/portal-site-work` 本体を含む）
- 画面の見た目・文言（`app/error.tsx` の新規追加を除く）。公開ページの HTML が、正常なときに作業前と変わらないこと
- 言われていない直し（気づいた問題は直さず、報告の4に書く）

【不変条件（絶対に壊さない）】
- 正常なとき（DB がエラーを返さないとき）、どのページも作業前と同じ内容を返す
- ルートのレイアウトは、どの取得が失敗しても例外を外へ出さない
- 公開ページで cookie に依存するクライアントを使わない
</action_safety>

<missing_context_gating>
Do not guess missing repository facts.
If required context is absent, retrieve it with tools or state exactly what remains unknown.
推測で実装しない。Next.js・supabase-js・PostgREST の動きは、入っている版の公式の文書と型定義で確かめてから決める。確かめられなかったことは、保証するふりをせず、報告の4に「確かめられなかった」と書く。
</missing_context_gating>

<structured_output_contract>
最後に必ず次を、日本語で簡潔に出力すること。

1. 変更したファイルの**完全な一覧**（1つも省略しない。新規・削除も）
2. 各ファイルで何を変えたか（1行ずつ）
3. 実行した検証コマンドと、その実際の出力（必要な数行だけ。lint は作業前と作業後の error の件数）。A の確かめ方と出力。公式の文書で確かめた場所（パス）
4. やり残し・既知の制約・確かめられなかったこと・気づいたが直していない問題。**リポジトリの文書（`CLAUDE.md`・`docs/`）とコードが食い違っている所を見つけたら、ここに1つずつ書く**（直すのはコードの書き方に合わせる）

ファイル全文やログ全文は貼らない。
</structured_output_contract>
