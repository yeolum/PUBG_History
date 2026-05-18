-- =====================================================
-- 004: Per-alias Images (historical logos / profile pics)
-- =====================================================

ALTER TABLE team_aliases   ADD COLUMN IF NOT EXISTS logo_url    TEXT;
ALTER TABLE player_aliases ADD COLUMN IF NOT EXISTS profile_pic TEXT;

DROP POLICY IF EXISTS "team_aliases_update_auth" ON team_aliases;
CREATE POLICY "team_aliases_update_auth"
  ON team_aliases FOR UPDATE USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "player_aliases_update_auth" ON player_aliases;
CREATE POLICY "player_aliases_update_auth"
  ON player_aliases FOR UPDATE USING (auth.uid() IS NOT NULL);
