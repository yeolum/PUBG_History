# Supabase Migrations

Supabase SQL Editor에서 번호 순서대로 실행하세요.  
`IF NOT EXISTS` / `IF EXISTS` 처리가 되어 있어 이미 적용된 파일을 다시 실행해도 오류가 나지 않습니다.

| 번호 | 파일 | 내용 |
|------|------|------|
| 001 | `001_storage_buckets.sql` | images 버킷 (5MB) + map-images 버킷 (150MB) |
| 002 | `002_tournament_prize_config.sql` | 대회 Prize & Points 테이블 |
| 003 | `003_stage_prize_config.sql` | Prize Config에 stage 매핑 컬럼 추가 |
| 004 | `004_alias_images.sql` | team_aliases.logo_url, player_aliases.profile_pic |
| 005 | `005_series.sql` | Series 테이블 (Tournament → Series → Stage 계층) |
| 006 | `006_match_display_names.sql` | match_team_results / match_player_stats display_name |
| 007 | `007_stages_tournament_direct.sql` | ⚠️ series 제거, stages에 tournament_id 직접 연결 — **series 사용 중이면 실행 금지** |
| 008 | `008_teams_league.sql` | teams.league 컬럼 |
| 009 | `009_drop_locations.sql` | team_drop_locations + match_player_landings 테이블 |
| 010 | `010_currency_prizes.sql` | tournaments.currency + prize 컬럼 NUMERIC 변환 |
| 011 | `011_series_advancement.sql` | series 진출/탈락 규칙 + stage_prize_config series 타깃 |
| 012 | `012_tournament_roster.sql` | tournament_teams + tournament_players 참가 명단 |
| 013 | `013_player_team_sync.sql` | tournament_players.team_id + sync_player_current_teams 함수 |
| 014 | `014_tournament_dq.sql` | tournament_teams.disqualified |
| 015 | `015_wwcd_prize_series.sql` | WWCD rewards / Prize config → series 타깃 |
| 016 | `016_tournament_tag.sql` | tournaments.tag 배지 컬럼 |
| 017 | `017_combined_scoreboards.sql` | Combined Scoreboards 테이블 |
| 018 | `018_tab_order.sql` | series / stages / combined_scoreboards tab_order |
| 019 | `019_combined_scoreboard_advancement.sql` | Combined scoreboard 진출/탈락 규칙 |
| 020 | `020_tournament_team_display.sql` | tournament_teams.display_name |
| 021 | `021_special_awards_category.sql` | tournament_special_awards.category |
| 022 | `022_stage_flags.sql` | stages.include_in_total |
| 023 | `023_stage_additional_points.sql` | stage_additional_points 테이블 |
| 024 | `024_precomputed_stats.sql` | tournament_team_stats + tournament_player_stats |
| 025 | `025_stage_series_stats.sql` | stage_player_stats + series_player_stats |
| 026 | `026_scoring_rules.sql` | scoring_rules smash_sub_type + type 제약 조건 |
| 027 | `027_kill_club_100.sql` | kill_club_100 테이블 |
| 028 | `028_final_standings.sql` | tournament_final_standings 테이블 |
| 029 | `029_parent_team.sql` | teams.parent_team_id 조직 계층 |
| 030 | `030_tournament_type_update.sql` | tournament type: online/lan → regional |
