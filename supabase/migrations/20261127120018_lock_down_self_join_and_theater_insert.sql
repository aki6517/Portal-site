-- 穴1: theater_members の "Self can join as owner on onboarding" は theater_id を見ておらず、ログインした人がどの劇団にも自分を owner として足せた。
-- 穴2: theaters の "Authenticated users can create theater" は status = 'approved' しか見ておらず、ログインした人が承認済みの劇団を直接作れた。
-- どちらも運営者（is_admin()）だけが INSERT できるポリシーに置き換える。劇団登録・招待の受諾は service_role で書いているので RLS の影響を受けない。
-- 変えない: theaters の UPDATE ポリシー（管理画面の状態変更 app/api/admin/theaters/[id] がログイン中のクライアントで is_admin() に頼る。status 列はトリガー trg_prevent_theater_status_update が守る）。
-- 変えない: events・promotions・theater_invites・user_settings などのポリシー（自己登録をふさげば本物のメンバーだけになる）、関数 is_admin()・is_theater_member()、トリガー。

-- theater_members: 運営者だけが所属を足せるようにする
DROP POLICY IF EXISTS "Self can join as owner on onboarding" ON public.theater_members;
DROP POLICY IF EXISTS "Admins can add theater members" ON public.theater_members;
CREATE POLICY "Admins can add theater members"
ON public.theater_members FOR INSERT
TO authenticated
WITH CHECK (is_admin());

-- theaters: 運営者だけが劇団を作れるようにする
DROP POLICY IF EXISTS "Authenticated users can create theater" ON public.theaters;
-- 001_init.sql の旧ポリシー（003 で消しているはず。残っている環境でも誰でも INSERT できないよう念のため消す。無ければ何もしない）
DROP POLICY IF EXISTS "Authenticated users can create theater as pending" ON public.theaters;
DROP POLICY IF EXISTS "Admins can create theaters" ON public.theaters;
CREATE POLICY "Admins can create theaters"
ON public.theaters FOR INSERT
TO authenticated
WITH CHECK (is_admin());
