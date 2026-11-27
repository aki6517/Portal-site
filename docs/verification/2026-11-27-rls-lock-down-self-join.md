# ブラウザから劇団の所属・劇団を勝手に作れないようにする（RLS の修正・実装指示書）

作成: 2026-11-27 せお／実装: Claude Code Opus 5.5 xhigh／独立レビュー: Codex gpt-6.2-sol xhigh／本番適用: せお（西山くんGO済み）

```xml
<task>
【何をするか】
本番 DB（Supabase）の RLS に、次の 2 つの穴がある（2026-11-27 に `pg_policies` で確認済み）。公開されている anon キーとログイン（誰でもできる）だけで、ブラウザから直接 PostgREST を叩けば悪用できる。

1. `theater_members` の INSERT ポリシー「Self can join as owner on onboarding」
   - 条件が `with check ((user_id = auth.uid()) AND (role = 'owner'))` だけで、theater_id を見ていない
   - ログインした人は、どの劇団にも自分を owner として足せる。足すと `resolveActiveTheater` がその所属を本物として扱い、ポータルの API（service_role で書く）から他劇団の公演を作成・編集・削除・公開でき、`theaters` の UPDATE ポリシー（is_theater_member(id)）で他劇団の名前・説明・URL も書き換えられる
2. `theaters` の INSERT ポリシー「Authenticated users can create theater」
   - 条件が `with check (status = 'approved')` だけで、ログインした人は誰でも承認済みの劇団を直接作れる

この 2 つのポリシーを消し、運営者（is_admin()）だけが INSERT できるポリシーに置き換えるマイグレーションを 1 本書く。

【変えないもの（理由つき）】
- `theaters` の UPDATE ポリシー「Theater members can update their theater」（`is_theater_member(id) OR is_admin()`）は残す。管理画面の劇団の状態変更 `app/api/admin/theaters/[id]/route.ts` がログイン中の利用者のクライアント（createSupabaseServerClient）で `theaters` を update しており、このポリシーの `is_admin()` に頼っているため。status 列はトリガー `trg_prevent_theater_status_update`（本番で有効を確認済み）が運営者と service_role 以外の変更を拒否している
- `events`・`promotions`・`theater_invites`・`user_settings` などのポリシー（本物のメンバー・本人に限る条件つき）は変えない。所属の自己登録をふさげば、本物のメンバーだけになるため
- 関数 is_admin()・is_theater_member()・トリガーは変えない

【作るもの】
- `supabase/migrations/20261127120018_lock_down_self_join_and_theater_insert.sql`（ファイル名の数字は、既存の最後 `20260802220017_bayside_alias.sql` より大きいこと。中身は下）
  - `DROP POLICY IF EXISTS "Self can join as owner on onboarding" ON public.theater_members;`
  - `CREATE POLICY "Admins can add theater members" ON public.theater_members FOR INSERT TO authenticated WITH CHECK (is_admin());`
  - `DROP POLICY IF EXISTS "Authenticated users can create theater" ON public.theaters;`
  - `CREATE POLICY "Admins can create theaters" ON public.theaters FOR INSERT TO authenticated WITH CHECK (is_admin());`
  - 同じ名前のポリシーがすでにあっても失敗しないように、CREATE の前に同名の `DROP POLICY IF EXISTS` も入れる
  - 先頭のコメントに、何の穴をふさぐのかと、変えないもの（上の理由）を 3〜5 行で書く
- `docs/sql/` の既存ファイルのうち、上の 2 つのポリシーを作っている箇所（001_init.sql の 288 行付近、003_update_theater_rules.sql の 35 行付近）は直接書き換えない。代わりに `docs/sql/` に同じ内容の `0xx_lock_down_self_join_and_theater_insert.sql`（番号は docs/sql の既存の最大番号＋1）を足す（docs/sql はドキュメントの正本・実行は migrations 経由というリポジトリの運用に合わせる）

【確かめること（コードを読んで）】
- ブラウザ（`lib/supabase/client.ts` を使うコード）から、`theater_members`・`theaters` に INSERT していないこと
- サーバー側で、ログイン中の利用者のクライアント（`lib/supabase/server.ts` の createSupabaseServerClient）を使って `theater_members` や `theaters` に INSERT している箇所がないこと（あれば、このマイグレーションで壊れるので、変えずに報告）。劇団登録 `app/api/theater/onboard`、招待の受諾 `app/api/theater/me`、招待 `app/api/theater/invite`、メンバー `app/api/theater/members`、管理 `app/api/admin/**` を必ず見る
- 結果を「ファイル・行・使っているクライアント・操作・このマイグレーションの影響」の表で報告する

【対象ファイル】
- supabase/migrations/20261127120018_lock_down_self_join_and_theater_insert.sql（新規）
- docs/sql/018_lock_down_self_join_and_theater_insert.sql（新規）

【読む範囲】
- 読んでよい: CLAUDE.md、supabase/migrations/、docs/sql/、lib/supabase/、lib/theater/、app/api/、app/theater/、app/admin/、app/register/
- 読まなくていい: node_modules・.next・content/・public/

【完了条件】
- マイグレーションの SQL を書き、構文を確かめる（ローカルに Postgres が無ければ、`supabase db lint` や `psql` は使えないので、SQL を目で確かめた結果を報告する。DB には接続しない）
- 上の「確かめること」の表
- `npx tsc --noEmit --incremental false` が 0 件のまま（TS は変えないが念のため）

【背景】
- 2026-11-27 時点で本番の劇団は 97 件すべて approved。owner が 2 人以上・メンバーが 3 人以上の劇団は 0 件で、悪用の跡は見当たらない
- 劇団登録（onboard）は service_role で `theaters` と `theater_members` に INSERT している（せおが確認）
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
grep -rn "theater_members\|from(\"theaters\")" app lib （クライアントの種類と操作を表にする）
</verification_loop>

<action_safety>
Keep changes tightly scoped to the stated task.
Avoid unrelated refactors, renames, or cleanup unless they are required for correctness.
Call out any risky or irreversible action before taking it.
子エージェント（Claude の Agent ツール）を使わず自分で実装する。レビューは外から別途回す。

【このタスクで触ってはいけないもの】
- DB・Supabase への接続（`supabase db push`・`supabase link`・SQL の実行はしない。本番への適用はせおがやる）
- git commit / push / branch 操作
- 対象ファイル以外の変更（TS のコードは変えない。必要だと判断したら、変えずに報告）
- 言いなりに直さない。この指示書に矛盾や穴があれば、根拠をつけて報告に書く
- 保証できないことを保証するふりをしない
</action_safety>

<structured_output_contract>
報告は次の 4 項目だけ:
1. 変更したファイル（`git status --short --untracked-files=all` の出力をそのまま）
2. 何をどう変えたか（マイグレーションの全文を貼る）
3. 検証の結果（「確かめること」の表と、tsc の結果）
4. 未解決・気になる点
</structured_output_contract>
```

## 判定と適用（C-4・せお・2026-11-27）

- Codex gpt-6.2-sol xhigh：2つの穴は閉じる・正規機能の回帰なし（onboard・me・invite・members・profile・admin/** を確認）
- ファイル番号は既存の運用（migrations の末尾＝docs/sql の番号）に合わせて 018 に変更（migrations の 012〜017 と docs/sql の番号がずれないように）
- `supabase db push --linked` で本番に適用（dry-run で対象が本ファイル1本だけなのを確認してから）。適用後の pg_policies：theaters・theater_members の INSERT は is_admin() の2本だけ、theaters の UPDATE は従来どおり
- 悪用の跡の確認（読み取りのみ）：scout 劇団の所属 0／owner のアカウントが劇団より新しい 0／owner の所属と劇団の作成時刻が2分以上ずれる 0／メンバーのいない self 劇団 1（福岡アクト劇団・2026-02-02・テストデータと思われる）
- Codex が拾った範囲外の穴（未対処・西山くんに報告）：招待の受諾が `ilike` でメールを照合（`_` がワイルドカード）＝High／generate-promotion がログインだけで他劇団の公開公演に宣伝文の行を作れる＝Medium／theater_invites の FOR ALL で editor が owner 限定を迂回＝Medium／旧URLの予約の衝突＝Medium／PV の水増し＝Low
