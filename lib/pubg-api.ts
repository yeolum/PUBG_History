import type { PubgMatchData, PubgRoster, PubgParticipant, PlanePath, TelemetryPlayerStats } from './types'

const PUBG_API_BASE = 'https://api.pubg.com'

// Map playable area in centimetres (used to normalise telemetry coordinates to 0-1)
export const MAP_BOUNDS: Record<string, { width: number; height: number }> = {
  Baltic_Main:     { width: 816000, height: 816000 }, // Erangel
  Erangel_Main:    { width: 816000, height: 816000 },
  Desert_Main:     { width: 816000, height: 816000 }, // Miramar
  Savage_Main:     { width: 408000, height: 408000 }, // Sanhok
  DihorOtok_Main:  { width: 624000, height: 624000 }, // Vikendi
  Summerland_Main: { width: 204000, height: 204000 }, // Karakin
  Tiger_Main:      { width: 816000, height: 816000 }, // Taego
  Kiki_Main:       { width: 816000, height: 816000 }, // Deston
  Neon_Main:       { width: 816000, height: 816000 }, // Rondo
  HeavenDawn_Main: { width: 408000, height: 408000 }, // Sanhok 2.0
}

// Strip "TAG - " prefix from team names like "GEN - Gen.G" → "Gen.G"
export function stripTagPrefix(name: string): string {
  const idx = name.indexOf(' - ')
  if (idx !== -1) return name.slice(idx + 3).trim()
  return name
}

export function normalizeCoords(mapName: string, x: number, y: number): { xNorm: number; yNorm: number } {
  const bounds = MAP_BOUNDS[mapName] ?? { width: 816000, height: 816000 }
  return {
    xNorm: Math.max(0, Math.min(1, x / bounds.width)),
    yNorm: Math.max(0, Math.min(1, y / bounds.height)),
  }
}

export interface PubgLanding {
  pubgPlayerName: string
  xNorm: number
  yNorm: number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parsePubgMatch(apiResponse: any): PubgMatchData {
  const { data, included } = apiResponse

  const matchAttr = data.attributes
  const pubgMatchId: string = data.id

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byType: Record<string, any[]> = {}
  for (const item of included) {
    if (!byType[item.type]) byType[item.type] = []
    byType[item.type].push(item)
  }

  const participantMap: Record<string, PubgParticipant> = {}
  for (const p of byType['participant'] ?? []) {
    const s = p.attributes.stats
    participantMap[p.id] = {
      pubgAccountId: s.playerId ?? p.id,
      pubgPlayerName: s.name ?? '',
      kills: s.kills ?? 0,
      assists: s.assists ?? 0,
      knocks: s.DBNOs ?? 0,
      headshotKills: s.headshotKills ?? 0,
      damageDealt: s.damageDealt ?? 0,
      survivalTime: Math.round(s.timeSurvived ?? 0),
      walkDistance: s.walkDistance ?? 0,
      rideDistance: s.rideDistance ?? 0,
      swimDistance: s.swimDistance ?? 0,
      longestKill: s.longestKill ?? 0,
      revives: s.revives ?? 0,
      healsUsed: s.heals ?? 0,
      boostsUsed: s.boosts ?? 0,
      winPlace: s.winPlace ?? 0,
    }
  }

  const rosters: PubgRoster[] = (byType['roster'] ?? []).map((r) => {
    const participants = (r.relationships?.participants?.data ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((ref: any) => participantMap[ref.id])
      .filter(Boolean)

    const totalKills = participants.reduce((sum: number, p: PubgParticipant) => sum + p.kills, 0)

    return {
      pubgRosterId: r.id,
      placement: r.attributes?.stats?.rank ?? 0,
      totalKills,
      participants,
    }
  })

  rosters.sort((a, b) => a.placement - b.placement)

  return {
    pubgMatchId,
    matchDate: matchAttr.createdAt ?? '',
    map: matchAttr.mapName ?? '',
    gameMode: matchAttr.gameMode ?? '',
    duration: matchAttr.duration ?? 0,
    rosters,
  }
}

export async function fetchPubgMatch(matchId: string, platform = 'tournament'): Promise<PubgMatchData> {
  const apiKey = process.env.PUBG_API_KEY
  if (!apiKey) throw new Error('PUBG_API_KEY is not set')

  const url = `${PUBG_API_BASE}/shards/${platform}/matches/${matchId}`
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/vnd.api+json',
    },
    next: { revalidate: 0 },
  })

  if (!res.ok) {
    if (res.status === 404) throw new Error(`Match ${matchId} not found`)
    if (res.status === 429) throw new Error('API rate limit exceeded. Please try again later')
    throw new Error(`PUBG API error: ${res.status} ${res.statusText}`)
  }

  const data = await res.json()
  return parsePubgMatch(data)
}

export const MAP_NAMES: Record<string, string> = {
  Baltic_Main: 'Erangel',
  Erangel_Main: 'Erangel',
  Desert_Main: 'Miramar',
  Savage_Main: 'Sanhok',
  DihorOtok_Main: 'Vikendi',
  Summerland_Main: 'Karakin',
  Tiger_Main: 'Taego',
  Kiki_Main: 'Deston',
  Neon_Main: 'Rondo',
  HeavenDawn_Main: 'Sanhok (2.0)',
}

export function getMapDisplayName(mapName: string): string {
  return MAP_NAMES[mapName] ?? mapName
}

// Clip the infinite line through (px,py) with direction (dx,dy) to the unit square [0,1]x[0,1].
// Returns [entry, exit] sorted by parameter t, or null if no intersection.
function clipLineToUnitBox(px: number, py: number, dx: number, dy: number): [{ x: number; y: number }, { x: number; y: number }] | null {
  const eps = 1e-9
  const hits: { x: number; y: number; t: number }[] = []
  if (Math.abs(dx) > eps) {
    for (const ex of [0, 1]) {
      const t = (ex - px) / dx; const y = py + t * dy
      if (y >= -eps && y <= 1 + eps) hits.push({ x: ex, y: Math.max(0, Math.min(1, y)), t })
    }
  }
  if (Math.abs(dy) > eps) {
    for (const ey of [0, 1]) {
      const t = (ey - py) / dy; const x = px + t * dx
      if (x >= -eps && x <= 1 + eps) hits.push({ x: Math.max(0, Math.min(1, x)), y: ey, t })
    }
  }
  if (hits.length < 2) return null
  hits.sort((a, b) => a.t - b.t)
  return [hits[0], hits[hits.length - 1]]
}

// Extract aircraft flight path from telemetry events.
// Filters LogVehicleLeave(TransportAircraft), sorts by elapsedTime, extends to map boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractPlanePath(events: any[], mapSize: number): PlanePath | null { // eslint-disable-line @typescript-eslint/no-explicit-any
  // Strict vehicleType check only; ignore vehicleId fallback which can match wrong vehicles
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = events.filter((e: any) =>
    e._T === 'LogVehicleLeave' &&
    e.vehicle?.vehicleType === 'TransportAircraft' &&
    e.character?.location?.x != null &&
    (e.elapsedTime == null || e.elapsedTime < 420), // aircraft phase is within first 7 minutes
  )
  if (raw.length < 2) return null

  raw.sort((a: any, b: any) => (a.elapsedTime ?? 0) - (b.elapsedTime ?? 0)) // eslint-disable-line @typescript-eslint/no-explicit-any

  // Deduplicate per player — keep only the first jump event per player
  const seen = new Set<string>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deduped = raw.filter((e: any) => {
    const name: string = e.character?.name ?? ''
    if (!name || seen.has(name)) return false
    seen.add(name)
    return true
  })
  if (deduped.length < 2) return null

  const jumps = deduped.map((e: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
    x: Math.max(0, Math.min(1, e.character.location.x / mapSize)),
    y: Math.max(0, Math.min(1, e.character.location.y / mapSize)),
    elapsedTime: e.elapsedTime ?? 0,
    playerName: e.character.name as string | undefined,
  }))

  // PCA: least-squares best-fit line through all jump positions (robust to outliers)
  const n = jumps.length
  const cx = jumps.reduce((s, p) => s + p.x, 0) / n
  const cy = jumps.reduce((s, p) => s + p.y, 0) / n
  let sxx = 0, sxy = 0, syy = 0
  for (const p of jumps) {
    const dx = p.x - cx, dy = p.y - cy
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy
  }
  // Principal eigenvector of 2×2 covariance matrix via closed-form atan2
  const angle = Math.atan2(2 * sxy, sxx - syy) / 2
  let ddx = Math.cos(angle), ddy = Math.sin(angle)
  // Orient toward later jumps (first→last direction)
  if ((jumps[n - 1].x - jumps[0].x) * ddx + (jumps[n - 1].y - jumps[0].y) * ddy < 0) {
    ddx = -ddx; ddy = -ddy
  }

  const clip = clipLineToUnitBox(cx, cy, ddx, ddy)
  if (!clip) return null

  return { entry: clip[0], exit: clip[1], jumps }
}

export { type PlanePath, type TelemetryPlayerStats } from './types'

// Item ID prefixes for throw events (LogItemUse fires when item is actually thrown/consumed)
function classifyThrowable(itemId: string): 'grenade' | 'smoke' | 'flashbang' | 'molotov' | null {
  if (itemId.includes('Molotov')) return 'molotov'
  if (itemId.includes('SmokeBomb') || (itemId.includes('Smoke') && itemId.includes('Item_Weapon'))) return 'smoke'
  if (itemId.includes('FlashBang') || itemId.includes('Flashbang')) return 'flashbang'
  if (itemId.includes('Grenade') && itemId.includes('Item_Weapon')) return 'grenade'
  return null
}

function isGrenadeDamage(ev: { damageTypeCategory?: string; damageCauserName?: string }): boolean {
  return ev.damageTypeCategory === 'Damage_Explosion_Grenade' || (ev.damageCauserName ?? '').includes('Grenade')
}

function isMolotovDamage(ev: { damageCauserName?: string; damageTypeCategory?: string }): boolean {
  const cn = ev.damageCauserName ?? ''
  return cn.includes('Molotov') || cn.includes('MolotovCocktail') || cn.includes('FireDamage') || cn.includes('Fire_')
}

// Extract per-player telemetry stats from a single match's telemetry events.
// trackedAccountIds: if provided, only track those players (improves performance).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractPlayerTelemetryStats(events: any[], trackedAccountIds?: Set<string>): Map<string, TelemetryPlayerStats> {
  const stats = new Map<string, TelemetryPlayerStats>()

  function get(accountId: string): TelemetryPlayerStats {
    let s = stats.get(accountId)
    if (!s) {
      s = {
        pubgAccountId: accountId,
        deaths: 0, damageTaken: 0, blueZoneDamage: 0, killDistanceSum: 0, killDistanceCount: 0,
        grenadesThrown: 0, smokesThrown: 0, flashbangsThrown: 0, molotovsThrown: 0,
        grenadeDamage: 0, molotovDamage: 0, grenadeHitEvents: 0,
        revivesGiven: 0,
      }
      stats.set(accountId, s)
    }
    return s
  }

  function track(accountId: string | null | undefined): boolean {
    if (!accountId) return false
    return !trackedAccountIds || trackedAccountIds.has(accountId)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const ev of events) {
    switch (ev._T) {
      case 'LogPlayerKillV2': {
        const victimId: string | undefined = ev.victim?.accountId
        if (track(victimId)) get(victimId!).deaths++

        const killerId: string | undefined = ev.finisher?.accountId ?? ev.killer?.accountId
        if (track(killerId) && ev.distance != null) {
          const s = get(killerId!)
          s.killDistanceSum += (ev.distance as number) / 100 // cm → m
          s.killDistanceCount++
        }
        break
      }
      case 'LogPlayerTakeDamage': {
        const attackerId: string | undefined = ev.attacker?.accountId
        const victimId: string | undefined = ev.victim?.accountId
        if (!victimId || attackerId === victimId) break // ignore self-damage

        const dmg = (ev.damage as number) ?? 0

        if (track(victimId)) {
          const s = get(victimId)
          s.damageTaken += dmg
          if (ev.damageTypeCategory === 'Damage_BlueZone') s.blueZoneDamage += dmg
        }

        if (track(attackerId)) {
          const s = get(attackerId!)
          if (isGrenadeDamage(ev)) {
            s.grenadeDamage += dmg
            s.grenadeHitEvents++
          } else if (isMolotovDamage(ev)) {
            s.molotovDamage += dmg
          }
        }
        break
      }
      case 'LogItemUse': {
        const accountId: string | undefined = ev.character?.accountId
        if (!track(accountId)) break
        const kind = classifyThrowable((ev.item?.itemId as string | undefined) ?? '')
        if (!kind) break
        const s = get(accountId!)
        if (kind === 'grenade') s.grenadesThrown++
        else if (kind === 'smoke') s.smokesThrown++
        else if (kind === 'flashbang') s.flashbangsThrown++
        else if (kind === 'molotov') s.molotovsThrown++
        break
      }
      case 'LogPlayerRevive': {
        const reviverId: string | undefined = ev.reviver?.accountId
        if (track(reviverId)) get(reviverId!).revivesGiven++
        break
      }
    }
  }

  return stats
}

export async function fetchTelemetryLandings(
  pubgMatchId: string,
  platform = 'tournament',
): Promise<{ mapName: string; landings: PubgLanding[]; flightPath: PlanePath | null; playerTelemetryStats: Map<string, TelemetryPlayerStats> }> {
  const apiKey = process.env.PUBG_API_KEY
  if (!apiKey) throw new Error('PUBG_API_KEY is not set')

  const matchRes = await fetch(`${PUBG_API_BASE}/shards/${platform}/matches/${pubgMatchId}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/vnd.api+json' },
    next: { revalidate: 0 },
  })
  if (!matchRes.ok) {
    if (matchRes.status === 404) throw new Error(`Match ${pubgMatchId} not found`)
    if (matchRes.status === 429) throw new Error('API rate limit exceeded')
    throw new Error(`PUBG API error: ${matchRes.status}`)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apiData: any = await matchRes.json()
  const mapName: string = apiData.data?.attributes?.mapName ?? ''

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const telemetryAsset = (apiData.included ?? []).find((item: any) => item.type === 'asset' && item.attributes?.name === 'telemetry')
  const telemetryUrl: string | null = telemetryAsset?.attributes?.URL ?? null
  if (!telemetryUrl) throw new Error(`No telemetry URL for match ${pubgMatchId}`)

  const telRes = await fetch(telemetryUrl, { next: { revalidate: 0 } })
  if (!telRes.ok) throw new Error(`Telemetry fetch failed: ${telRes.status}`)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const events: any[] = await telRes.json()

  // Landings
  const landings: PubgLanding[] = []
  for (const ev of events) {
    if (ev._T !== 'LogParachuteLanding') continue
    const char = ev.character
    if (!char?.name) continue
    const { xNorm, yNorm } = normalizeCoords(mapName, char.location?.x ?? 0, char.location?.y ?? 0)
    landings.push({ pubgPlayerName: char.name, xNorm, yNorm })
  }

  const mapSize = MAP_BOUNDS[mapName]?.width ?? 816000
  const flightPath = extractPlanePath(events, mapSize)
  const playerTelemetryStats = extractPlayerTelemetryStats(events)

  return { mapName, landings, flightPath, playerTelemetryStats }
}
