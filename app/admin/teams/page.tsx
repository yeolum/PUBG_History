'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { TeamWithAliases } from '@/lib/types'
import SearchModal from '@/components/admin/SearchModal'
import CsvImportModal from '@/components/admin/CsvImportModal'

const INPUT_CLS = 'border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 w-full'

interface Row {
  id: string
  name: string
  short_name: string
  nationality: string
  description: string
  aliases: string[]          // 현재 DB에 저장된 별칭
  _aliasInput: string        // 새 별칭 입력
  _dirty: boolean
}

function toRow(t: TeamWithAliases): Row {
  return {
    id: t.id,
    name: t.name,
    short_name: t.short_name ?? '',
    nationality: t.nationality ?? '',
    description: t.description ?? '',
    aliases: t.team_aliases?.map((a) => a.alias) ?? [],
    _aliasInput: '',
    _dirty: false,
  }
}

export default function AdminTeamsPage() {
  const supabase = createClient()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // 새 팀 추가
  const [addingNew, setAddingNew] = useState(false)
  const [newTeam, setNewTeam] = useState({ name: '', short_name: '', nationality: '' })

  // CSV 임포트
  const [csvModal, setCsvModal] = useState(false)

  // 링크 모달 (다른 팀과 병합)
  const [mergeModal, setMergeModal] = useState<{ fromId: string; fromName: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('teams')
      .select('*, team_aliases(*)')
      .order('name')
    setRows((data ?? []).map((t) => toRow(t as TeamWithAliases)))
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  function updateRow(id: string, key: keyof Row, value: string) {
    setRows((rs) => rs.map((r) => r.id === id ? { ...r, [key]: value, _dirty: true } : r))
  }

  async function saveRow(row: Row) {
    setSaving(row.id)
    await supabase.from('teams').update({
      name: row.name.trim(),
      short_name: row.short_name.trim() || null,
      nationality: row.nationality.trim() || null,
      description: row.description.trim() || null,
    }).eq('id', row.id)
    setSaving(null)
    setRows((rs) => rs.map((r) => r.id === row.id ? { ...r, _dirty: false } : r))
  }

  async function addAlias(row: Row) {
    const alias = row._aliasInput.trim()
    if (!alias) return
    const { error } = await supabase.from('team_aliases').insert([{ team_id: row.id, alias }])
    if (!error) {
      setRows((rs) => rs.map((r) => r.id === row.id ? {
        ...r,
        aliases: [...r.aliases, alias],
        _aliasInput: '',
      } : r))
    } else {
      alert('이미 존재하는 별칭이거나 다른 팀에 연결되어 있습니다')
    }
  }

  async function removeAlias(teamId: string, alias: string) {
    await supabase.from('team_aliases').delete().eq('team_id', teamId).eq('alias', alias)
    setRows((rs) => rs.map((r) => r.id === teamId ? {
      ...r,
      aliases: r.aliases.filter((a) => a !== alias),
    } : r))
  }

  async function deleteTeam(id: string, name: string) {
    if (!confirm(`"${name}" 팀을 삭제하시겠습니까?`)) return
    await supabase.from('teams').delete().eq('id', id)
    setRows((rs) => rs.filter((r) => r.id !== id))
  }

  async function createTeam() {
    if (!newTeam.name.trim()) return
    const { data, error } = await supabase.from('teams').insert([{
      name: newTeam.name.trim(),
      short_name: newTeam.short_name.trim() || null,
      nationality: newTeam.nationality.trim() || null,
    }]).select('*, team_aliases(*)').single()
    if (!error && data) {
      setRows((rs) => [...rs, toRow(data as TeamWithAliases)])
      setNewTeam({ name: '', short_name: '', nationality: '' })
      setAddingNew(false)
    }
  }

  // 팀 병합 (fromId → targetId 로 모든 참조 이동)
  async function mergeTeam(targetId: string, targetName: string) {
    if (!mergeModal) return
    const fromId = mergeModal.fromId
    if (fromId === targetId) { setMergeModal(null); return }

    // from 팀의 이름을 target의 alias로 등록
    await supabase.from('team_aliases').upsert(
      [{ team_id: targetId, alias: mergeModal.fromName }],
      { onConflict: 'alias', ignoreDuplicates: true }
    )
    // match_team_results 재연결
    await supabase.from('match_team_results').update({ team_id: targetId }).eq('team_id', fromId)
    // match_player_stats 재연결
    await supabase.from('match_player_stats').update({ team_id: targetId }).eq('team_id', fromId)
    // players 재연결
    await supabase.from('players').update({ team_id: targetId }).eq('team_id', fromId)
    // from 팀 삭제
    await supabase.from('teams').delete().eq('id', fromId)

    setMergeModal(null)
    void targetName
    load()
  }

  const filtered = rows.filter((r) =>
    r.name.toLowerCase().includes(search.toLowerCase()) ||
    r.aliases.some((a) => a.toLowerCase().includes(search.toLowerCase()))
  )

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">팀 관리</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setCsvModal(true)}
            className="border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium text-sm px-4 py-2 rounded-lg"
          >
            CSV 일괄 등록
          </button>
          <button
            onClick={() => setAddingNew(true)}
            className="bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold text-sm px-4 py-2 rounded-lg"
          >
            + 새 팀
          </button>
        </div>
      </div>

      {/* 검색 */}
      <div className="mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="팀명 또는 별칭 검색..."
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full max-w-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
        />
      </div>

      {/* 새 팀 추가 폼 */}
      {addingNew && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-4 flex gap-3 flex-wrap items-end">
          <div>
            <label className="text-xs text-gray-500 block mb-1">팀명 *</label>
            <input value={newTeam.name} onChange={(e) => setNewTeam((n) => ({ ...n, name: e.target.value }))}
              placeholder="팀명" autoFocus className={INPUT_CLS + ' w-48'} />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">약어</label>
            <input value={newTeam.short_name} onChange={(e) => setNewTeam((n) => ({ ...n, short_name: e.target.value }))}
              placeholder="TAG" className={INPUT_CLS + ' w-24'} />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">국가</label>
            <input value={newTeam.nationality} onChange={(e) => setNewTeam((n) => ({ ...n, nationality: e.target.value }))}
              placeholder="Korea" className={INPUT_CLS + ' w-28'} />
          </div>
          <button onClick={createTeam}
            className="bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold text-sm px-4 py-2 rounded-lg h-9">
            추가
          </button>
          <button onClick={() => setAddingNew(false)}
            className="text-sm text-gray-500 hover:text-gray-700 px-2 py-2">취소</button>
        </div>
      )}

      {/* 팀 목록 */}
      {loading ? (
        <p className="text-gray-400 text-sm">로딩 중...</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((row) => (
            <div key={row.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              {/* 기본 정보 행 */}
              <div className="grid grid-cols-[2fr_1fr_1fr_auto] gap-3 items-center px-4 py-3">
                <input
                  value={row.name}
                  onChange={(e) => updateRow(row.id, 'name', e.target.value)}
                  className={INPUT_CLS}
                  placeholder="팀명"
                />
                <input
                  value={row.short_name}
                  onChange={(e) => updateRow(row.id, 'short_name', e.target.value)}
                  className={INPUT_CLS}
                  placeholder="약어"
                />
                <input
                  value={row.nationality}
                  onChange={(e) => updateRow(row.id, 'nationality', e.target.value)}
                  className={INPUT_CLS}
                  placeholder="국가"
                />
                <div className="flex gap-1.5 items-center">
                  {row._dirty && (
                    <button
                      onClick={() => saveRow(row)}
                      disabled={saving === row.id}
                      className="text-xs bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-medium px-3 py-1.5 rounded-lg whitespace-nowrap"
                    >
                      {saving === row.id ? '...' : '저장'}
                    </button>
                  )}
                  <button
                    onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}
                    className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5 border border-gray-200 rounded-lg"
                  >
                    {expandedId === row.id ? '접기' : '별칭'}
                    {row.aliases.length > 0 && ` (${row.aliases.length})`}
                  </button>
                  <button
                    onClick={() => setMergeModal({ fromId: row.id, fromName: row.name })}
                    className="text-xs text-blue-400 hover:text-blue-600 px-2 py-1.5 border border-blue-200 rounded-lg"
                  >
                    병합
                  </button>
                  <button
                    onClick={() => deleteTeam(row.id, row.name)}
                    className="text-xs text-red-400 hover:text-red-600 px-2 py-1.5 border border-red-200 rounded-lg"
                  >
                    삭제
                  </button>
                </div>
              </div>

              {/* 별칭 관리 (확장) */}
              {expandedId === row.id && (
                <div className="border-t border-gray-100 px-4 py-3 bg-gray-50">
                  <p className="text-xs font-medium text-gray-500 mb-2">별칭 / 이전 이름</p>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {row.aliases.length === 0 && (
                      <span className="text-xs text-gray-400">등록된 별칭 없음</span>
                    )}
                    {row.aliases.map((a) => (
                      <span key={a} className="inline-flex items-center gap-1 bg-white border border-gray-200 rounded-full text-xs px-2.5 py-0.5 text-gray-700">
                        {a}
                        <button onClick={() => removeAlias(row.id, a)} className="text-gray-300 hover:text-red-500 ml-0.5">×</button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={row._aliasInput}
                      onChange={(e) => updateRow(row.id, '_aliasInput', e.target.value)}
                      placeholder="새 별칭 입력"
                      className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs w-48 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                      onKeyDown={(e) => { if (e.key === 'Enter') addAlias(row) }}
                    />
                    <button onClick={() => addAlias(row)}
                      className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-700 px-3 py-1.5 rounded-lg">
                      추가
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {filtered.length === 0 && !loading && (
            <p className="text-gray-400 text-sm text-center py-10">
              {search ? '검색 결과 없음' : '등록된 팀이 없습니다'}
            </p>
          )}
        </div>
      )}

      {/* CSV 임포트 모달 */}
      {csvModal && (
        <CsvImportModal
          type="teams"
          onDone={() => load()}
          onClose={() => setCsvModal(false)}
        />
      )}

      {/* 병합 모달 */}
      {mergeModal && (
        <SearchModal
          type="team"
          targetName={mergeModal.fromName}
          onConfirm={(targetId, targetName) => mergeTeam(targetId, targetName)}
          onClose={() => setMergeModal(null)}
        />
      )}
    </div>
  )
}
