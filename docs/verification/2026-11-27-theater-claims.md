# 運営が先に載せた劇団を、本人が「引き継ぎを申し込む」しくみ（実装指示書）

作成: 2026-11-27 せお／実装: Claude Code Opus 5.5 xhigh／独立レビュー: Codex gpt-6.2-sol xhigh／本番適用: せお（西山くん「①A」）

```xml
<task>
【困っていること】
福岡アクトポータルでは、運営が公演情報を先に集めて載せており、そのときに劇団（theaters・origin='scout'）も運営が作っている。本番の劇団 97 件のうち 83 件がこれで、メンバー（theater_members）は 0 人。
劇団の本人がログインして劇団を登録しようとすると、app/api/theater/onboard が「同じ名前の劇団が既に登録されています」（409）を返し、それ以上進めない（2026-11-06 に実際の問い合わせあり。そのときは運営が手で theater_members に owner を足した）。
これから福岡の劇団・大学演劇部に案内を送るので、本人が自分で「引き継ぎ」を申し込み、運営が承認すると、その劇団の代表（owner）になれるようにする。

【作るもの】
1. DB（マイグレーション supabase/migrations/20261127160022_theater_claims.sql、docs/sql/022_theater_claims.sql に同じ中身）
   - 表 public.theater_claims：id uuid PK default gen_random_uuid()、theater_id uuid NOT NULL REFERENCES theaters(id) ON DELETE CASCADE、user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE、email text NOT NULL（申し込んだときのログインのメール）、applicant_name text（任意・お名前）、role_note text（任意・劇団での立場）、message text（任意・ひとこと）、status text NOT NULL DEFAULT 'pending' CHECK (status in ('pending','approved','rejected','cancelled'))、created_at timestamptz NOT NULL DEFAULT now()、decided_at timestamptz、decided_by uuid
   - 同じ (theater_id, user_id) の pending は1件だけ（部分一意索引）
   - RLS を有効にし、ポリシーは作らない（service_role だけが使う）。表の権限も anon・authenticated から外す
   - 文字数の上限を CHECK で（applicant_name・role_note は 100、message は 1000）
   - 再実行しても失敗しないこと
2. 劇団登録（app/api/theater/onboard）の 409 を分ける
   - 同じ名前の劇団が「メンバー 0 人」なら：409 code "THEATER_CLAIMABLE"、data に { theater: { id, name } }、message「この劇団は、福岡アクトポータル運営がすでに情報を載せています。下の『引き継ぎを申し込む』から申し込むと、運営が確認してから、あなたのアカウントをこの劇団の代表としてつなぎます。」
   - 同じ名前の劇団に「メンバーがいる」なら：409 code は今のまま、message「同じ名前の劇団がすでに登録されています。この劇団のメンバーになりたい場合は、劇団の代表の方に『メンバーを追加』から招待してもらってください。」（画面の実際のボタン名を確かめて合わせる）
   - 劇団名の比較は今の onboard の方法に合わせるが、ilike の「_」「%」がワイルドカードになる既存の問題があるので、比較は「前後の空白を除いて小文字にした完全一致」にする（本番の劇団名の一意索引が小文字の名前に張られていることを docs/sql で確かめる）
3. 申し込みの API（新規 app/api/theater/claims/route.ts）
   - POST：ログイン必須。本文 { theater_id, applicant_name?, role_note?, message? }（型と長さを確かめて 400。既存の日本語の文の作り方に合わせる）
     - 劇団が無い → 404／劇団にメンバーがいる → 409（上の「メンバーがいる」と同じ文）／本人がすでにその劇団のメンバー → 409「すでにこの劇団のメンバーです。」
     - 同じ人の同じ劇団への pending がある → 200 で今の申し込みを返す（二重に作らない）
     - 1人が同時に持てる pending は 3 件まで（超えたら 429 か 409・日本語）
     - 作ったら、運営に知らせるメールを送る（app/api/contact と同じ送り方・同じ宛先 CONTACT_TO_EMAIL。件名「【引き継ぎの申し込み】{劇団名}」、本文に劇団名・申し込んだ人のメール・お名前・立場・ひとこと・管理画面のURL）。メールが送れなくても申し込みは成功にする（ログに残す）
     - メモリ上のレート制限（ほかの API と同じ形。1分5回程度）
   - GET：ログイン必須。自分の申し込み（劇団名・状態・日時）を新しい順に返す
   - DELETE（任意）：自分の pending を取り消す（cancelled に）。画面に「申し込みを取り消す」を置くなら作る
4. 運営の画面と API
   - 新規 app/admin/claims/page.tsx（運営者だけ。既存の app/admin の作り・運営者の確かめ方に合わせる）：pending の一覧（劇団名・公演数・申し込んだ人のメール・お名前・立場・ひとこと・日時）、それぞれに「承認する」「見送る」。処理済みも下に少し出す
   - 新規 app/api/admin/claims/[id]/route.ts（既存の app/api/admin/** の運営者の確かめ方に合わせる）：PATCH { action: "approve" | "reject" }
     - approve：その劇団にまだメンバーがいないことを確かめてから、theater_members に (theater_id, user_id, 'owner') を入れ、申し込みを approved・decided_at・decided_by に。同じ劇団のほかの pending は rejected に。メンバーがすでにいたら 409（承認しない）
     - reject：rejected に
     - 結果を申し込んだ人にメールで知らせる（承認：劇団の画面のURLとログインのしかた／見送り：短いお知らせと問い合わせ先）。送れなくても処理は成功
   - 管理画面のトップ（app/admin/page.tsx）か既存のナビに「引き継ぎの申し込み（N件）」への入口を足す
5. 劇団の画面（app/register/page.tsx）
   - onboard が THEATER_CLAIMABLE を返したら、劇団名と説明（上の message）と、入力欄（お名前・劇団での立場（例：主宰、制作）・ひとこと（任意））と「引き継ぎを申し込む」ボタンを出す
   - 申し込めたら「申し込みを受け付けました。運営が確認してから、ご登録のメールアドレスにお知らせします（ふだんは数日以内）。」と出す
   - 画面を開いたとき、自分の pending の申し込みがあれば、登録フォームの上に「『{劇団名}』の引き継ぎを申し込み中です（{日付}）。運営の確認をお待ちください。」を出す
   - 文は中学生でも次にやることがわかる日本語（です・ます・専門用語なし）。既存の画面の見た目・部品に合わせる
6. 劇団の画面の入口（app/theater/page.tsx）：劇団に所属していないとき、今は「劇団情報が未登録です」と /register への案内が出ている。ここで、すでにポータルに載っている劇団なら「引き継ぎ」ができることが分かる1行を足す（最小で）

【変えないもの】
- 今日入れた安全のための検査（RLS は運営者だけ・招待の完全一致・所属の確認など）。theater_members への書き込みは今までどおり service_role だけ
- 公開ページ・閲覧数・公演の API

【読む範囲】
- 読んでよい: CLAUDE.md、app/、lib/、docs/、supabase/migrations/
- 読まなくていい: node_modules・.next・content/・public/・scripts/

【完了条件】
- 1〜6 が入っていること
- `npx tsc --noEmit --incremental false` 0件、変更したファイルの eslint で新しいエラーなし
- 既存のハーネス（scratchpad の route-harness・batch-b・security-batch-a・batch-c・category-tags）が今までどおり通る（変わったケースは「意図／壊れた」で分けて表に。壊れたものは0件）
- 新しいハーネス（scratchpad/theater-claims/）で、onboard の 409 の分かれ方、申し込みの POST・GET・DELETE（未ログイン・型違い・劇団なし・メンバーあり・本人がメンバー・重複・pending 3件超・メールの失敗）、運営の承認・見送り（運営者でない→403、承認で owner が入る、すでにメンバーがいる→409、ほかの pending が rejected、メールの失敗）を実際に呼んで確かめる。画面（register の申し込み・申し込み中の表示、admin の一覧と承認）も模擬の応答で描画して文を確かめる
- マイグレーションの SQL を構文解析（scratchpad の libpg-query）と目で確かめる

【背景】
- 2026-11-27 時点：theaters 97（scout 83・メンバー0）、theater_members への INSERT の RLS は運営者だけ（20261127120018）。アプリは service_role で書く
- 運営者の判定は admins 表（app/api/admin/theaters/[id]/route.ts を参照）
</task>

<completeness_contract>
Resolve the task fully before stopping.
Do not stop at the first plausible answer.
Check whether there are follow-on fixes, edge cases, or cleanup needed for a correct result.
</completeness_contract>

<verification_loop>
Before finalizing, verify the result against the task requirements and the changed files or tool outputs.
If a check fails, revise the answer instead of reporting the first draft.
</verification_loop>

<action_safety>
Keep changes tightly scoped to the stated task.
Avoid unrelated refactors, renames, or cleanup unless they are required for correctness.
子エージェント（Claude の Agent ツール）を使わず自分で実装する。レビューは外から別途回す。

【このタスクで触ってはいけないもの】
- DB・Supabase への接続、Vercel の設定、メールの実際の送信、git commit / push / branch 操作、`npm run build`・`npm run dev`
- 対象外のファイルの変更（必要だと判断したら、変えずに報告）
- 言いなりに直さない。この指示書に矛盾や穴があれば、根拠をつけて報告に書く
- 保証できないことを保証するふりをしない
</action_safety>

<structured_output_contract>
報告は次の 5 項目だけ（日本語で）:
1. 変更したファイル（`git status --short --untracked-files=all` の出力をそのまま）
2. 何をどう変えたか（ファイルごとに 2〜4 行。マイグレーションは全文）
3. 検証の結果（コマンドと出力の要点、ハーネスの表）
4. 未解決・気になる点（ドキュメントとコードの食い違いも）
5. 自己レビュー（直さずに、重大度 High/Medium/Low・行番号・理由）
</structured_output_contract>
```

## 判定と適用（C-4・せお・2026-11-28）

ship（西山くん「①A」）。Codex gpt-6.2-sol xhigh 2周＋実装担当の修正（4回）と自己レビュー。2周目で High なし。

- 1周目の High（承認がひとまとまりでない）→ 承認と申し込みの作成を DB の関数（approve_theater_claim・create_theater_claim）にまとめ、劇団の行のロックで直列化
- ほかに直したもの：運営用の劇団（福岡アクトポータル編集部（外部情報））を対象外／公演の入力画面の使っていない「公演ページURL（AI解析用）」の欄を削除／取り消して出し直しても24時間は運営に知らせない／メールは after() で応答のあとに送る／theater_members.user_id → auth.users の外部キー（ON DELETE CASCADE）／自分の申し込みは確認待ちを全部返す／登録画面の送信状態を劇団ごと・古い応答を捨てる／運営へのメールの自由記入欄を引用に／23503 を 401・404 に／ドキュメント（04・03・08・sql/README）
- 記録だけ：承認とアカウント削除が同時のときのデッドロック（片方が失敗するだけ）／after の中のメールの順番待ち／新規登録の途中の一瞬に引き継げる／代表を消したあとに残った招待で editor だけになる／外部キーを足す条件・空白の除き方・作成 API の応答の確かめ・コメントの食い違い（Low）／運営用の劇団を名前だけで見分ける／劇団名の比較の * と候補20件／管理画面200件の上限／自動収集は引き継がれた劇団にも公演を足し続ける（公開で入る。下書きにするかは西山くんと相談）
- 本番 DB：dry-run で対象1本を確認して `supabase db push --linked`（コードより先）。本番で関数を DO ブロックの中で呼び、例外で巻き戻す形で確認：作成→重複は already_pending／運営者でない承認は not_admin／承認→owner→再承認は not_pending／owner のあとの申し込みは already_member／運営用は theater_reserved／メンバーありは theater_has_members／取り消して出し直しは created・should_notify=false／半角かっこの運営用の名前も予約／theater_members → auth.users の外部キーあり／anon・authenticated は関数を実行できない・表を読めない。巻き戻し後、仮の劇団0・申し込み0
