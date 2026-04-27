'use client'

import { useState, useEffect, useCallback, Fragment } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { PlayerWithDetails } from '@/lib/types'
import SearchModal from '@/components/admin/SearchModal'
import CsvImportModal from '@/components/admin/CsvImportModal'
import ImageUpload from '@/components/admin/ImageUpload'
import Pagination from '@/components/Pagination'

const CELL = 'bg-transparent border border-transparent hover:border-gray-200 focus:border-yellow-400 focus:bg-white rounded px-1.5 py-1 text-xs focus:outline-none w-full transition-colors'

function navKey(e: React.KeyboardEvent, rowIdx: number, colIdx: number) {
  const delta: Record<string, [number, number]> = {
    ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
  }
  const d = delta[e.key]
  if (!d) return
  e.preventDefault()
  const el = document.querySelector<HTMLElement>(
    `[data-nav-row="${rowIdx + d[0]}"][data-nav-col="${colIdx + d[1]}"]`,
  )
  el?.focus()
}

interface PlayerAliasEntry {
  alias: string
  profile_pic: string | null
}

interface Row {
  id: string
  nickname: string
  real_name: string
  nationality: string
  nationality_code: string
  birth_date: string
  team_id: string
  team_name: string
  profile_pic: string | null
  aliases: PlayerAliasEntry[]
  _aliasInput: string
  _dirty: boolean
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toRow(p: PlayerWithDetails & { nationality_code?: string | null }): Row {
  return {
    id: p.id,
    nickname: p.nickname,
    real_name: p.real_name ?? '',
    nationality: p.nationality ?? '',
    nationality_code: p.nationality_code ?? '',
    birth_date: p.birth_date ?? '',
    team_id: p.team_id ?? '',
    team_name: p.teams?.name ?? '',
    profile_pic: p.profile_pic ?? null,
    aliases: p.player_aliases?.map((a) => ({ alias: a.alias, profile_pic: a.profile_pic ?? null })) ?? [],
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

  const [addingNew, setAddingNew] = useState(false)
  const [newPlayer, setNewPlayer] = useState({ nickname: '', real_name: '', nationality: '', nationality_code: '' })

  const [teamModal, setTeamModal] = useState<string | null>(null)
  const [csvModal, setCsvModal] = useState(false)
  const [mergeModal, setMergeModal] = useState<{ fromId: string; fromName: string } | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('players')
      .select('*, player_aliases(*), teams(id, name, short_name)')
      .order('nickname')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setRows((data ?? []).map((p) => toRow(p as any)))
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  function updateRow(id: string, key: keyof Row, value: string) {
    setRows((rs) => rs.map((r) => r.id === id ? { ...r, [key]: value, _dirty: true } : r))
  }

  async function saveRow(row: Row) {
    setSaving(row.id)
    const res = await fetch('/api/admin/players', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: row.id,
        nickname: row.nickname.trim(),
        real_name: row.real_name.trim() || null,
        nationality: row.nationality.trim() || null,
        nationality_code: row.nationality_code.trim().toUpperCase() || null,
        birth_date: row.birth_date || null,
        team_id: row.team_id || null,
        profile_pic: row.profile_pic,
      }),
    })
    setSaving(null)
    if (!res.ok) {
      const json = await res.json()
      alert('Save failed: ' + (json.error ?? res.status))
      return
    }
    setRows((rs) => rs.map((r) => r.id === row.id ? { ...r, _dirty: false } : r))
  }

  function updateProfilePic(id: string, url: string | null) {
    setRows((rs) => rs.map((r) => r.id === id ? { ...r, profile_pic: url, _dirty: true } : r))
  }

  async function updateAliasProfilePic(playerId: string, alias: string, url: string | null) {
    const { data, error } = await supabase
      .from('player_aliases')
      .update({ profile_pic: url })
      .eq('player_id', playerId)
      .eq('alias', alias)
      .select('profile_pic')
    if (error) { alert('Failed to save alias profile pic: ' + error.message); return }
    if (!data?.length) { alert('Missing UPDATE policy on player_aliases.'); return }
    setRows((rs) => rs.map((r) => r.id === playerId ? {
      ...r,
      aliases: r.aliases.map((a) => a.alias === alias ? { ...a, profile_pic: url } : a),
    } : r))
  }

  async function addAlias(row: Row) {
    const alias = row._aliasInput.trim()
    if (!alias) return
    const { error } = await supabase.from('player_aliases').insert([{ player_id: row.id, alias }])
    if (!error) {
      setRows((rs) => rs.map((r) => r.id === row.id ? {
        ...r, aliases: [...r.aliases, { alias, profile_pic: null }], _aliasInput: '',
      } : r))
    } else {
      alert('Alias already exists or is linked to another player')
    }
  }

  async function removeAlias(playerId: string, alias: string) {
    await supabase.from('player_aliases').delete().eq('player_id', playerId).eq('alias', alias)
    setRows((rs) => rs.map((r) => r.id === playerId ? {
      ...r, aliases: r.aliases.filter((a) => a.alias !== alias),
    } : r))
  }

  async function deletePlayer(id: string, name: string) {
    if (!confirm(`Delete player "${name}"?`)) return
    await supabase.from('players').delete().eq('id', id)
    setRows((rs) => rs.filter((r) => r.id !== id))
  }

  async function createPlayer() {
    if (!newPlayer.nickname.trim()) return
    const res = await fetch('/api/admin/players', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nickname: newPlayer.nickname.trim(),
        real_name: newPlayer.real_name.trim() || null,
        nationality: newPlayer.nationality.trim() || null,
        nationality_code: newPlayer.nationality_code.trim().toUpperCase() || null,
      }),
    })
    const json = await res.json()
    if (!res.ok) { alert('Failed to create player: ' + (json.error ?? res.status)); return }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setRows((rs) => [...rs, toRow(json.data as any)])
    setNewPlayer({ nickname: '', real_name: '', nationality: '', nationality_code: '' })
    setAddingNew(false)
  }

  async function assignTeam(playerId: string, teamId: string, teamName: string) {
    await supabase.from('players').update({ team_id: teamId }).eq('id', playerId)
    setRows((rs) => rs.map((r) => r.id === playerId ? { ...r, team_id: teamId, team_name: teamName } : r))
    setTeamModal(null)
  }

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
      r.aliases.some((a) => a.alias.toLowerCase().includes(q))
    const matchNation = !filterNation || r.nationality === filterNation
    const matchTeam = !filterTeam || r.team_name === filterTeam
    return matchSearch && matchNation && matchTeam
  })
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize)

  const thCls = 'px-2 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap'

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Player Management</h1>
        <div className="flex gap-2">
          <button onClick={() => setCsvModal(true)}
            className="border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium text-sm px-4 py-2 rounded-lg">
            CSV Import
          </button>
          <button onClick={() => setAddingNew(true)}
            className="bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold text-sm px-4 py-2 rounded-lg">
            + New Player
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 flex gap-2 flex-wrap">
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          placeholder="Search nickname, real name, alias..."
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full max-w-xs focus:outline-none focus:ring-2 focus:ring-yellow-400"
        />
        <select value={filterTeam} onChange={(e) => { setFilterTeam(e.target.value); setPage(1) }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 text-gray-700">
          <option value="">All Teams</option>
          {teams.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={filterNation} onChange={(e) => { setFilterNation(e.target.value); setPage(1) }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 text-gray-700">
          <option value="">All Countries</option>
          {nations.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        {(search || filterTeam || filterNation) && (
          <button onClick={() => { setSearch(''); setFilterTeam(''); setFilterNation('') }}
            className="text-xs text-gray-400 hover:text-gray-600 px-3 py-2 border border-gray-200 rounded-lg">
            Clear
          </button>
        )}
        <span className="text-xs text-gray-400 self-center ml-1">{filtered.length} players</span>
      </div>

      {/* Add new player row */}
      {addingNew && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 mb-4 flex gap-2 flex-wrap items-end">
          {[
            { label: 'Nickname *', key: 'nickname', ph: 'Nickname', w: 'w-36' },
            { label: 'Real Name', key: 'real_name', ph: 'Name', w: 'w-28' },
            { label: 'Nationality', key: 'nationality', ph: 'Korea', w: 'w-24' },
            { label: 'Code', key: 'nationality_code', ph: 'KR', w: 'w-14' },
          ].map(({ label, key, ph, w }) => (
            <div key={key}>
              <label className="text-[11px] text-gray-500 block mb-1">{label}</label>
              <input
                value={newPlayer[key as keyof typeof newPlayer]}
                onChange={(e) => setNewPlayer((n) => ({ ...n, [key]: key === 'nationality_code' ? e.target.value.toUpperCase().slice(0, 2) : e.target.value }))}
                placeholder={ph}
                autoFocus={key === 'nickname'}
                maxLength={key === 'nationality_code' ? 2 : undefined}
                className={`border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-yellow-400 ${w}`}
              />
            </div>
          ))}
          <button onClick={createPlayer}
            className="bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold text-xs px-3 py-2 rounded-lg h-8">
            Add
          </button>
          <button onClick={() => setAddingNew(false)}
            className="text-xs text-gray-500 hover:text-gray-700 px-2 py-2">Cancel</button>
        </div>
      )}

      {loading ? (
        <p className="text-gray-400 text-sm">Loading...</p>
      ) : (
        <>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className={thCls + ' w-8 text-center'}>#</th>
                    <th className={thCls + ' w-9'}>Photo</th>
                    <th className={thCls + ' min-w-[110px]'}>Nickname</th>
                    <th className={thCls + ' min-w-[90px]'}>Real Name</th>
                    <th className={thCls + ' min-w-[80px]'}>Nationality</th>
                    <th className={thCls + ' w-24'}>Code / Flag</th>
                    <th className={thCls + ' w-28'}>Birth Date</th>
                    <th className={thCls + ' min-w-[110px]'}>Team</th>
                    <th className={thCls + ' w-44 text-right'}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((row, i) => (
                    <Fragment key={row.id}>
                      <tr className={`border-b border-gray-100 last:border-0 hover:bg-gray-50/40 ${row._dirty ? 'bg-yellow-50/40' : ''}`}>
                        <td className="px-2 py-1 text-center text-gray-400 select-none">
                          {(page - 1) * pageSize + i + 1}
                        </td>
                        <td className="px-1 py-1">
                          <ImageUpload
                            currentUrl={row.profile_pic}
                            storagePath={`players/${row.id}/avatar`}
                            onUpdate={(url) => updateProfilePic(row.id, url)}
                            shape="square"
                            size="sm"
                          />
                        </td>
                        <td className="px-1 py-1">
                          <input value={row.nickname}
                            onChange={(e) => updateRow(row.id, 'nickname', e.target.value)}
                            onKeyDown={(e) => navKey(e, i, 0)}
                            data-nav-row={i} data-nav-col={0}
                            className={CELL} placeholder="Nickname" />
                        </td>
                        <td className="px-1 py-1">
                          <input value={row.real_name}
                            onChange={(e) => updateRow(row.id, 'real_name', e.target.value)}
                            onKeyDown={(e) => navKey(e, i, 1)}
                            data-nav-row={i} data-nav-col={1}
                            className={CELL} placeholder="—" />
                        </td>
                        <td className="px-1 py-1">
                          <input value={row.nationality}
                            onChange={(e) => updateRow(row.id, 'nationality', e.target.value)}
                            onKeyDown={(e) => navKey(e, i, 2)}
                            data-nav-row={i} data-nav-col={2}
                            className={CELL} placeholder="Korea" />
                        </td>
                        <td className="px-1 py-1">
                          <div className="flex items-center gap-1.5">
                            <input
                              value={row.nationality_code}
                              onChange={(e) => updateRow(row.id, 'nationality_code', e.target.value.toUpperCase().slice(0, 2))}
                              onKeyDown={(e) => navKey(e, i, 3)}
                              data-nav-row={i} data-nav-col={3}
                              className={CELL + ' w-10 text-center uppercase font-mono'}
                              placeholder="KR"
                              maxLength={2}
                            />
                            {row.nationality_code.length === 2 && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={`https://flagcdn.com/20x15/${row.nationality_code.toLowerCase()}.png`}
                                alt={row.nationality_code}
                                className="h-[11px] shrink-0 rounded-[1px]"
                              />
                            )}
                          </div>
                        </td>
                        <td className="px-1 py-1">
                          <input type="date" value={row.birth_date}
                            onChange={(e) => updateRow(row.id, 'birth_date', e.target.value)}
                            onKeyDown={(e) => navKey(e, i, 4)}
                            data-nav-row={i} data-nav-col={4}
                            className={CELL} />
                        </td>
                        <td className="px-1 py-1">
                          <button
                            onClick={() => setTeamModal(row.id)}
                            onKeyDown={(e) => navKey(e, i, 5)}
                            data-nav-row={i} data-nav-col={5}
                            className={CELL + ' text-left truncate cursor-pointer'}
                            title={row.team_name || 'No team'}
                          >
                            {row.team_name || <span className="text-gray-300">—</span>}
                          </button>
                        </td>
                        <td className="px-2 py-1">
                          <div className="flex gap-1 justify-end items-center">
                            {row._dirty && (
                              <button onClick={() => saveRow(row)} disabled={saving === row.id}
                                className="text-[11px] bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold px-2 py-1 rounded whitespace-nowrap">
                                {saving === row.id ? '...' : 'Save'}
                              </button>
                            )}
                            <button
                              onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}
                              className={`text-[11px] px-1.5 py-1 border rounded whitespace-nowrap ${expandedId === row.id ? 'bg-gray-100 border-gray-300 text-gray-700' : 'border-gray-200 text-gray-400 hover:text-gray-600'}`}
                            >
                              {row.aliases.length > 0 ? `alias(${row.aliases.length})` : 'alias'}
                            </button>
                            <button onClick={() => setMergeModal({ fromId: row.id, fromName: row.nickname })}
                              className="text-[11px] text-blue-400 hover:text-blue-600 px-1.5 py-1 border border-blue-200 rounded">
                              Merge
                            </button>
                            <button onClick={() => deletePlayer(row.id, row.nickname)}
                              className="text-[11px] text-red-400 hover:text-red-600 px-1.5 py-1 border border-red-200 rounded">
                              Del
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expandedId === row.id && (
                        <tr>
                          <td colSpan={9} className="bg-gray-50 border-b border-gray-100 px-4 py-2.5">
                            <p className="text-[11px] font-semibold text-gray-400 mb-2 uppercase tracking-wide">Aliases / Former Nicknames</p>
                            {row.aliases.length === 0 && (
                              <p className="text-xs text-gray-400 mb-2">No aliases</p>
                            )}
                            <div className="flex flex-wrap gap-2 mb-2">
                              {row.aliases.map((a) => (
                                <div key={a.alias} className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-lg px-2 py-1">
                                  <ImageUpload
                                    currentUrl={a.profile_pic}
                                    storagePath={`players/${row.id}/aliases/${a.alias}`}
                                    onUpdate={(url) => updateAliasProfilePic(row.id, a.alias, url)}
                                    shape="square" size="sm"
                                  />
                                  <span className="text-xs text-gray-700">{a.alias}</span>
                                  <button onClick={() => removeAlias(row.id, a.alias)}
                                    className="text-gray-300 hover:text-red-500 text-sm leading-none ml-0.5">×</button>
                                </div>
                              ))}
                            </div>
                            <div className="flex gap-2">
                              <input
                                value={row._aliasInput}
                                onChange={(e) => updateRow(row.id, '_aliasInput', e.target.value)}
                                placeholder="New alias"
                                className="border border-gray-300 rounded px-2 py-1 text-xs w-40 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                                onKeyDown={(e) => { if (e.key === 'Enter') addAlias(row) }}
                              />
                              <button onClick={() => addAlias(row)}
                                className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-700 px-2.5 py-1 rounded">
                                Add
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            {filtered.length === 0 && !loading && (
              <p className="text-gray-400 text-sm text-center py-10">
                {search ? 'No results found' : 'No players registered'}
              </p>
            )}
          </div>
          <Pagination
            total={filtered.length} page={page} pageSize={pageSize}
            onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1) }}
          />
        </>
      )}

      {csvModal && (
        <CsvImportModal type="players" onDone={() => load()} onClose={() => setCsvModal(false)} />
      )}
      {teamModal && (
        <SearchModal
          type="team"
          targetName={rows.find((r) => r.id === teamModal)?.nickname ?? ''}
          onConfirm={(teamId, teamName) => assignTeam(teamModal, teamId, teamName)}
          onClose={() => setTeamModal(null)}
        />
      )}
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
