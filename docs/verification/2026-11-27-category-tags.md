# 2つ目からのカテゴリを「タグ」扱いにする＋劇団向けのエラーを日本語にする（実装指示書）

作成: 2026-11-27 せお／実装: Claude Code Opus 5.5 xhigh／独立レビュー: Codex gpt-6.2-sol xhigh／本番適用: せお（西山くん「2番、3番、1番の順番で実行して」）

```xml
<task>
【何をするか（A）2つ目からのカテゴリを「タグ」扱いにする】
公演のURLは /events/{主カテゴリ category}/{slug} の1つだけにする。categories（2つ目からのカテゴリ）は、一覧の絞り込み・表示に使うタグであって、URLの持ち主を決めるものではない、という考え方に統一する。
2026-11-27 の2便目（docs/verification/2026-11-27-security-batch-b-redirect-reservation.md）で、categories の組も「URLの組」として予約・登録・優先順位の判定に入れたため、端のケース（副カテゴリだけの予約衝突で 409、副カテゴリを共有する公演どうしの転送の向き、など）が残っている。これを、主カテゴリの組だけを扱う形に単純にする。

A-1 公開ページ（app/events/[category]/[slug]/page.tsx・lib/data/events.ts の pickMatchedEvent）の解決順を次にする
  1. 主カテゴリが一致する公演（公開中）→ そのまま表示
  2. event_redirects の (category, slug) の転送 → 転送先へ 308（転送先が存在するが今は公開ページに出ないなら 404、転送先が今このURLそのものなら転送しない、は2便目のまま）
  3. 同じ slug の公演（主カテゴリは違う・公開中）→ その公演の正式URLへ 308。候補が複数なら categories にリクエストのカテゴリを含む公演を先に、それも同じなら今の並び順の先頭
  4. event_redirects に、同じ from_slug の行がほかのカテゴリにあり、有効な転送先（公開中）が1つの公演に決まるなら、そこへ 308（slug を変えた公演の、2つ目からのカテゴリの古いURL /events/{副カテゴリ}/{古いslug} を救うため）。転送先が複数の公演に分かれるなら 404
  5. どれも無ければ 404
  - categories の一致は「表示する公演を選ぶ理由」にはもうしない（3 の候補の並べ替えにだけ使う）。今は categories の一致で選ばれた公演も 308 で正式URLへ送っているので、見た目の変化は 2〜4 の順番だけのはず。違いがあれば報告に書く
  - 編集ページ（app/events/[category]/[slug]/edit/page.tsx）も、主カテゴリが一致する公演を選ぶ。無ければ今の挙動（categories の一致）を残してよいが、どちらにしたか報告に書く

A-2 POST（app/api/theater/events/route.ts）・PATCH（app/api/theater/events/[id]/route.ts）
  - 予約確認（ほかの公演の旧URLとして使われている組か）は、保存後の主カテゴリの組 (category, slug) だけを見る。categories の組は見ない
    - PATCH では「主カテゴリの組が変わるとき」と「保存で公開ページに出る状態になるとき（下書きの公開など）」に確かめる（2便目のまま）
  - 旧URLの登録は、主カテゴリの組が変わり、保存前の公演が公開ページに出ていたときだけ、保存前の主カテゴリの組を1つ登録する。categories の組の登録と、そのための「持ち主の確認」はやめる
  - 新しい主カテゴリの組の重複の事前確認（409）、登録を更新の前に行うこと、上書きしない登録（ignoreDuplicates・空の転送先だけ向け直す）、category・categories の形式検査は残す
  - 2便目で足したもののうち、A の考え方で要らなくなったコード（categories の組を集める関数など）は消してよい。消したものを報告に書く
  - 本番の event_redirects にある既存の行（2つ目からのカテゴリの組の行も含む）は消さない・書き換えない。既存の行は A-1 の 2 でそのまま効く

【何をするか（B）劇団向けの画面に出るエラーを日本語にする】
劇団向けの画面（app/theater/**、app/register/**、app/events/[category]/[slug]/edit/**）から呼ばれる API が返す error.message のうち、英語の文、または DB のエラー文をそのまま返しているものを、劇団の人が読んで次に何をすればいいか分かる日本語にする。
  - 対象の API：app/api/theater/**、app/api/ai/generate-promotion、app/api/storage/flyers（ほかに劇団向けの画面から呼んでいる API があれば含める。grep で呼び出し元を確かめる）
  - error.code（機械が読む値）と HTTP ステータスは変えない。message だけ変える
  - DB のエラー文（PostgREST の message）は応答に出さない。サーバーのログ（console.error）に code と message を残し、応答は日本語の決まった文にする。よくあるものは個別の文にする：
    - 一意制約（23505）で公演のURLがぶつかる → 「このURL（英字）は、ほかの公演がすでに使っています。別の英字にしてください。」
    - 外部キー（23503）でカテゴリ・会場が見つからない → 何が見つからないか分かる文
    - それ以外の DB エラー → 「保存に失敗しました。時間をおいてもう一度お試しください。続く場合は福岡アクトポータル運営にお問い合わせください。」（読み取りなら「読み込みに失敗しました。…」）
  - すでに日本語の文は変えない（今日入れたスラッグ検査・承認済みでない劇団・SLUG_RESERVED・所属の確認など）
  - 画面側（EventForm・EditEventScreen・theater/page・settings・register）が message の英語の文字列で分岐していないかを確かめる。分岐していたら code で分岐するように直す（その画面ファイルを対象に含めてよい）。分岐していなければ画面は変えない
  - 画面側で英語の文を直接書いて表示している箇所があれば、それも日本語にする（同じく対象に含めてよい）
  - 文体：です・ます。短く。専門用語（DB・トークン・制約など）を使わない

【変えないもの】
- 公開の閲覧数 API（app/api/views）、運営者向けの API（app/api/admin/**）、公開ページの 404・308 以外の挙動
- RLS・マイグレーション（今回は DB を変えない）
- 2便目・3便目で入れた安全のための検査（形式検査・承認済み劇団の公開制限・予約確認・登録の上書き防止など）。A で「主カテゴリの組だけ」に変えるところ以外はそのまま

【読む範囲】
- 読んでよい: CLAUDE.md、app/、lib/、docs/verification/2026-11-27-*.md、docs/sql/、supabase/migrations/
- 読まなくていい: node_modules・.next・content/・public/・scripts/

【完了条件】
- A と B が入っていること
- `npx tsc --noEmit --incremental false` がエラー 0 件、変更したファイルの eslint で新しいエラーが出ないこと
- 既存のハーネス（scratchpad の slug-guard-check/route-harness の run.mjs・run-status.mjs、batch-b/harness の run-routes・run-page・run-r2・run-r3・run-edit-page、security-batch-a/harness）を流し、結果が変わったケースは「A・B の仕様で意図して変わったもの」か「壊れたもの」かを1件ずつ表で分ける。壊れたものは 0 件にする。意図して変わったものは期待を直してよい（直す前の版は .bak で残す）
- A のハーネスを足す：主カテゴリ一致／転送（有効・非公開・自分のURL）／同じ slug の別カテゴリの公演（1件・複数で categories に含む方が先）／同じ from_slug の別カテゴリの転送（転送先が1つ・複数）／どれも無い、の公開ページの結果。POST・PATCH で「categories だけの組の衝突では 409 にならない」「categories の組は登録しない」「主カテゴリの組は今までどおり確認・登録する」
- B のハーネスを足す：一意制約・外部キー・その他の DB エラーのとき、応答の message が日本語の決まった文で、DB のエラー文を含まず、code とステータスは前と同じ。変えた message の一覧（ファイル・行・前・後）を表にする

【背景】
- サイト内のリンク（トップ・一覧・カレンダー・サイトマップ・劇団の画面）は主カテゴリのURLを使っている（せおが確認済み）
- カテゴリ別の一覧は category と categories の両方で絞り込んでいる（lib/data/events.ts 263行付近）。タグ扱いにしても一覧には今までどおり出る
- 本番の categories 表には 12 件（action・classic・comedy・conte・conversation・dance・drama・experimental・musical・other・serious・student）
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
npx eslint <変更したファイル>
grep -rn 'message:' app/api/theater app/api/ai app/api/storage（英語・DBの文が残っていないか）
</verification_loop>

<action_safety>
Keep changes tightly scoped to the stated task.
Avoid unrelated refactors, renames, or cleanup unless they are required for correctness.
Call out any risky or irreversible action before taking it.
子エージェント（Claude の Agent ツール）を使わず自分で実装する。レビューは外から別途回す。

【このタスクで触ってはいけないもの】
- DB・Supabase への接続、Vercel の設定、git commit / push / branch 操作、`npm run build`・`npm run dev`
- 対象ファイル以外の変更（必要だと判断したら、変えずに報告）
- 言いなりに直さない。この指示書に矛盾や穴があれば、根拠をつけて報告に書く
- 保証できないことを保証するふりをしない
</action_safety>

<structured_output_contract>
報告は次の 5 項目だけ（日本語で）:
1. 変更したファイル（`git status --short --untracked-files=all` の出力をそのまま）
2. 何をどう変えたか（ファイルごとに 2〜4 行。消したコードも）
3. 検証の結果（コマンドと出力の要点、ハーネスの表、変えた message の表）
4. 未解決・気になる点（ドキュメントとコードの食い違いも）
5. 自己レビュー（直さずに、重大度 High/Medium/Low・行番号・理由）
</structured_output_contract>
```

## 判定と適用（C-4・せお・2026-11-27）

ship（西山くん「2番、3番、1番の順番で実行して」）。Codex gpt-6.2-sol xhigh 2周＋実装担当の修正（3周）と自己レビュー。2周目で 1周目の High の解消を確認。DB の変更なし。

- **上の A-1 の解決順 4（同じ from_slug の別カテゴリの転送からの推測）は、Codex 1周目の指摘（使われたことのないURLまで転送する・ブラウザが覚えた 308 で転送のループ）で、やめた**。解決順は「主カテゴリ一致 → (category, slug) の転送 → 同じ slug の別カテゴリの公演 → 404」の4段
- 1周目で直したもの：公開ページの解決で使う読み取りのエラーを例外にし、キャッシュに入れない（一時的な失敗で正式URLが別公演へ 308 される High）／ログインの英語のエラーを日本語に／サーバーログは DB の code・message と Gemini のステータス・識別子だけ／画面に内部の識別子や通信断の英語を出さない／23505 は uniq_events_category_slug のときだけ URL の文／公演一覧・編集画面の読み込み失敗を表示／onboard の 42501／本文と項目の型の確認で 400
- 2周目で直したもの：AI の応答の JSON の読み取り失敗で応答の断片がログに残る／小数の料金で 500（→ 400「料金は円単位の整数…」・入力欄に案内）／Google ログインからエラー付きで戻ったときの案内／cast・platforms の型／onboard の 42501 は運営への問い合わせの案内
- 記録だけ：英字を変えたあとの、2つ目からのカテゴリの古いURLは 404（開くと主カテゴリのURLへ転送されるので、共有されることはほぼない）／同時保存の競合／解決順3の「同じ英字の別の公演へ行く」推測（前から）／ticket_types の中の金額（JSONB）の小数／ai_confidence の範囲／一覧・カレンダーなど解決以外の読み取りのエラーの扱い／theater の /api/theater/me の通信断で「読み込み中」のまま（前から）
- 本番データの確認：公演 153 件で、負の料金 0 件・形の違う cast 0 件（新しい確認で編集できなくなる公演はない）
- ハーネス：route-harness・batch-b の5本・security-batch-a・batch-c・category-tags の run-a・run-a1・run-b（150件）・run-screens（37件）すべて ALL OK
