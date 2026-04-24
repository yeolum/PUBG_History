'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { PlayerWithDetails } from '@/lib/types'
import SearchModal from '@/components/admin/SearchModal'
import CsvImportModal from '@/components/admin/CsvImportModal'
import ImageUpload from '@/components/admin/ImageUpload'

const INPUT_CLS = 'border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 w-full'

interface Row {
  id: string
  nickname: string
  real_name: string
  nationality: string
  birth_date: string
  team_id: string
  team_name: string
  profile_pic: string | null
  aliases: string[]
  _aliasInput: string
  _dirty: boolean
}

function toRow(p: PlayerWithDetails): Row {
  return {
    id: p.id,
    nickname: p.nickname,
    real_name: p.real_name ?? '',
    nationality: p.nationality ?? '',
    birth_date: p.birth_date ?? '',
    team_id: p.team_id ?? '',
    team_name: p.teams?.name ?? '',
    profile_pic: p.profile_pic ?? null,
    aliases: p.player_aliases?.map((a) => a.alias) ?? [],
    _aliasInput: '',
    _dirty: false,
  }
}

export default function AdminPlayersPage() {
  const supabase = createClient()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filterNation, setFilterNation] = useState('')
  const [filterTeam, setFilterTeam] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // 새 선수 추가
  const [addingNew, setAddingNew] = useState(false)
  const [newPlayer, setNewPlayer] = useState({ nickname: '', real_name: '', nationality: '' })

  // 팀 배정 모달
  const [teamModal, setTeamModal] = useState<string | null>(null)

  // CSV 임포트
  const [csvModal, setCsvModal] = useState(false)

  // 선수 병합 모달
  const [mergeModal, setMergeModal] = useState<{ fromId: string; fromName: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('players')
      .select('*, player_aliases(*), teams(id, name, short_name)')
      .order('nickname')
    setRows((data ?? []).map((p) => toRow(p as PlayerWithDetails)))
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  function updateRow(id: string, key: keyof Row, value: string) {
    setRows((rs) => rs.map((r) => r.id === id ? { ...r, [key]: value, _dirty: true } : r))
  }

  async function saveRow(row: Row) {
    setSaving(row.id)
    await supabase.from('players').update({
      nickname: row.nickname.trim(),
      real_name: row.real_name.trim() || null,
      nationality: row.nationality.trim() || null,
      birth_date: row.birth_date || null,
      team_id: row.team_id || null,
      profile_pic: row.profile_pic,
    }).eq('id', row.id)
    setSaving(null)
    setRows((rs) => rs.map((r) => r.id === row.id ? { ...r, _dirty: false } : r))
  }

  function updateProfilePic(id: string, url: string | null) {
    setRows((rs) => rs.map((r) => r.id === id ? { ...r, profile_pic: url, _dirty: true } : r))
  }

  async function addAlias(row: Row) {
    const alias = row._aliasInput.trim()
    if (!alias) return
    const { error } = await supabase.from('player_aliases').insert([{ player_id: row.id, alias }])
    if (!error) {
      setRows((rs) => rs.map((r) => r.id === row.id ? {
        ...r,
        aliases: [...r.aliases, alias],
        _aliasInput: '',
      } : r))
    } else {
      alert('이미 존재하는 별칭이거나 다른 선수에 연결되어 있습니다')
    }
  }

  async function removeAlias(playerId: string, alias: string) {
    await supabase.from('player_aliases').delete().eq('player_id', playerId).eq('alias', alias)
    setRows((rs) => rs.map((r) => r.id === playerId ? {
      ...r,
      aliases: r.aliases.filter((a) => a !== alias),
    } : r))
  }

  async function deletePlayer(id: string, name: string) {
    if (!confirm(`"${name}" 선수를 삭제하시겠습니까?`)) return
    await supabase.from('players').delete().eq('id', id)
    setRows((rs) => rs.filter((r) => r.id !== id))
  }

  async function createPlayer() {
    if (!newPlayer.nickname.trim()) return
    const { data, error } = await supabase.from('players').insert([{
      nickname: newPlayer.nickname.trim(),
      real_name: newPlayer.real_name.trim() || null,
      nationality: newPlayer.nationality.trim() || null,
    }]).select('*, player_aliases(*), teams(id, name, short_name)').single()
    if (!error && data) {
      setRows((rs) => [...rs, toRow(data as PlayerWithDetails)])
      setNewPlayer({ nickname: '', real_name: '', nationality: '' })
      setAddingNew(false)
    }
  }

  async function assignTeam(playerId: string, teamId: string, teamName: string) {
    await supabase.from('players').update({ team_id: teamId }).eq('id', playerId)
    setRows((rs) => rs.map((r) => r.id === playerId ? { ...r, team_id: teamId, team_name: teamName } : r))
    setTeamModal(null)
  }

  // 선수 병합
  async function mergePlayer(targetId: string, targetName: string) {
    if (!mergeModal) return
    const fromId = mergeModal.fromId
    if (fromId === targetId) { setMergeModal(null); return }

    await supabase.from('player_aliases').upsert(
      [{ player_id: targetId, alias: mergeModal.fromName }],
      { onConflict: 'alias', ignoreDuplicates: true }
    )
    await supabase.from('match_player_stats').update({ player_id: targetId }).eq('player_id', fromId)
    await supabase.from('players').delete().eq('id', fromId)

    setMergeModal(null)
    void targetName
    load()
  }

  const nations = [...new Set(rows.map((r) => r.nationality).filter(Boolean))].sort() as string[]
  const teams = [...new Set(rows.map((r) => r.team_name).filter(Boolean))].sort() as string[]

  const filtered = rows.filter((r) => {
    const q = search.toLowerCase()
    const matchSearch = !q ||
      r.nickname.toLowerCase().includes(q) ||
      (r.real_name && r.real_name.toLowerCase().includes(q)) ||
      r.team_name.toLowerCase().includes(q) ||
      r.aliases.some((a) => a.toLowerCase().includes(q))
    const matchNation = !filterNation || r.nationality === filterNation
    const matchTeam = !filterTeam || r.team_name === filterTeam
    return matchSearch && matchNation && matchTeam
  })

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">선수 관리</h1>
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
            + 새 선수
          </button>
        </div>
      </div>

      {/* 검색 + 필터 */}
      <div className="mb-4 flex gap-2 flex-wrap">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="닉네임, 실명, 별칭 검색..."
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full max-w-xs focus:outline-none focus:ring-2 focus:ring-yellow-400"
        />
        <select
          value={filterTeam}
          onChange={(e) => setFilterTeam(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 text-gray-700"
        >
          <option value="">전체 팀</option>
          {teams.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select
          value={filterNation}
          onChange={(e) => setFilterNation(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 text-gray-700"
        >
          <option value="">전체 국가</option>
          {nations.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        {(search || filterTeam || filterNation) && (
          <button
            onClick={() => { setSearch(''); setFilterTeam(''); setFilterNation('') }}
            className="text-xs text-gray-400 hover:text-gray-600 px-3 py-2 border border-gray-200 rounded-lg"
          >
            필터 초기화
          </button>
        )}
        <span className="text-xs text-gray-400 self-center ml-1">{filtered.length}명</span>
      </div>

      {/* 새 선수 추가 */}
      {addingNew && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-4 flex gap-3 flex-wrap items-end">
          <div>
            <label className="text-xs text-gray-500 block mb-1">닉네임 *</label>
            <input value={newPlayer.nickname} onChange={(e) => setNewPlayer((n) => ({ ...n, nickname: e.target.value }))}
              placeholder="닉네임" autoFocus className={INPUT_CLS + ' w-40'} />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">실명</label>
            <input value={newPlayer.real_name} onChange={(e) => setNewPlayer((n) => ({ ...n, real_name: e.target.value }))}
              placeholder="이름" className={INPUT_CLS + ' w-32'} />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">국적</label>
            <input value={newPlayer.nationality} onChange={(e) => setNewPlayer((n) => ({ ...n, nationality: e.target.value }))}
              placeholder="Korea" className={INPUT_CLS + ' w-24'} />
          </div>
          <button onClick={createPlayer}
            className="bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold text-sm px-4 py-2 rounded-lg h-9">
            추가
          </button>
          <button onClick={() => setAddingNew(false)}
            className="text-sm text-gray-500 hover:text-gray-700 px-2 py-2">취소</button>
        </div>
      )}

      {/* 선수 목록 */}
      {loading ? (
        <p className="text-gray-400 text-sm">로딩 중...</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((row) => (
            <div key={row.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="grid grid-cols-[auto_2fr_1.5fr_1fr_1fr_1fr_auto] gap-2 items-center px-4 py-3 text-sm">
                {/* 프로필 사진 */}
                <ImageUpload
                  currentUrl={row.profile_pic}
                  storagePath={`players/${row.id}/avatar`}
                  onUpdate={(url) => updateProfilePic(row.id, url)}
                  shape="square"
                  size="sm"
                />
                {/* 닉네임 */}
                <input
                  value={row.nickname}
                  onChange={(e) => updateRow(row.id, 'nickname', e.target.value)}
                  className={INPUT_CLS}
                  placeholder="닉네임"
                />
                {/* 실명 */}
                <input
                  value={row.real_name}
                  onChange={(e) => updateRow(row.id, 'real_name', e.target.value)}
                  className={INPUT_CLS}
                  placeholder="실명"
                />
                {/* 국적 */}
                <input
                  value={row.nationality}
                  onChange={(e) => updateRow(row.id, 'nationality', e.target.value)}
                  className={INPUT_CLS}
                  placeholder="국적"
                />
                {/* 생년월일 */}
                <input
                  type="date"
                  value={row.birth_date}
                  onChange={(e) => updateRow(row.id, 'birth_date', e.target.value)}
                  className={INPUT_CLS}
                />
                {/* 팀 */}
                <button
                  onClick={() => setTeamModal(row.id)}
                  className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm text-left truncate hover:border-yellow-400 text-gray-600"
                  title={row.team_name || '팀 없음'}
                >
                  {row.team_name || <span className="text-gray-300">팀 미배정</span>}
                </button>
                {/* 액션 */}
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
                    별칭{row.aliases.length > 0 && ` (${row.aliases.length})`}
                  </button>
                  <button
                    onClick={() => setMergeModal({ fromId: row.id, fromName: row.nickname })}
                    className="text-xs text-blue-400 hover:text-blue-600 px-2 py-1.5 border border-blue-200 rounded-lg"
                  >
                    병합
                  </button>
                  <button
                    onClick={() => deletePlayer(row.id, row.nickname)}
                    className="text-xs text-red-400 hover:text-red-600 px-2 py-1.5 border border-red-200 rounded-lg"
                  >
                    삭제
                  </button>
                </div>
              </div>

              {/* 별칭 */}
              {expandedId === row.id && (
                <div className="border-t border-gray-100 px-4 py-3 bg-gray-50">
                  <p className="text-xs font-medium text-gray-500 mb-2">이전 닉네임 / 별칭</p>
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
              {search ? '검색 결과 없음' : '등록된 선수가 없습니다'}
            </p>
          )}
        </div>
      )}

      {/* CSV 임포트 모달 */}
      {csvModal && (
        <CsvImportModal
          type="players"
          onDone={() => load()}
          onClose={() => setCsvModal(false)}
        />
      )}

      {/* 팀 배정 모달 */}
      {teamModal && (
        <SearchModal
          type="team"
          targetName={rows.find((r) => r.id === teamModal)?.nickname ?? ''}
          onConfirm={(teamId, teamName) => assignTeam(teamModal, teamId, teamName)}
          onClose={() => setTeamModal(null)}
        />
      )}

      {/* 선수 병합 모달 */}
      {mergeModal && (
        <SearchModal
          type="player"
          targetName={mergeModal.fromName}
          onConfirm={(targetId, targetName) => mergePlayer(targetId, targetName)}
          onClose={() => setMergeModal(null)}
        />
      )}
    </div>
  )
}
