-- =====================================================
-- 018: Tab Order for Scoreboard Sections
-- series / standalone stage / combined scoreboard 모두 tab_order 로 정렬
-- =====================================================

ALTER TABLE series               ADD COLUMN IF NOT EXISTS tab_order INT NOT NULL DEFAULT 0;
ALTER TABLE stages                ADD COLUMN IF NOT EXISTS tab_order INT NOT NULL DEFAULT 0;
ALTER TABLE combined_scoreboards ADD COLUMN IF NOT EXISTS tab_order INT NOT NULL DEFAULT 0;

-- backfill: 기존 order_num 기반으로 초기값 설정
UPDATE series sr
SET tab_order = COALESCE((
  SELECT MIN(s.order_num) FROM stages s WHERE s.series_id = sr.id
), 999999)
WHERE tab_order = 0;

UPDATE stages SET tab_order = order_num WHERE series_id IS NULL AND tab_order = 0;

UPDATE combined_scoreboards cb
SET tab_order = COALESCE((
  SELECT MIN(s.order_num) FROM stages s
  JOIN combined_scoreboard_stages css ON css.stage_id = s.id
  WHERE css.combined_scoreboard_id = cb.id
), 999999)
WHERE tab_order = 0;
