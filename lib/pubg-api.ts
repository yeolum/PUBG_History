import type { PubgMatchData, PubgRoster, PubgParticipant } from './types'

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

export interface FlightPathPoint { xNorm: number; yNorm: number }

export async function fetchTelemetryLandings(
  pubgMatchId: string,
  platform = 'tournament',
): Promise<{ mapName: string; landings: PubgLanding[]; flightPath: FlightPathPoint[] }> {
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

  // Flight path: first LogVehicleRide (TransportAircraft) after LogMatchStart,
  // then 1st/5th/10th/.../50th LogVehicleLeave (TransportAircraft) after that timestamp
  const flightPath: FlightPathPoint[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isAircraft = (v: any) => v?.vehicleType === 'TransportAircraft' || String(v?.vehicleId ?? '').toLowerCase().includes('transportaircraft')

  const matchStartIdx = events.findIndex((e) => e._T === 'LogMatchStart')
  const postStart = matchStartIdx >= 0 ? events.slice(matchStartIdx + 1) : events

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const firstRide = postStart.find((e: any) => e._T === 'LogVehicleRide' && isAircraft(e.vehicle) && e.character?.location)
  if (firstRide) {
    const { xNorm, yNorm } = normalizeCoords(mapName, firstRide.character.location.x, firstRide.character.location.y)
    flightPath.push({ xNorm, yNorm })

    const rideTime: string = firstRide._D
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vehicleLeaves = postStart.filter((e: any) =>
      e._T === 'LogVehicleLeave' && isAircraft(e.vehicle) && e.character?.location && e._D >= rideTime,
    )
    for (const idx of [0, 4, 9, 14, 19, 24, 29, 34, 39, 44, 49]) {
      if (idx < vehicleLeaves.length) {
        const ev = vehicleLeaves[idx]
        const coords = normalizeCoords(mapName, ev.character.location.x, ev.character.location.y)
        flightPath.push({ xNorm: coords.xNorm, yNorm: coords.yNorm })
      }
    }
  }

  return { mapName, landings, flightPath }
}
