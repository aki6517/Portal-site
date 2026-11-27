-- 運営が先に載せた劇団（theaters.origin = 'scout' など、メンバーが 0 人の劇団）を、劇団の本人が「引き継ぎ」を申し込み、
-- 運営が承認するとその劇団の代表（theater_members の owner）になれるようにするための申し込みの表。
-- 申し込み（app/api/theater/claims）・運営の承認／見送り（app/api/admin/claims/[id]）・管理画面（app/admin/claims）は
-- すべて service_role で読み書きする。ログイン中の利用者のクライアントからは使わないので、RLS を有効にしてポリシーは作らず、
-- 表の権限も anon・authenticated から外す（theater_members への書き込みも今までどおり service_role だけ）。
-- 申し込みの作成（create_theater_claim）と承認（approve_theater_claim）は、確かめてから書くまでを 1 つのトランザクションにするため
-- DB の関数にする（supabase-js からはトランザクションを張れない）。どちらも劇団の行をロックするので、同じ劇団の承認と申し込みは 1 本ずつになる。
-- あわせて theater_members.user_id に auth.users への外部キー（ON DELETE CASCADE）を足す（アカウントを消すと所属も消え、引き継ぎを塞がない）。
-- 何度流しても同じ結果になるよう IF NOT EXISTS・CREATE OR REPLACE・「無いときだけ足す」を使う（REVOKE / GRANT・COMMENT も再実行してよい）。

CREATE TABLE IF NOT EXISTS public.theater_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  theater_id uuid NOT NULL REFERENCES public.theaters(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- 申し込んだときのログインのメール（結果のお知らせの宛先）
  email text NOT NULL,
  applicant_name text,
  role_note text,
  message text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid,
  CONSTRAINT theater_claims_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  -- 文字数（char_length は文字の数。app/api/theater/claims も同じ数え方で先に確かめる）
  CONSTRAINT theater_claims_applicant_name_length
    CHECK (applicant_name IS NULL OR char_length(applicant_name) <= 100),
  CONSTRAINT theater_claims_role_note_length
    CHECK (role_note IS NULL OR char_length(role_note) <= 100),
  CONSTRAINT theater_claims_message_length
    CHECK (message IS NULL OR char_length(message) <= 1000)
);

COMMENT ON TABLE public.theater_claims IS
  '劇団の引き継ぎの申し込み（メンバーが 0 人の劇団の代表になりたい人の申し込み）。status: pending（運営の確認待ち）/ approved（承認・theater_members に owner を入れた）/ rejected（見送り）/ cancelled（本人が取り消し）。service_role だけが読み書きする（RLS 有効・ポリシーなし）';

-- 同じ人が同じ劇団に出せる確認待ち（pending）の申し込みは 1 件だけ
CREATE UNIQUE INDEX IF NOT EXISTS uniq_theater_claims_pending
  ON public.theater_claims (theater_id, user_id)
  WHERE status = 'pending';

-- 自分の申し込みの一覧（新しい順）・同時に持てる pending の件数を数える問い合わせ用
CREATE INDEX IF NOT EXISTS idx_theater_claims_user_created
  ON public.theater_claims (user_id, created_at DESC);

-- 管理画面の一覧（状態ごと・日時順）用
CREATE INDEX IF NOT EXISTS idx_theater_claims_status_created
  ON public.theater_claims (status, created_at);

-- 承認したときに同じ劇団のほかの pending を見送りにする問い合わせ・劇団を消したときの CASCADE 用
CREATE INDEX IF NOT EXISTS idx_theater_claims_theater
  ON public.theater_claims (theater_id);

ALTER TABLE public.theater_claims ENABLE ROW LEVEL SECURITY;

-- RLS（ポリシーなし）に加えて、表の権限も service_role だけにしておく
REVOKE ALL ON TABLE public.theater_claims FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.theater_claims TO service_role;

-- ------------------------------------------------------------
-- theater_members.user_id → auth.users(id) ON DELETE CASCADE
-- ------------------------------------------------------------
-- 今は外部キーが theater_id → theaters の 1 本だけで、アカウントを消しても所属の行が残り、メンバー 0 人の判定（引き継ぎ）を塞ぐ。
-- user_id から auth.users への外部キーが無いときだけ足す（名前が違っても、同じ向きの外部キーがあれば足さない）。
-- 足すときに今の行を確かめる（auth.users に無い user_id の行があれば、このマイグレーションは止まる。2026-11-27 の本番は 0 件）。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = 'public.theater_members'::regclass
      AND c.contype = 'f'
      AND c.confrelid = 'auth.users'::regclass
  ) THEN
    ALTER TABLE public.theater_members
      ADD CONSTRAINT theater_members_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END
$$;

-- ------------------------------------------------------------
-- 運営用の劇団の名前か（全角・半角・前後の空白・大文字小文字の違いは同じとみなす）
-- ------------------------------------------------------------
-- 名前の一覧は呼ぶ側（lib/theater/claims.ts の RESERVED_THEATER_NAMES）から渡す。一覧を DB に書き写さない。
CREATE OR REPLACE FUNCTION public.theater_claim_name_is_reserved(p_name text, p_reserved_names text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT p_name IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.unnest(p_reserved_names) AS r(name)
      WHERE pg_catalog.lower(pg_catalog.btrim(pg_catalog.normalize(r.name, 'NFKC')))
        = pg_catalog.lower(pg_catalog.btrim(pg_catalog.normalize(p_name, 'NFKC')))
    );
$$;

COMMENT ON FUNCTION public.theater_claim_name_is_reserved(text, text[]) IS
  '劇団名が運営用の劇団の名前の一覧（p_reserved_names）に入っているか。NFKC・前後の空白・大文字小文字の違いは同じとみなす。create_theater_claim・approve_theater_claim から使う';

REVOKE ALL ON FUNCTION public.theater_claim_name_is_reserved(text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.theater_claim_name_is_reserved(text, text[]) TO service_role;

-- ------------------------------------------------------------
-- 引き継ぎの申し込みを作る（app/api/theater/claims の POST から service_role で呼ぶ）
-- ------------------------------------------------------------
-- 1 つのトランザクションで: 利用者ごとのアドバイザリーロック → 劇団の行を FOR SHARE でロック（承認の FOR UPDATE と 1 本ずつになる）
-- → 劇団があるか・運営用でないか・本人がメンバーでないか・メンバーが 0 人か → 同じ劇団の確認待ちがあればそれを返す
-- → 確認待ちが p_pending_limit 件以上なら断る → 作る。断るときは何も書かずに理由を返す（例外にしない）。
-- should_notify: 同じ利用者・同じ劇団の申し込みが p_notify_cooldown_hours 時間以内に作られていなければ true（取り消して出し直すたびに運営へ知らせない）。
-- 結果の result: created / already_pending / theater_not_found / theater_reserved / already_member / theater_has_members / too_many_pending
CREATE OR REPLACE FUNCTION public.create_theater_claim(
  p_theater_id uuid,
  p_user_id uuid,
  p_email text,
  p_applicant_name text,
  p_role_note text,
  p_message text,
  p_reserved_names text[],
  p_pending_limit integer,
  p_notify_cooldown_hours integer
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_theater_name text;
  v_claim public.theater_claims%ROWTYPE;
  v_pending_count integer;
  v_recent boolean;
BEGIN
  IF p_theater_id IS NULL OR p_user_id IS NULL OR p_email IS NULL OR pg_catalog.btrim(p_email) = '' OR p_reserved_names IS NULL THEN
    RAISE EXCEPTION 'create_theater_claim: p_theater_id, p_user_id, p_email, p_reserved_names are required' USING ERRCODE = '22023';
  END IF;
  IF p_pending_limit IS NULL OR p_pending_limit < 1 OR p_notify_cooldown_hours IS NULL OR p_notify_cooldown_hours < 0 THEN
    RAISE EXCEPTION 'create_theater_claim: p_pending_limit must be >= 1 and p_notify_cooldown_hours >= 0' USING ERRCODE = '22023';
  END IF;

  -- 同じ利用者の申し込みを 1 本ずつにする（確認待ちの件数を数えてから作るまでに、同じ人のほかの申し込みを割り込ませない）
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('create_theater_claim|' || p_user_id::text, 0));

  -- 劇団の行をロックする。承認（approve_theater_claim の FOR UPDATE）が先なら、その確定を待ってから下を確かめる
  SELECT t.name INTO v_theater_name FROM public.theaters t WHERE t.id = p_theater_id FOR SHARE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('result', 'theater_not_found');
  END IF;

  IF public.theater_claim_name_is_reserved(v_theater_name, p_reserved_names) THEN
    RETURN pg_catalog.jsonb_build_object('result', 'theater_reserved');
  END IF;

  IF EXISTS (SELECT 1 FROM public.theater_members m WHERE m.theater_id = p_theater_id AND m.user_id = p_user_id) THEN
    RETURN pg_catalog.jsonb_build_object('result', 'already_member');
  END IF;

  IF EXISTS (SELECT 1 FROM public.theater_members m WHERE m.theater_id = p_theater_id) THEN
    RETURN pg_catalog.jsonb_build_object('result', 'theater_has_members');
  END IF;

  -- 同じ人の同じ劇団への確認待ちがあれば、それを返す（二重に作らない）
  SELECT * INTO v_claim FROM public.theater_claims c WHERE c.theater_id = p_theater_id AND c.user_id = p_user_id AND c.status = 'pending';
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object('result', 'already_pending', 'theater_name', v_theater_name, 'claim', pg_catalog.to_jsonb(v_claim));
  END IF;

  SELECT pg_catalog.count(*) INTO v_pending_count FROM public.theater_claims c WHERE c.user_id = p_user_id AND c.status = 'pending';
  IF v_pending_count >= p_pending_limit THEN
    RETURN pg_catalog.jsonb_build_object('result', 'too_many_pending', 'pending_count', v_pending_count);
  END IF;

  -- 作る前に、同じ人・同じ劇団の申し込みが最近あったかを見る（取り消して出し直したときは、運営へ知らせない）
  SELECT EXISTS (SELECT 1 FROM public.theater_claims c WHERE c.theater_id = p_theater_id AND c.user_id = p_user_id AND c.created_at > pg_catalog.now() - pg_catalog.make_interval(hours => p_notify_cooldown_hours)) INTO v_recent;

  INSERT INTO public.theater_claims (theater_id, user_id, email, applicant_name, role_note, message, status) VALUES (p_theater_id, p_user_id, pg_catalog.btrim(p_email), p_applicant_name, p_role_note, p_message, 'pending') RETURNING * INTO v_claim;

  RETURN pg_catalog.jsonb_build_object('result', 'created', 'theater_name', v_theater_name, 'claim', pg_catalog.to_jsonb(v_claim), 'should_notify', NOT v_recent);
END;
$$;

COMMENT ON FUNCTION public.create_theater_claim(uuid, uuid, text, text, text, text, text[], integer, integer) IS
  '引き継ぎの申し込みを作る（確かめてから作るまでを 1 トランザクションで）。利用者ごとのアドバイザリーロックと劇団の行の FOR SHARE ロックを取る。app/api/theater/claims から service_role で呼ぶ';

REVOKE ALL ON FUNCTION public.create_theater_claim(uuid, uuid, text, text, text, text, text[], integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_theater_claim(uuid, uuid, text, text, text, text, text[], integer, integer) TO service_role;

-- ------------------------------------------------------------
-- 引き継ぎの申し込みを承認する（app/api/admin/claims/[id] の PATCH approve から service_role で呼ぶ）
-- ------------------------------------------------------------
-- 1 つのトランザクションで: 劇団の行を FOR UPDATE でロック → 申し込みの行もロックして pending か → 承認する人が運営者か
-- → 運営用の劇団でないか → メンバーが 0 人か → owner を入れる → 申し込みを approved → 同じ劇団のほかの確認待ちを rejected。
-- どれかに当たらなければ何も書かずに理由を返す（例外にしない）。途中の INSERT・UPDATE が失敗したら全部取り消される。
-- 劇団の行の FOR UPDATE は、theater_members への INSERT の外部キーの確認（FOR KEY SHARE）ともぶつかるので、
-- この承認が確定するまで、同じ劇団にほかの経路でメンバーが入ることもない。
-- 結果の result: approved / claim_not_found / theater_not_found / not_pending / not_admin / theater_reserved / theater_has_members
CREATE OR REPLACE FUNCTION public.approve_theater_claim(
  p_claim_id uuid,
  p_decided_by uuid,
  p_reserved_names text[]
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_theater_id uuid;
  v_theater_name text;
  v_claim public.theater_claims%ROWTYPE;
  v_superseded jsonb;
  v_now timestamptz := pg_catalog.now();
BEGIN
  IF p_claim_id IS NULL OR p_decided_by IS NULL OR p_reserved_names IS NULL THEN
    RAISE EXCEPTION 'approve_theater_claim: p_claim_id, p_decided_by, p_reserved_names are required' USING ERRCODE = '22023';
  END IF;

  SELECT c.theater_id INTO v_theater_id FROM public.theater_claims c WHERE c.id = p_claim_id;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('result', 'claim_not_found');
  END IF;

  -- 劇団の行をロックする（同じ劇団の承認・申し込みの作成・メンバーの追加は、この確定を待つ）
  SELECT t.name INTO v_theater_name FROM public.theaters t WHERE t.id = v_theater_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('result', 'theater_not_found');
  END IF;

  -- 申し込みの行もロックして読み直す（ロックを待つ間に、本人の取り消し・ほかの承認があったかもしれない）
  SELECT * INTO v_claim FROM public.theater_claims c WHERE c.id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('result', 'claim_not_found');
  END IF;
  IF v_claim.status <> 'pending' THEN
    RETURN pg_catalog.jsonb_build_object('result', 'not_pending', 'status', v_claim.status);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = p_decided_by) THEN
    RETURN pg_catalog.jsonb_build_object('result', 'not_admin');
  END IF;

  IF public.theater_claim_name_is_reserved(v_theater_name, p_reserved_names) THEN
    RETURN pg_catalog.jsonb_build_object('result', 'theater_reserved');
  END IF;

  IF EXISTS (SELECT 1 FROM public.theater_members m WHERE m.theater_id = v_theater_id) THEN
    RETURN pg_catalog.jsonb_build_object('result', 'theater_has_members');
  END IF;

  INSERT INTO public.theater_members (theater_id, user_id, role) VALUES (v_theater_id, v_claim.user_id, 'owner');

  UPDATE public.theater_claims SET status = 'approved', decided_at = v_now, decided_by = p_decided_by WHERE id = p_claim_id;

  WITH superseded AS (UPDATE public.theater_claims SET status = 'rejected', decided_at = v_now, decided_by = p_decided_by WHERE theater_id = v_theater_id AND status = 'pending' AND id <> p_claim_id RETURNING id, email, applicant_name) SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', s.id, 'email', s.email, 'applicant_name', s.applicant_name)), '[]'::jsonb) INTO v_superseded FROM superseded s;

  RETURN pg_catalog.jsonb_build_object('result', 'approved', 'theater_id', v_theater_id, 'theater_name', v_theater_name, 'user_id', v_claim.user_id, 'claim', pg_catalog.jsonb_build_object('id', v_claim.id, 'email', v_claim.email, 'applicant_name', v_claim.applicant_name, 'status', 'approved', 'decided_at', v_now), 'superseded', v_superseded);
END;
$$;

COMMENT ON FUNCTION public.approve_theater_claim(uuid, uuid, text[]) IS
  '引き継ぎの申し込みを承認する（劇団の行の FOR UPDATE ロックのもとで、確かめる → owner を入れる → approved → 同じ劇団のほかの確認待ちを rejected、を 1 トランザクションで）。app/api/admin/claims/[id] から service_role で呼ぶ';

REVOKE ALL ON FUNCTION public.approve_theater_claim(uuid, uuid, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_theater_claim(uuid, uuid, text[]) TO service_role;
