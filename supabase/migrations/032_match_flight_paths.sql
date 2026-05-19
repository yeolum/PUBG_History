-- 032: Match flight paths — aircraft trajectory points per match
CREATE TABLE IF NOT EXISTS match_flight_paths (
  match_id   UUID PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
  points     JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE match_flight_paths ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "flight_paths_public_read"   ON match_flight_paths;
DROP POLICY IF EXISTS "flight_paths_service_write" ON match_flight_paths;
CREATE POLICY "flight_paths_public_read"   ON match_flight_paths FOR SELECT USING (true);
CREATE POLICY "flight_paths_service_write" ON match_flight_paths FOR ALL    USING (auth.uid() IS NOT NULL);
