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
        knockDamageSum: 0, engagementDistSum: 0, engagementDistCount: 0,
        firstBloodKill: false, firstBloodKnock: false,
        grenadesThrown: 0, smokesThrown: 0, flashbangsThrown: 0, molotovsThrown: 0,
        grenadeDamage: 0, molotovDamage: 0, grenadeHitEvents: 0,
        totalHealAmount: 0, blueZoneTime: 0,
        vehicleTime: 0,
        revivesGiven: 0, assistDamage: 0, tradeKills: 0, tradeableDeaths: 0,
        zoneEdgeSamples: 0, zoneTotalSamples: 0, zoneOutsideSamples: 0, zoneDistSum: 0,
      }
      stats.set(accountId, s)
    }
    return s
  }

  function track(accountId: string | null | undefined): boolean {
    if (!accountId) return false
    return !trackedAccountIds || trackedAccountIds.has(accountId)
  }

  // ── Phase 1: pre-scan for team mapping and zone state history ───────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accountTeam = new Map<string, number>() // accountId → in-game integer teamId
  const gameStates: { time: number; zx: number; zy: number; zr: number }[] = []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function extractTeam(char: any) {
    if (char?.accountId && char.teamId != null) accountTeam.set(char.accountId as string, char.teamId as number)
  }

  for (const ev of events) {
    extractTeam(ev.character); extractTeam(ev.attacker); extractTeam(ev.victim)
    extractTeam(ev.killer);    extractTeam(ev.finisher); extractTeam(ev.dBNOMaker)
    extractTeam(ev.reviver)
    if (ev._T === 'LogGameStatePeriodic' && ev.gameState?.safetyZonePosition) {
      const gs = ev.gameState
      gameStates.push({ time: ev.elapsedTime ?? 0, zx: gs.safetyZonePosition.x ?? 0, zy: gs.safetyZonePosition.y ?? 0, zr: gs.safetyZoneRadius ?? 0 })
    }
  }
  gameStates.sort((a, b) => a.time - b.time)

  function zoneAt(time: number) {
    if (gameStates.length === 0) return null
    let lo = 0, hi = gameStates.length - 1
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (gameStates[mid].time <= time) lo = mid; else hi = mid - 1 }
    return gameStates[lo]
  }

  // ── Phase 2: per-player state ───────────────────────────────────────────────
  // Damage accumulation per (attacker → victim) for DPK and assist damage.
  // Cleared on knock/kill/revive to represent one damage cycle.
  const victimDmg = new Map<string, Map<string, number>>() // attacker → victim → accumulated dmg

  function addVictimDmg(attacker: string, victim: string, dmg: number) {
    if (!victimDmg.has(attacker)) victimDmg.set(attacker, new Map())
    const m = victimDmg.get(attacker)!
    m.set(victim, (m.get(victim) ?? 0) + dmg)
  }
  function clearVictimCycle(victimId: string) {
    for (const m of victimDmg.values()) m.delete(victimId)
  }

  // Vehicle ride start times
  const vehicleStart = new Map<string, number>()

  // Team death records for trade-kill detection: teamId → [{killerAccountId, time}]
  const teamDeaths = new Map<number, { killer: string; time: number }[]>()
  function recordTeamDeath(victimId: string, killer: string, time: number) {
    const tid = accountTeam.get(victimId)
    if (tid == null) return
    if (!teamDeaths.has(tid)) teamDeaths.set(tid, [])
    teamDeaths.get(tid)!.push({ killer, time })
  }

  // First blood tracking
  let firstKillTime = Infinity, firstKillAcc = ''
  let firstKnockTime = Infinity, firstKnockAcc = ''

  // ── Phase 3: event processing ───────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const ev of events) {
    const t: number = ev.elapsedTime ?? 0

    switch (ev._T) {
      case 'LogPlayerKillV2': {
        const victimId: string | undefined = ev.victim?.accountId
        const killerId: string | undefined = ev.finisher?.accountId ?? ev.killer?.accountId

        if (victimId && track(victimId)) get(victimId).deaths++

        if (killerId) {
          if (track(killerId) && ev.distance != null) {
            const s = get(killerId)
            s.killDistanceSum += (ev.distance as number) / 100
            s.killDistanceCount++
          }
          if (t < firstKillTime) { firstKillTime = t; firstKillAcc = killerId }
        }

        // Assist damage: tracked attacker damaged this victim, kill by teammate
        if (victimId && killerId) {
          const killerTeam = accountTeam.get(killerId)
          for (const [atk, byVictim] of victimDmg.entries()) {
            if (atk === killerId || !track(atk)) continue
            const dmg = byVictim.get(victimId)
            if (!dmg) continue
            const atkTeam = accountTeam.get(atk)
            if (killerTeam != null && atkTeam === killerTeam) get(atk).assistDamage += dmg
          }
        }

        // Trade kill: did the kill target recently kill a teammate of the killer?
        if (killerId && victimId && track(killerId)) {
          const killerTeam = accountTeam.get(killerId)
          if (killerTeam != null) {
            const recent = teamDeaths.get(killerTeam) ?? []
            if (recent.some(d => d.killer === victimId && t - d.time <= 10)) {
              get(killerId).tradeKills++
            }
          }
        }

        if (killerId && victimId) recordTeamDeath(victimId, killerId, t)
        if (victimId) clearVictimCycle(victimId)
        break
      }

      case 'LogPlayerMakeGroggy': {
        const victimId: string | undefined = ev.victim?.accountId
        const knockerId: string | undefined = ev.attacker?.accountId

        if (knockerId) {
          if (track(knockerId) && victimId) {
            const accum = victimDmg.get(knockerId)?.get(victimId) ?? 0
            get(knockerId).knockDamageSum += accum
          }
          if (t < firstKnockTime) { firstKnockTime = t; firstKnockAcc = knockerId }
        }

        // Trade knock
        if (knockerId && victimId && track(knockerId)) {
          const knockerTeam = accountTeam.get(knockerId)
          if (knockerTeam != null) {
            const recent = teamDeaths.get(knockerTeam) ?? []
            if (recent.some(d => d.killer === victimId && t - d.time <= 10)) {
              get(knockerId).tradeKills++
            }
          }
        }

        if (knockerId && victimId) recordTeamDeath(victimId, knockerId, t)
        if (victimId) clearVictimCycle(victimId)
        break
      }

      case 'LogPlayerTakeDamage': {
        const attackerId: string | undefined = ev.attacker?.accountId
        const victimId: string | undefined = ev.victim?.accountId
        if (!victimId || attackerId === victimId) break

        const dmg = (ev.damage as number) ?? 0

        if (attackerId && victimId) addVictimDmg(attackerId, victimId, dmg)

        if (attackerId && track(attackerId)) {
          const s = get(attackerId)
          if (isGrenadeDamage(ev)) { s.grenadeDamage += dmg; s.grenadeHitEvents++ }
          else if (isMolotovDamage(ev)) { s.molotovDamage += dmg }
          const dist = ev.distance as number | undefined
          if (dist != null && dist > 0) { s.engagementDistSum += dist; s.engagementDistCount++ }
        }

        if (victimId && track(victimId)) {
          const s = get(victimId)
          s.damageTaken += dmg
          if (ev.damageTypeCategory === 'Damage_BlueZone') {
            s.blueZoneDamage += dmg
            s.blueZoneTime += 1 // each BZ damage tick ≈ 1 s of blue-zone exposure
          }
        }
        break
      }

      case 'LogItemUse': {
        const accountId: string | undefined = ev.character?.accountId
        if (!track(accountId)) break
        const kind = classifyThrowable((ev.item?.itemId as string | undefined) ?? '')
        if (kind) {
          const s = get(accountId!)
          if (kind === 'grenade') s.grenadesThrown++
          else if (kind === 'smoke') s.smokesThrown++
          else if (kind === 'flashbang') s.flashbangsThrown++
          else if (kind === 'molotov') s.molotovsThrown++
        }
        break
      }

      case 'LogHeal': {
        const accountId: string | undefined = ev.character?.accountId
        if (!track(accountId)) break
        get(accountId!).totalHealAmount += (ev.healAmount as number) ?? 0
        break
      }

      case 'LogPlayerRevive': {
        const reviverId: string | undefined = ev.reviver?.accountId
        const victimId: string | undefined = ev.victim?.accountId
        if (reviverId && track(reviverId)) get(reviverId).revivesGiven++
        if (victimId) clearVictimCycle(victimId) // victim back from down → reset damage cycle
        break
      }

      case 'LogVehicleRide': {
        const accountId: string | undefined = ev.character?.accountId
        if (!track(accountId) || !accountId) break
        vehicleStart.set(accountId, t)
        break
      }

      case 'LogVehicleLeave': {
        const accountId: string | undefined = ev.character?.accountId
        if (!track(accountId) || !accountId) break
        const start = vehicleStart.get(accountId)
        if (start != null) { get(accountId).vehicleTime += Math.max(0, Math.round(t - start)); vehicleStart.delete(accountId) }
        break
      }

      case 'LogPlayerPosition': {
        const accountId: string | undefined = ev.character?.accountId
        if (!track(accountId) || !accountId) break
        const zone = zoneAt(t)
        if (!zone || zone.zr <= 0) break
        const px = (ev.character?.location?.x as number) ?? 0
        const py = (ev.character?.location?.y as number) ?? 0
        const dx = px - zone.zx, dy = py - zone.zy
        const distCm = Math.sqrt(dx * dx + dy * dy)
        const rel = distCm / zone.zr
        const s = get(accountId)
        s.zoneTotalSamples++
        s.zoneDistSum += distCm
        if (rel > 1.0) s.zoneOutsideSamples++
        else if (rel > 0.7) s.zoneEdgeSamples++
        break
      }
    }
  }

  // Finalise vehicle time for players still in a vehicle at match end
  for (const [accountId, start] of vehicleStart.entries()) {
    if (track(accountId)) get(accountId).vehicleTime += Math.max(0, Math.round((events.at(-1)?.elapsedTime ?? start) - start))
  }

  // First blood flags
  if (firstKillAcc && track(firstKillAcc)) get(firstKillAcc).firstBloodKill = true
  if (firstKnockAcc && track(firstKnockAcc)) get(firstKnockAcc).firstBloodKnock = true

  // Tradeable deaths: for each tracked player, count their teammates' deaths in the match
  for (const [accountId, s] of stats.entries()) {
    const myTeam = accountTeam.get(accountId)
    if (myTeam == null) continue
    const deaths = teamDeaths.get(myTeam) ?? []
    s.tradeableDeaths = deaths.filter(d => d.killer !== accountId).length
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
