'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { getMapDisplayName } from '@/lib/pubg-api'

interface TeamParticipant {
  teamId: string
  teamName: string
  logoUrl: string | null
}

interface DropLoc {
  id: string
  teamId: string
  mapName: string
  x: number
  y: number
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''

function mapStoragePath(mapKey: string) {
  return `maps/${mapKey}.jpg`
}

function mapImageUrl(mapKey: string) {
  return `${SUPABASE_URL}/storage/v1/object/public/images/${mapStoragePath(mapKey)}`
}

export default function AdminDropLocationsPage() {
  const { id } = useParams() as { id: string }
  const supabase = createClient()

  const [tournamentName, setTournamentName] = useState('')
  const [mapKeys, setMapKeys] = useState<string[]>([])
  const [teams, setTeams] = useState<TeamParticipant[]>([])
  const [drops, setDrops] = useState<DropLoc[]>([])
  const [selectedMap, setSelectedMap] = useState<string>('')
  const [selectedTeamId, setSelectedTeamId] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [uploadingMap, setUploadingMap] = useState(false)
  const [mapImgError, setMapImgError] = useState(false)
  const [computing, setComputing] = useState(false)
  const [computeResult, setComputeResult] = useState<string | null>(null)
  const mapRef = useRef<HTMLDivElement>(null)
  const mapFileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const [{ data: t }, { data: stages }, { data: existing }] = await Promise.all([
      supabase.from('tournaments').select('name').eq('id', id).single(),
      supabase.from('stages').select('id, matches(id, map, status)').eq('tournament_id', id),
      supabase.from('team_drop_locations').select('id, team_id, map_name, x, y').eq('tournament_id', id),
    ])
    setTournamentName(t?.name ?? '')

    // Collect maps from imported matches
    const mapsFound = new Set<string>()
    for (const stage of stages ?? []) {
      for (const m of (stage.matches as { id: string; map: string | null; status: string }[]) ?? []) {
        if (m.status === 'imported' && m.map) mapsFound.add(m.map)
      }
    }
    const mapArr = [...mapsFound].sort()
    setMapKeys(mapArr)
    if (mapArr.length > 0) setSelectedMap((prev) => prev || mapArr[0])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setDrops((existing ?? []).map((d: any) => ({ id: d.id, teamId: d.team_id, mapName: d.map_name, x: d.x, y: d.y })))

    // Load teams from match_team_results
    const stageIds = (stages ?? []).map((s: { id: string }) => s.id)
    if (stageIds.length === 0) return

    const { data: matchData } = await supabase
      .from('matches')
      .select('id')
      .in('stage_id', stageIds)
      .eq('status', 'imported')

    const matchIds = (matchData ?? []).map((m: { id: string }) => m.id)
    if (matchIds.length === 0) return

    const { data: results } = await supabase
      .from('match_team_results')
      .select('team_id, display_name, teams(id, name, logo_url)')
      .in('match_id', matchIds)
      .not('team_id', 'is', null)

    const seen = new Map<string, TeamParticipant>()
    for (const r of results ?? []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row = r as any
      if (!row.team_id || seen.has(row.team_id)) continue
      seen.set(row.team_id, {
        teamId: row.team_id,
        teamName: row.teams?.name ?? row.display_name ?? '?',
        logoUrl: row.teams?.logo_url ?? null,
      })
    }
    setTeams([...seen.values()].sort((a, b) => a.teamName.localeCompare(b.teamName)))
  }, [id, supabase])

  useEffect(() => { load() }, [load])

  async function handleMapClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!selectedTeamId || !selectedMap) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))

    setSaving(true)
    const { data, error } = await supabase
      .from('team_drop_locations')
      .upsert({ tournament_id: id, team_id: selectedTeamId, map_name: selectedMap, x, y }, {
        onConflict: 'tournament_id,team_id,map_name',
        ignoreDuplicates: false,
      })
      .select('id, team_id, map_name, x, y')
    setSaving(false)
    if (error) { alert('저장 실패: ' + error.message); return }
    if (data) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = data[0] as any
      const saved: DropLoc = { id: raw.id, teamId: raw.team_id, mapName: raw.map_name, x: raw.x, y: raw.y }
      setDrops((prev) => {
        const filtered = prev.filter((d) => !(d.teamId === selectedTeamId && d.mapName === selectedMap))
        return [...filtered, saved]
      })
    }
  }

  async function deleteDrop(dropId: string) {
    await supabase.from('team_drop_locations').delete().eq('id', dropId)
    setDrops((prev) => prev.filter((d) => d.id !== dropId))
  }

  async function uploadMapImage(file: File) {
    setUploadingMap(true)
    const path = mapStoragePath(selectedMap)
    const { error } = await supabase.storage.from('images').upload(path, file, { upsert: true, contentType: file.type })
    setUploadingMap(false)
    if (error) { alert('업로드 실패: ' + error.message); return }
    setMapImgError(false)
    // Force refresh the img
    const img = mapRef.current?.querySelector('img') as HTMLImageElement | null
    if (img) img.src = mapImageUrl(selectedMap) + '?t=' + Date.now()
  }

  async function handleAutoCompute() {
    setComputing(true)
    setComputeResult(null)
    try {
      const res = await fetch('/api/admin/pubg/compute-drops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tournamentId: id }),
      })
      const json = await res.json()
      if (!res.ok) {
        setComputeResult(`오류: ${json.error ?? '알 수 없는 오류'}`)
      } else {
        const msg = `완료 — 신규 처리 ${json.newlyProcessed}경기 / 건너뜀 ${json.skipped}경기 / 낙하 지점 ${json.dropLocationsUpdated}개 업데이트`
        setComputeResult(msg + (json.errors?.length ? `\n오류: ${json.errors.join(', ')}` : ''))
        await load()
      }
    } catch (err) {
      setComputeResult(`네트워크 오류: ${err instanceof Error ? err.message : ''}`)
    } finally {
      setComputing(false)
    }
  }

  const currentDrops = drops.filter((d) => d.mapName === selectedMap)
  const teamById = new Map(teams.map((t) => [t.teamId, t]))

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center gap-2 text-sm text-gray-400 mb-6">
        <Link href="/admin/tournaments" className="hover:text-gray-600">Tournaments</Link>
        <span>/</span>
        <Link href={`/admin/tournaments/${id}`} className="hover:text-gray-600">{tournamentName || id}</Link>
        <span>/</span>
        <span className="text-gray-700">낙하 지점</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">낙하 지점 관리</h1>
        <button
          onClick={handleAutoCompute}
          disabled={computing}
          className="flex items-center gap-2 px-4 py-2 bg-yellow-400 hover:bg-yellow-500 disabled:bg-gray-200 disabled:text-gray-400 text-gray-900 text-sm font-semibold rounded-lg transition-colors"
        >
          {computing ? (
            <>
              <span className="w-3.5 h-3.5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
              계산 중...
            </>
          ) : '자동 계산 (텔레메트리)'}
        </button>
      </div>
      {computeResult && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm whitespace-pre-line ${computeResult.startsWith('오류') || computeResult.startsWith('네트워크') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
          {computeResult}
        </div>
      )}

      {mapKeys.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400">
          임포트된 경기가 없습니다. 먼저 매치를 임포트해주세요.
        </div>
      ) : (
        <>
          {/* Map selector */}
          <div className="flex gap-2 mb-4 flex-wrap">
            {mapKeys.map((mk) => (
              <button
                key={mk}
                onClick={() => { setSelectedMap(mk); setMapImgError(false) }}
                className={`px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${selectedMap === mk ? 'bg-yellow-400 border-yellow-400 text-gray-900' : 'bg-white border-gray-200 text-gray-600 hover:border-yellow-300'}`}
              >
                {getMapDisplayName(mk)}
              </button>
            ))}
          </div>

          <div className="flex gap-6 items-start">
            {/* Left: Team list + selector */}
            <div className="w-52 shrink-0">
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200">
                  <p className="text-xs font-semibold text-gray-500">팀 선택 → 맵 클릭으로 배치</p>
                </div>
                <div className="max-h-96 overflow-y-auto">
                  {teams.map((team) => {
                    const hasDrop = currentDrops.some((d) => d.teamId === team.teamId)
                    const isSelected = selectedTeamId === team.teamId
                    return (
                      <button
                        key={team.teamId}
                        onClick={() => setSelectedTeamId(isSelected ? '' : team.teamId)}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left border-b border-gray-50 last:border-0 transition-colors ${isSelected ? 'bg-yellow-50 text-gray-900' : 'hover:bg-gray-50 text-gray-700'}`}
                      >
                        {team.logoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={team.logoUrl} alt="" className="w-5 h-5 rounded object-contain shrink-0 border border-gray-100" />
                        ) : (
                          <span className="w-5 h-5 rounded-full bg-gray-200 shrink-0" />
                        )}
                        <span className="flex-1 truncate font-medium">{team.teamName}</span>
                        {hasDrop && <span className="text-[10px] text-green-500 font-bold">✓</span>}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Map image upload */}
              <div className="mt-3 bg-white rounded-xl border border-gray-200 p-3">
                <p className="text-[11px] font-semibold text-gray-400 mb-2 uppercase">맵 이미지</p>
                <input
                  ref={mapFileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadMapImage(f) }}
                />
                <button
                  onClick={() => mapFileRef.current?.click()}
                  disabled={uploadingMap}
                  className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  {uploadingMap ? '업로드 중...' : `${getMapDisplayName(selectedMap)} 이미지 업로드`}
                </button>
                <p className="text-[10px] text-gray-400 mt-1">권장: 8192×8192px</p>
              </div>

              {/* Current drop list */}
              {currentDrops.length > 0 && (
                <div className="mt-3 bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="px-3 py-2 bg-gray-50 border-b border-gray-100">
                    <p className="text-[11px] font-semibold text-gray-500">{getMapDisplayName(selectedMap)} 낙하 지점 ({currentDrops.length})</p>
                  </div>
                  {currentDrops.map((drop) => {
                    const team = teamById.get(drop.teamId)
                    return (
                      <div key={drop.id} className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-50 last:border-0">
                        {team?.logoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={team.logoUrl} alt="" className="w-4 h-4 rounded-full object-cover shrink-0" />
                        ) : (
                          <span className="w-4 h-4 rounded-full bg-gray-200 shrink-0" />
                        )}
                        <span className="text-xs text-gray-700 flex-1 truncate">{team?.teamName ?? drop.teamId}</span>
                        <span className="text-[10px] text-gray-400 font-mono">{(drop.x * 100).toFixed(0)},{(drop.y * 100).toFixed(0)}</span>
                        <button
                          onClick={() => deleteDrop(drop.id)}
                          className="text-gray-300 hover:text-red-500 text-sm leading-none px-1"
                        >×</button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Right: Map view */}
            <div className="flex-1">
              <div
                ref={mapRef}
                onClick={handleMapClick}
                className={`relative rounded-xl overflow-hidden border border-gray-200 bg-gray-100 ${selectedTeamId ? 'cursor-crosshair' : 'cursor-default'}`}
                style={{ aspectRatio: '1' }}
              >
                {/* Map image */}
                {!mapImgError && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={mapImageUrl(selectedMap)}
                    alt={getMapDisplayName(selectedMap)}
                    className="absolute inset-0 w-full h-full object-cover"
                    onError={() => setMapImgError(true)}
                  />
                )}

                {/* Grid fallback */}
                <div className="absolute inset-0 opacity-20"
                  style={{ backgroundImage: 'linear-gradient(#aaa 1px, transparent 1px), linear-gradient(90deg, #aaa 1px, transparent 1px)', backgroundSize: '10% 10%' }} />

                {mapImgError && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <p className="text-gray-400 text-sm bg-white/80 px-4 py-2 rounded-lg">
                      맵 이미지 없음 — 왼쪽에서 업로드
                    </p>
                  </div>
                )}

                {/* Hint when team selected */}
                {selectedTeamId && (
                  <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-yellow-400 text-gray-900 text-xs font-semibold px-3 py-1.5 rounded-full shadow">
                    {teamById.get(selectedTeamId)?.teamName} — 클릭하여 낙하 지점 설정
                  </div>
                )}

                {/* Saving overlay */}
                {saving && (
                  <div className="absolute inset-0 bg-white/50 flex items-center justify-center">
                    <span className="text-xs text-gray-600 font-medium">저장 중...</span>
                  </div>
                )}

                {/* Existing drop locations */}
                {currentDrops.map((drop) => {
                  const team = teamById.get(drop.teamId)
                  const isSelected = selectedTeamId === drop.teamId
                  return (
                    <div
                      key={drop.teamId}
                      className="absolute -translate-x-1/2 -translate-y-1/2 group pointer-events-none"
                      style={{ left: `${drop.x * 100}%`, top: `${drop.y * 100}%` }}
                    >
                      {team?.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={team.logoUrl}
                          alt={team.teamName}
                          className={`object-cover rounded-full border-2 shadow-md ${isSelected ? 'border-yellow-400 w-10 h-10' : 'border-white w-8 h-8'}`}
                        />
                      ) : (
                        <div className={`rounded-full border-2 shadow-md flex items-center justify-center text-white text-[10px] font-bold bg-gray-600 ${isSelected ? 'border-yellow-400 w-10 h-10' : 'border-white w-8 h-8'}`}>
                          {(team?.teamName ?? '?').slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 whitespace-nowrap bg-gray-900/90 text-white text-[10px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                        {team?.teamName}
                      </div>
                    </div>
                  )
                })}
              </div>
              <p className="text-[11px] text-gray-400 mt-2 text-center">
                왼쪽에서 팀을 선택한 후 맵을 클릭하면 낙하 지점이 저장됩니다. 다시 클릭하면 위치가 이동합니다.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
