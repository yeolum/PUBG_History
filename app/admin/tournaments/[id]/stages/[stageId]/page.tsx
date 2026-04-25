'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { Stage, Match, MatchTeamResult, MatchPlayerStat, StageTeamStanding } from '@/lib/types'
import { getMapDisplayName } from '@/lib/pubg-api'
import SearchModal from '@/components/admin/SearchModal'

const INPUT_CLS = 'border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400'

interface MatchWithResults extends Match {
  match_team_results: (MatchTeamResult & { teams: { id: string; name: string } | null })[]
  match_player_stats: (MatchPlayerStat & { players: { id: string; nickname: string } | null })[]
}

export default function StageMatchesPage() {
  const { id: tournamentId, stageId } = useParams() as { id: string; stageId: string }
  const supabase = createClient()

  const [stage, setStage] = useState<Stage | null>(null)
  const [matches, setMatches] = useState<MatchWithResults[]>([])
  const [standings, setStandings] = useState<StageTeamStanding[]>([])
  const [expandedMatch, setExpandedMatch] = useState<string | null>(null)

  const [newMatchId, setNewMatchId] = useState('')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')

  const [linkModal, setLinkModal] = useState<{
    type: 'team' | 'player'
    targetName: string
    matchId: string
    rowId: string
  } | null>(null)

  const load = useCallback(async () => {
    const [{ data: s }, { data: m }] = await Promise.all([
      supabase.from('stages').select('*').eq('id', stageId).single(),
      supabase
        .from('matches')
        .select('*, match_team_results(*, teams(id, name)), match_player_stats(*, players(id, nickname))')
        .eq('stage_id', stageId)
        .order('order_num'),
    ])
    setStage(s as Stage)
    setMatches((m ?? []) as MatchWithResults[])

    const { data: standingData } = await supabase
      .from('stage_team_standings')
      .select('*')
      .eq('stage_id', stageId)
      .order('total_points', { ascending: false })
    setStandings((standingData ?? []) as StageTeamStanding[])
  }, [stageId, supabase])

  useEffect(() => { load() }, [load])

  async function importMatch() {
    const matchId = newMatchId.trim()
    if (!matchId) return
    setImporting(true)
    setImportError('')
    try {
      const res = await fetch('/api/admin/pubg/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stageId, pubgMatchId: matchId }),
      })
      const result = await res.json()
      if (!res.ok) {
        setImportError(result.error ?? '임포트 실패')
      } else {
        setNewMatchId('')
        load()
      }
    } catch {
      setImportError('서버 오류')
    } finally {
      setImporting(false)
    }
  }

  async function deleteMatch(matchId: string) {
    if (!confirm('이 매치를 삭제하시겠습니까?')) return
    await supabase.from('matches').delete().eq('id', matchId)
    load()
  }

  async function linkTeam(matchId: string, teamResultId: string, teamId: string) {
    const row = matches
      .find((m) => m.id === matchId)
      ?.match_team_results.find((r) => r.id === teamResultId)

    await supabase.from('match_team_results').update({ team_id: teamId }).eq('id', teamResultId)

    if (row?.pubg_team_name) {
      await supabase.from('team_aliases').upsert(
        [{ team_id: teamId, alias: row.pubg_team_name }],
        { onConflict: 'alias', ignoreDuplicates: true }
      )
      await supabase
        .from('match_player_stats')
        .update({ team_id: teamId })
        .eq('match_id', matchId)
        .is('team_id', null)
        .eq('placement', row.placement ?? -1)
    }
    setLinkModal(null)
    load()
  }

  async function linkPlayer(matchId: string, statId: string, playerId: string) {
    const row = matches
      .find((m) => m.id === matchId)
      ?.match_player_stats.find((s) => s.id === statId)

    await supabase.from('match_player_stats').update({ player_id: playerId }).eq('id', statId)

    if (row?.pubg_player_name) {
      await supabase.from('player_aliases').upsert(
        [{ player_id: playerId, alias: row.pubg_player_name }],
        { onConflict: 'alias', ignoreDuplicates: true }
      )
    }
    setLinkModal(null)
    load()
  }

  if (!stage) return <div className="p-8 text-gray-400">로딩 중...</div>

  return (
    <div className="p-8 max-w-5xl">
      {/* 브레드크럼 */}
      <div className="flex items-center gap-1.5 text-sm text-gray-400 mb-6 flex-wrap">
        <Link href="/admin/tournaments" className="hover:text-gray-600">대회</Link>
        <span>/</span>
        <Link href={`/admin/tournaments/${tournamentId}`} className="hover:text-gray-600">대회 관리</Link>
        <span>/</span>
        <span className="text-gray-700">{stage.name}</span>
      </div>

      <h1 className="text-xl font-bold text-gray-900 mb-2">{stage.name}</h1>
      <p className="text-sm text-gray-400 mb-8">
        {stage.type === 'group' ? '그룹 스테이지' : stage.type === 'playoff' ? '플레이오프' : '그랜드 파이널'}
      </p>

      {/* 팀 순위 스코어보드 */}
      {standings.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 mb-8 overflow-hidden">
          <div className="px-5 py-3 bg-gray-50 border-b border-gray-200">
            <h2 className="font-semibold text-gray-800">팀 순위 (집계)</h2>
            <p className="text-xs text-gray-400 mt-0.5">순위점수 + 킬점수 = 총점수 | 순위점수: 1~8위 → 10,6,5,4,3,2,1,1</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 border-b border-gray-100">
                  <th className="text-left px-5 py-2">#</th>
                  <th className="text-left px-5 py-2">팀</th>
                  <th className="text-right px-5 py-2">경기</th>
                  <th className="text-right px-5 py-2">순위점수</th>
                  <th className="text-right px-5 py-2">킬점수</th>
                  <th className="text-right px-5 py-2 font-bold text-gray-600">총점수</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((s, i) => (
                  <tr key={s.team_id ?? s.team_name} className="border-b border-gray-50 last:border-0">
                    <td className="px-5 py-2 text-gray-400 font-mono text-xs">{i + 1}</td>
                    <td className="px-5 py-2 font-medium text-gray-800">
                      {s.team_name}
                      {!s.team_id && (
                        <span className="ml-1.5 text-xs text-orange-400 font-normal">(미연결)</span>
                      )}
                    </td>
                    <td className="px-5 py-2 text-right text-gray-500">{s.matches_played}</td>
                    <td className="px-5 py-2 text-right text-gray-500">{s.placement_points}</td>
                    <td className="px-5 py-2 text-right text-gray-500">{s.total_kills}</td>
                    <td className="px-5 py-2 text-right font-bold text-gray-900">{s.total_points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* PUBG Match ID 임포트 */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-8">
        <h2 className="font-semibold text-gray-800 mb-3">매치 추가 (PUBG Match ID)</h2>
        <div className="flex gap-2">
          <input
            value={newMatchId}
            onChange={(e) => setNewMatchId(e.target.value)}
            placeholder="PUBG Match ID (예: 12345678-abcd-...)"
            className={`flex-1 ${INPUT_CLS}`}
            onKeyDown={(e) => { if (e.key === 'Enter') importMatch() }}
          />
          <button
            onClick={importMatch}
            disabled={importing || !newMatchId.trim()}
            className="bg-yellow-400 hover:bg-yellow-300 disabled:opacity-60 text-gray-900 font-semibold text-sm px-5 py-2 rounded-lg"
          >
            {importing ? '임포트 중...' : '임포트'}
          </button>
        </div>
        {importError && (
          <p className="mt-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{importError}</p>
        )}
      </div>

      {/* 매치 목록 */}
      <h2 className="font-semibold text-gray-800 mb-4">매치 목록 ({matches.length})</h2>
      {matches.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400 text-sm">
          아직 임포트된 매치가 없습니다
        </div>
      ) : (
        <div className="space-y-3">
          {matches.map((match, i) => (
            <div key={match.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div
                className="flex items-center justify-between px-5 py-3 cursor-pointer hover:bg-gray-50"
                onClick={() => setExpandedMatch(expandedMatch === match.id ? null : match.id)}
              >
                <div className="flex items-center gap-3">
                  <span className="font-medium text-gray-700">Match {i + 1}</span>
                  {match.map && (
                    <span className="text-xs text-gray-400">{getMapDisplayName(match.map)}</span>
                  )}
                  {match.match_date && (
                    <span className="text-xs text-gray-400">
                      {new Date(match.match_date).toLocaleDateString('ko-KR')}
                    </span>
                  )}
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    match.status === 'imported' ? 'bg-green-100 text-green-700' :
                    match.status === 'error' ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'
                  }`}>{match.status}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400">{expandedMatch === match.id ? '▲' : '▼'}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteMatch(match.id) }}
                    className="text-xs text-red-400 hover:text-red-600"
                  >
                    삭제
                  </button>
                </div>
              </div>

              {match.status === 'error' && (
                <div className="px-5 pb-3">
                  <p className="text-xs text-red-500">오류: {match.error_msg}</p>
                </div>
              )}

              {expandedMatch === match.id && match.status === 'imported' && (
                <div className="border-t border-gray-100 p-5">
                  <div className="grid gap-6 lg:grid-cols-2">
                    {/* 팀 결과 */}
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">팀 결과</p>
                      <div className="space-y-1.5">
                        {match.match_team_results
                          .slice()
                          .sort((a, b) => (a.placement ?? 99) - (b.placement ?? 99))
                          .map((r) => (
                            <div key={r.id} className="flex items-start gap-2 text-sm">
                              <span className="font-mono text-gray-400 w-5 text-xs mt-0.5">{r.placement}</span>
                              <div className="flex-1 min-w-0">
                                {r.team_id ? (
                                  <span className="font-medium text-gray-800">{r.teams?.name ?? '-'}</span>
                                ) : (
                                  <div>
                                    <span className="text-xs font-medium text-orange-500">미연결</span>
                                    {r.pubg_team_name && (
                                      <span className="ml-1 text-xs text-gray-400">{r.pubg_team_name}</span>
                                    )}
                                  </div>
                                )}
                              </div>
                              <span className="text-xs text-gray-400 shrink-0">{r.total_kills}킬</span>
                              {!r.team_id && (
                                <button
                                  onClick={() => setLinkModal({ type: 'team', targetName: r.pubg_team_name ?? '', matchId: match.id, rowId: r.id })}
                                  className="text-xs bg-orange-100 text-orange-600 hover:bg-orange-200 px-2 py-0.5 rounded font-medium shrink-0"
                                >
                                  팀 연결
                                </button>
                              )}
                            </div>
                          ))}
                      </div>
                    </div>

                    {/* 선수 스탯 */}
                    <div>
                      {(() => {
                        const unlinked = match.match_player_stats.filter((s) => !s.player_id)
                        const linked = match.match_player_stats.filter((s) => s.player_id)
                        const sorted = [
                          ...unlinked.sort((a, b) => (b.damage_dealt ?? 0) - (a.damage_dealt ?? 0)),
                          ...linked.sort((a, b) => (b.damage_dealt ?? 0) - (a.damage_dealt ?? 0)),
                        ]
                        return (
                          <>
                            <div className="flex items-center justify-between mb-3">
                              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">선수 스탯</p>
                              {unlinked.length > 0 && (
                                <span className="text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full font-medium">
                                  미연결 {unlinked.length}명
                                </span>
                              )}
                            </div>
                            <div className="overflow-x-auto max-h-64 overflow-y-auto">
                              <table className="w-full text-xs">
                                <thead className="sticky top-0 bg-white">
                                  <tr className="text-gray-400 border-b border-gray-100">
                                    <th className="text-left pb-1.5">선수 (PUBG 이름)</th>
                                    <th className="text-right pb-1.5">킬</th>
                                    <th className="text-right pb-1.5">데미지</th>
                                    <th className="pb-1.5 w-14" />
                                  </tr>
                                </thead>
                                <tbody>
                                  {sorted.map((s) => (
                                    <tr key={s.id} className={`border-b border-gray-50 last:border-0 ${!s.player_id ? 'bg-orange-50' : ''}`}>
                                      <td className="py-1">
                                        <div>
                                          <span className={`font-medium ${s.player_id ? 'text-gray-800' : 'text-orange-700'}`}>
                                            {s.pubg_player_name ?? '-'}
                                          </span>
                                          {s.player_id && s.players?.nickname !== s.pubg_player_name && (
                                            <span className="ml-1 text-gray-400">→ {s.players?.nickname}</span>
                                          )}
                                        </div>
                                      </td>
                                      <td className="py-1 text-right text-gray-500">{s.kills}</td>
                                      <td className="py-1 text-right text-gray-500">{Number(s.damage_dealt).toFixed(0)}</td>
                                      <td className="py-1 text-right">
                                        {!s.player_id ? (
                                          <button
                                            onClick={() => setLinkModal({ type: 'player', targetName: s.pubg_player_name ?? '', matchId: match.id, rowId: s.id })}
                                            className="text-xs bg-orange-100 text-orange-600 hover:bg-orange-200 px-1.5 py-0.5 rounded font-medium"
                                          >
                                            연결
                                          </button>
                                        ) : (
                                          <span className="text-gray-300">✓</span>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </>
                        )
                      })()}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {linkModal && (
        <SearchModal
          type={linkModal.type}
          targetName={linkModal.targetName}
          onConfirm={(entityId, entityName) => {
            void entityName
            if (linkModal.type === 'team') {
              linkTeam(linkModal.matchId, linkModal.rowId, entityId)
            } else {
              linkPlayer(linkModal.matchId, linkModal.rowId, entityId)
            }
          }}
          onClose={() => setLinkModal(null)}
        />
      )}
    </div>
  )
}
