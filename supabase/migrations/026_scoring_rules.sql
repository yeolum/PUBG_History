-- =====================================================
-- 026: Scoring Rules — Smash Sub-type + Type Constraint
-- =====================================================

ALTER TABLE scoring_rules ADD COLUMN IF NOT EXISTS smash_sub_type TEXT;

ALTER TABLE scoring_rules DROP CONSTRAINT IF EXISTS scoring_rules_type_check;
ALTER TABLE scoring_rules ADD CONSTRAINT scoring_rules_type_check
  CHECK (type IN ('super', 'super_v1', 'chicken', 'chicken_v2', 'smash'));
