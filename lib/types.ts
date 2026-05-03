export type TournamentStatus = 'upcoming' | 'ongoing' | 'completed'
export type TournamentType = 'online' | 'lan' | 'regional' | 'global'
export type StageType = 'group' | 'playoff' | 'grand_final'
export type MatchStatus = 'pending' | 'imported' | 'error'

export interface Team {
  id: string
  name: string
  short_name: string | null
  logo_url: string | null
  nationality: string | null
  description: string | null
  league: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface TeamAlias {
  id: string
  team_id: string
  alias: string
  logo_url: string | null
  created_at: string
}

export interface TeamWithAliases extends Team {
  team_aliases: TeamAlias[]
}

export interface Player {
  id: string
  nickname: string
  real_name: string | null
  nationality: string | null
  nationality_code: string | null
  birth_date: string | null
  team_id: string | null
  profile_pic: string | null
  description: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface PlayerAlias {
  id: string
  player_id: string
  alias: string
  profile_pic: string | null
  created_at: string
}

export interface PlayerWithDetails extends Player {
  player_aliases: PlayerAlias[]
  teams: { id: string; name: string; short_name: string | null } | null
}

export type RankingMethod = 'stage' | 'prize' | 'pgs' | 'pgc'

export interface Tournament {
  id: string
  name: string
  short_name: string | null
  type: TournamentType
  region: string | null
  start_date: string | null
  end_date: string | null
  prize_pool: number | null
  currency: string
  status: TournamentStatus
  banner_url: string | null
  description: string | null
  has_prize: boolean
  has_pgs_points: boolean
  has_pgc_points: boolean
  ranking_method: RankingMethod
  created_at: string
  updated_at: string
}

export interface TournamentPrizeConfig {
  rank: number
  prize: number | null
  pgs_points: number | null
  pgc_points: number | null
  stage_id: string | null
  series_id: string | null
  stage_rank: number | null
}

export interface Series {
  id: string
  tournament_id: string
  name: string
  order_num: number
  advance_count: number | null
  eliminate_count: number | null
  created_at: string
}

export interface ScoringRule {
  id: string
  name: string
  type: 'super' | 'super_v1' | 'chicken'
  placement_pts: number[]
  kill_pts: number
  description: string | null
  created_at: string
}

export interface Stage {
  id: string
  tournament_id: string
  series_id: string | null
  name: string
  order_num: number
  type: StageType
  advance_count: number | null
  eliminate_count: number | null
  scoring_rule_id: string | null
  scoring_rules?: ScoringRule | null
  created_at: string
}

export interface Match {
  id: string
  stage_id: string
  pubg_match_id: string | null
  match_date: string | null
  map: string | null
  game_mode: string | null
  duration: number | null
  status: MatchStatus
  order_num: number
  error_msg: string | null
  created_at: string
  updated_at: string
}

export interface MatchTeamResult {
  id: string
  match_id: string
  team_id: string | null
  pubg_roster_id: string | null
  pubg_team_name: string | null
  display_name: string | null
  placement: number | null
  total_kills: number
  total_damage: number
  created_at: string
  teams?: Team | null
}

export interface MatchPlayerStat {
  id: string
  match_id: string
  player_id: string | null
  team_id: string | null
  pubg_account_id: string | null
  pubg_player_name: string | null
  display_name: string | null
  kills: number
  assists: number
  knocks: number
  headshot_kills: number
  damage_dealt: number
  survival_time: number
  walk_distance: number
  ride_distance: number
  placement: number | null
  created_at: string
  players?: Player | null
  teams?: Team | null
}

export interface StageTeamStanding {
  stage_id: string
  stage_name: string
  team_id: string | null
  team_name: string
  team_short_name: string | null
  matches_played: number
  total_kills: number
  total_damage: number
  avg_placement: number
  placement_points: number
  total_points: number
}

// PUBG API 파싱 결과
export interface PubgRoster {
  pubgRosterId: string
  placement: number
  totalKills: number
  participants: PubgParticipant[]
}

export interface PubgParticipant {
  pubgAccountId: string
  pubgPlayerName: string
  kills: number
  assists: number
  knocks: number
  headshotKills: number
  damageDealt: number
  survivalTime: number
  walkDistance: number
  rideDistance: number
  winPlace: number
}

export interface PubgMatchData {
  pubgMatchId: string
  matchDate: string
  map: string
  gameMode: string
  duration: number
  rosters: PubgRoster[]
}

export interface ImportMatchResult {
  success: boolean
  matchData?: PubgMatchData
  droppedTeams: string[]
  droppedPlayers: string[]
  error?: string
}
