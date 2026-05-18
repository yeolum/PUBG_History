-- =====================================================
-- 010: Tournament Currency + Numeric Prize Columns
-- =====================================================

ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS currency TEXT;

UPDATE tournaments
SET currency = CASE
  WHEN prize_pool LIKE 'A$%'  THEN 'AUD'
  WHEN prize_pool LIKE 'S$%'  THEN 'SGD'
  WHEN prize_pool LIKE 'CN¥%' THEN 'CNY'
  WHEN prize_pool LIKE '$%'   THEN 'USD'
  WHEN prize_pool LIKE '€%'   THEN 'EUR'
  WHEN prize_pool LIKE '₩%'   THEN 'KRW'
  WHEN prize_pool LIKE '£%'   THEN 'GBP'
  WHEN prize_pool LIKE '¥%'   THEN 'JPY'
  ELSE NULL
END
WHERE currency IS NULL AND prize_pool IS NOT NULL;

UPDATE tournaments t
SET currency = sub.cur
FROM (
  SELECT DISTINCT ON (pc.tournament_id) pc.tournament_id,
    CASE
      WHEN pc.prize LIKE 'A$%'  THEN 'AUD'
      WHEN pc.prize LIKE 'S$%'  THEN 'SGD'
      WHEN pc.prize LIKE 'CN¥%' THEN 'CNY'
      WHEN pc.prize LIKE '$%'   THEN 'USD'
      WHEN pc.prize LIKE '€%'   THEN 'EUR'
      WHEN pc.prize LIKE '₩%'   THEN 'KRW'
      WHEN pc.prize LIKE '£%'   THEN 'GBP'
      WHEN pc.prize LIKE '¥%'   THEN 'JPY'
      ELSE NULL
    END AS cur
  FROM tournament_prize_config pc
  WHERE pc.prize IS NOT NULL
) sub
WHERE t.id = sub.tournament_id AND t.currency IS NULL AND sub.cur IS NOT NULL;

UPDATE tournaments SET currency = 'USD' WHERE currency IS NULL;
ALTER TABLE tournaments ALTER COLUMN currency SET DEFAULT 'USD';
ALTER TABLE tournaments ALTER COLUMN currency SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'tournaments' AND column_name = 'prize_pool' AND data_type = 'text') THEN
    ALTER TABLE tournaments
      ALTER COLUMN prize_pool TYPE NUMERIC
      USING NULLIF(REGEXP_REPLACE(COALESCE(prize_pool, ''), '[^0-9]', '', 'g'), '')::NUMERIC;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'tournament_prize_config' AND column_name = 'prize' AND data_type = 'text') THEN
    ALTER TABLE tournament_prize_config
      ALTER COLUMN prize TYPE NUMERIC
      USING NULLIF(REGEXP_REPLACE(COALESCE(prize, ''), '[^0-9]', '', 'g'), '')::NUMERIC;
  END IF;
END $$;
