# セキュリティ修正 3便目：閲覧数（PV）の水増しを防ぐ（実装指示書）

作成: 2026-11-27 せお／実装: Claude Code Opus 5.5 xhigh／独立レビュー: Codex gpt-6.2-sol xhigh／本番適用: せお（西山くん「上から順に改善する」）

```xml
<task>
【何をするか】
公開の閲覧数 API `app/api/views/route.ts`（POST・未ログインでも呼べる）は、公演詳細ページの `ViewCounter.tsx` から呼ばれ、`event_views_daily`（日別）と `events.views`（累計）を +1 する。人気順（lib/data/events.ts）はこの数字を使う。
今の重複よけは「ブラウザの cookie（その日もう数えたか）」と「サーバーのメモリ上のレート制限（IP×公演で1分60回）」だけで、cookie を送らずに API を直接叩けば、同じ人が 1 分に 60 回ずつ数を増やせる。メモリ上の制限はサーバーのインスタンスごとに別なので、実際はさらに増やせる。また、今の加算は「読んでから +1 して書く」ので、同時に来ると数え漏れる。

同じ閲覧者・同じ公演・同じ日（日本時間）の閲覧は 1 回だけ数えるように、DB 側で重複を除き、加算も DB の中で一度に行う。

1. マイグレーション `supabase/migrations/20261127150021_event_view_dedupe.sql`（docs/sql/021_event_view_dedupe.sql に同じ中身の写し）
   - 表 `public.event_view_marks`（event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE、view_date date NOT NULL、viewer_hash text NOT NULL、created_at timestamptz NOT NULL DEFAULT now()、PRIMARY KEY (event_id, view_date, viewer_hash)）。RLS を有効にし、ポリシーは作らない（service_role だけが使う）。view_date の索引を 1 つ
   - 関数 `public.record_event_view(p_event_id uuid, p_view_date date, p_viewer_hash text) RETURNS boolean`
     - event_view_marks に INSERT … ON CONFLICT DO NOTHING。入らなかった（同じ日に同じ閲覧者がもう数えられている）なら false を返して何もしない
     - 入ったら、event_views_daily を (event_id, view_date) で upsert して views を +1（既存の一意制約を使う。無い行は views=1 で作る）、events.views を coalesce(views,0)+1 で更新して true を返す。どちらも 1 文で加算する（読んでから書かない）
     - 古い印を消す：p_view_date より 2 日以上前の event_view_marks を削除する（件数は少ない前提。本番の閲覧は直近7日で計 107 件）
     - `SET search_path = public` を付ける。`REVOKE ALL ON FUNCTION … FROM PUBLIC, anon, authenticated` と `GRANT EXECUTE … TO service_role` で、service_role 以外から呼べないようにする
     - 既存の docs/sql/001_init.sql で event_views_daily の一意制約・events.views の型を確かめてから書く
   - 再実行しても失敗しないこと（IF NOT EXISTS・CREATE OR REPLACE）。先頭のコメントに理由を 2〜3 行
2. `app/api/views/route.ts`
   - 閲覧者の印 viewer_hash を、サーバーだけが知る鍵で作った HMAC-SHA256（node:crypto）にする。材料は「クライアントの IP」「User-Agent」「日付（日本時間の view_date）」。生の IP や User-Agent は DB に保存しない
     - 鍵は環境変数 `VIEW_HASH_SECRET` があればそれ、無ければ `SUPABASE_SERVICE_ROLE_KEY` を使う（どちらも無ければ今までどおり CONFIG_ERROR）。鍵の値は応答・ログに出さない
     - クライアントの IP の取り方は、Vercel 上で利用者が偽れない取り方を Vercel の公式ドキュメントで確かめてから決める（推測で決めない）。確かめた URL と結論を報告に書く。今の getClientIp を変える場合は、レート制限のキーにも同じ値を使う
   - 公演の取得（今と同じ条件：category・slug・status=published）のあと、今の「読んで +1 して書く」3 段階をやめ、`record_event_view` を rpc で 1 回呼ぶだけにする
   - 応答：数えた・重複で数えなかった、のどちらも 200 `{ data: { ok: true } }`（ViewCounter は res.ok で cookie を付けるので、重複のときも cookie が付くようにする）。必要なら `counted: boolean` を足してよい（ViewCounter は data を見ていない）
   - RPC のエラーは今までどおり 500 DB_ERROR。メモリ上のレート制限・入力検査・404 は今までどおり残す
3. ほかに `event_views_daily` や `events.views` を書いている箇所が無いかを grep で確かめ、表で報告する（書き換えない）

【対象ファイル】
- supabase/migrations/20261127150021_event_view_dedupe.sql（新規）
- docs/sql/021_event_view_dedupe.sql（新規・上と同じ中身）
- app/api/views/route.ts

【読む範囲】
- 読んでよい: CLAUDE.md、上の対象ファイル、app/events/[category]/[slug]/ViewCounter.tsx、lib/data/events.ts（人気順の集計）、lib/supabase/、docs/sql/001_init.sql・008_trending_rpc.sql、supabase/migrations/、Vercel と Supabase の公式ドキュメント
- 読まなくていい: node_modules・.next・content/・public/

【完了条件】
- 1〜3 が入っていること
- `npx tsc --noEmit --incremental false` がエラー 0 件、`npx eslint app/api/views/route.ts` で新しいエラーが出ないこと
- マイグレーションの SQL を構文解析（scratchpad にある libpg-query を使ってよい）と目で確かめる
- Supabase を模擬してルートを実際に呼ぶハーネス（scratchpad に置く）で、最低限：初回 → rpc 1 回・200／同じ IP・UA・日で 2 回目 → rpc は呼ぶが false・200（関数の中で数えない）／IP か UA か日付が違う → 別の印／rpc エラー → 500／公演が無い・下書き → 404 で rpc を呼ばない／入力不足 → 400／鍵が無い → 500 CONFIG_ERROR／viewer_hash に生の IP・UA が含まれない（同じ入力で同じ値、鍵が違えば別の値）
- 関数の中身（重複なら加算しない・1 文で加算・古い印の削除・権限）は、Postgres が無いので SQL を読んだ結果を表で報告する

【背景】
- 本番：event_views_daily 1306 行、直近7日の閲覧は計 107、1公演1日の最大は 8。規模は小さい
- アプリの DB 書き込みは service_role。event_views_daily は service_role だけが読み書きできる RLS
- 別の IP を使い回す相手（多数の端末）までは防げない。ここで防ぐのは「同じ閲覧者が同じ日に何度も数える」こと
</task>

<completeness_contract>
Resolve the task fully before stopping.
Do not stop at the first plausible answer.
Check whether there are follow-on fixes, edge cases, or cleanup needed for a correct result.
</completeness_contract>

<verification_loop>
Before finalizing, verify the result against the task requirements and the changed files or tool outputs.
If a check fails, revise the answer instead of reporting the first draft.

【このタスクの検証コマンド】
npx tsc --noEmit --incremental false
npx eslint app/api/views/route.ts
grep -rn "event_views_daily\|views:" app lib scripts（書いている箇所の確認）
</verification_loop>

<action_safety>
Keep changes tightly scoped to the stated task.
Avoid unrelated refactors, renames, or cleanup unless they are required for correctness.
Call out any risky or irreversible action before taking it.
子エージェント（Claude の Agent ツール）を使わず自分で実装する。レビューは外から別途回す。

【このタスクで触ってはいけないもの】
- DB・Supabase への接続（db push・link・SQL の実行はしない。本番への適用はせおがやる）
- Vercel の環境変数の追加・変更（VIEW_HASH_SECRET は今は作らない。フォールバックで動くようにする）
- git commit / push / branch 操作、`npm run build`・`npm run dev`
- 対象ファイル以外の変更（ViewCounter.tsx も変えない。必要だと判断したら、変えずに報告）
- 推測で実装しない。IP の取り方と supabase-js の rpc の返り値は公式ドキュメント・ライブラリのコードで確かめる
- 言いなりに直さない。この指示書に矛盾や穴があれば、根拠をつけて報告に書く
- 保証できないことを保証するふりをしない
</action_safety>

<structured_output_contract>
報告は次の 4 項目だけ:
1. 変更したファイル（`git status --short --untracked-files=all` の出力をそのまま）
2. 何をどう変えたか（ファイルごとに 2〜4 行。マイグレーションは全文）
3. 検証の結果（コマンドと出力の要点、ハーネスの表、書いている箇所の表、IP の取り方の根拠）
4. 未解決・気になる点
</structured_output_contract>
```

## 判定と適用（C-4・せお・2026-11-27）

ship（西山くん「上から順に改善する」）。Codex gpt-6.2-sol xhigh 1周（High なし）＋実装担当の修正と自己レビュー。

- 指示書からの変更（せおの判断）：UA は利用者が変えられるので、閲覧者の印（IP＋UA＋日付）に加えて「同じ IP・公演・日で数えるのは 5 回まで」の上限を足した（IP だけの HMAC を p_ip_hash で渡す。上限はルートの定数）。関数は 5 引数・表に ip_hash
- Codex で直したもの：同時に来ると上限を超える（→ (公演, 日, ip_hash) の pg_advisory_xact_lock で直列化）／外部サイトから訪問者のブラウザで加算させられる（→ Content-Type が application/json 以外は 415）／公開日前の公演も数える（→ isReleased で 404）
- 記録だけ：IP が取れないと "unknown" で枠を共有（Vercel では x-real-ip が常にある）／古い印の削除は新しい計上のときだけ／JSON が null・数値のときの例外／rpc の返り値の型付け／日付の境目での cookie のずれ／人気順の集計開始日の JST ずれ（既存）／鍵の切り替え・VIEW_HASH_SECRET は未設定で service_role の鍵を流用（いずれ別の鍵を作るのがおすすめ）／共有回線で 6 人目から数えない／Origin の検査なし（CORS を許可していない前提）／ドキュメントの古い記述（docs/04 の成功応答例・「人気順は events.views」は実際は event_views_daily）
- 本番の確認：独自ドメインは Vercel の DNS に CNAME・AAAA なし（IPv4 だけ）・前に別のプロキシなし。Postgres 17.6・hashtextextended あり・read committed
- 本番 DB：dry-run で対象1本を確認して `supabase db push --linked`（コードより先に適用）。適用後、関数は service_role だけが実行でき（anon・authenticated は不可）、表は RLS 有効・anon は読めない。関数の動きは DO ブロックの中で呼んで例外で巻き戻す形で確認：同じ閲覧者は true→false、同じ IP で 6 通りの閲覧者は 5 回まで true・6 回目 false、累計・日別とも +6。巻き戻し後、印は 0 件
- ハーネス：scratchpad/batch-c/harness（52件 ALL OK）。マイグレーションの構文解析と書き換え検査（19通り NG）、ルートの書き換え検査（17通り NG）
