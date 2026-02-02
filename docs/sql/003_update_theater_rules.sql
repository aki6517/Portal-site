BEGIN;

-- ------------------------------------------------------------
-- 劇団登録は承認不要: 既定ステータスを approved にする
-- ------------------------------------------------------------
ALTER TABLE theaters ALTER COLUMN status SET DEFAULT 'approved';

-- 既存スキーマでは「status変更は admin/service_role のみ」というトリガーがあるため、
-- そのまま UPDATE すると弾かれることがあります。ここでは一時的にトリガーを無効化して更新します。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_prevent_theater_status_update'
  ) THEN
    EXECUTE 'ALTER TABLE theaters DISABLE TRIGGER trg_prevent_theater_status_update';
  END IF;
END $$;

UPDATE theaters SET status = 'approved' WHERE status = 'pending';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_prevent_theater_status_update'
  ) THEN
    EXECUTE 'ALTER TABLE theaters ENABLE TRIGGER trg_prevent_theater_status_update';
  END IF;
END $$;

-- 登録時ポリシーを更新（approvedのみ許可）
DROP POLICY IF EXISTS "Authenticated users can create theater as pending" ON theaters;
CREATE POLICY "Authenticated users can create theater"
ON theaters FOR INSERT
TO authenticated
WITH CHECK (status = 'approved');

-- 同名劇団の重複登録を禁止（大文字小文字無視）
CREATE UNIQUE INDEX IF NOT EXISTS uniq_theaters_name_ci
  ON theaters (lower(name));

-- ------------------------------------------------------------
-- 劇団メンバー招待（2人目メール）用テーブル
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS theater_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  theater_id UUID NOT NULL REFERENCES theaters(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_theater_invites_email
  ON theater_invites (theater_id, lower(email));

CREATE INDEX IF NOT EXISTS idx_theater_invites_email
  ON theater_invites (lower(email));

-- updated_at 自動更新
DROP TRIGGER IF EXISTS update_theater_invites_updated_at ON theater_invites;
CREATE TRIGGER update_theater_invites_updated_at
BEFORE UPDATE ON theater_invites
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE theater_invites ENABLE ROW LEVEL SECURITY;

-- メンバー自身は自分の membership のみ参照（再帰回避）
DROP POLICY IF EXISTS "Theater members can view members" ON theater_members;
CREATE POLICY "Members can view own membership"
ON theater_members FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR is_admin());

-- 招待管理（劇団メンバー or 管理者）
DROP POLICY IF EXISTS "Theater members can manage invites" ON theater_invites;
CREATE POLICY "Theater members can manage invites"
ON theater_invites FOR ALL
TO authenticated
USING (is_theater_member(theater_id) OR is_admin())
WITH CHECK (is_theater_member(theater_id) OR is_admin());

COMMIT;
