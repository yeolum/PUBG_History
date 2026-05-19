import type { PubgMatchData, PubgRoster, PubgParticipant, PlanePath } from './types'

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
export function extractPlanePath(events: any[], mapSize: number): PlanePath | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isAircraft = (v: any) =>
    v?.vehicleType === 'TransportAircraft' || String(v?.vehicleId ?? '').toLowerCase().includes('transportaircraft')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = events.filter((e: any) =>
    e._T === 'LogVehicleLeave' && isAircraft(e.vehicle) && e.character?.location?.x != null,
  )
  if (raw.length < 2) return null

  // Sort by elapsedTime (fall back to _D string comparison for ISO 8601)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw.sort((a: any, b: any) => (a.elapsedTime != null ? a.elapsedTime - b.elapsedTime : a._D < b._D ? -1 : 1))

  const jumps = raw.map((e: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
    x: Math.max(0, Math.min(1, e.character.location.x / mapSize)),
    y: Math.max(0, Math.min(1, e.character.location.y / mapSize)),
    elapsedTime: e.elapsedTime ?? 0,
    playerName: e.character.name as string | undefined,
  }))

  // Direction from first jump to last jump (most distant pair as fallback)
  let p1 = jumps[0], p2 = jumps[jumps.length - 1]
  const baseDist = (p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2
  if (baseDist < 1e-8) {
    let maxD = 0
    for (let i = 0; i < jumps.length; i++)
      for (let j = i + 1; j < jumps.length; j++) {
        const d = (jumps[j].x - jumps[i].x) ** 2 + (jumps[j].y - jumps[i].y) ** 2
        if (d > maxD) { maxD = d; p1 = jumps[i]; p2 = jumps[j] }
      }
    if (maxD < 1e-8) return null
  }

  const clip = clipLineToUnitBox(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y)
  if (!clip) return null

  return { entry: clip[0], exit: clip[1], jumps }
}

export { type PlanePath } from './types'

export async function fetchTelemetryLandings(
  pubgMatchId: string,
  platform = 'tournament',
): Promise<{ mapName: string; landings: PubgLanding[]; flightPath: PlanePath | null }> {
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

  return { mapName, landings, flightPath }
}
