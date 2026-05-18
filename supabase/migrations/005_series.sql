-- =====================================================
-- 005: Series (Tournament → Series → Stage → Match 계층)
-- =====================================================

CREATE TABLE IF NOT EXISTS series (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  order_num     INT  NOT NULL DEFAULT 0,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_series_tournament_v2 ON series(tournament_id);

ALTER TABLE stages ADD COLUMN IF NOT EXISTS series_id UUID REFERENCES series(id) ON DELETE SET NULL;

ALTER TABLE series ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "series_public_read"  ON series FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "series_auth_insert"  ON series FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY IF NOT EXISTS "series_auth_update"  ON series FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY IF NOT EXISTS "series_auth_delete"  ON series FOR DELETE USING (auth.uid() IS NOT NULL);
