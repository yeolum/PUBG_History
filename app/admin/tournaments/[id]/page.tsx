'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { Tournament, Stage, Match, TournamentStatus, TournamentType } from '@/lib/types'
import ImageUpload from '@/components/admin/ImageUpload'

const INPUT_CLS = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400'

export default function AdminTournamentDetailPage() {
  const { id } = useParams() as { id: string }
  const router = useRouter()
  const supabase = createClient()

  const [tournament, setTournament] = useState<Tournament | null>(null)
  const [stageList, setStageList] = useState<(Stage & { matches: Match[] })[]>([])
  const [editMode, setEditMode] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<Partial<Tournament>>({})
  const [err, setErr] = useState('')

  const [addingStage, setAddingStage] = useState(false)
  const [newStageName, setNewStageName] = useState('')
  const [newStageType, setNewStageType] = useState('group')

  const load = useCallback(async () => {
    const [{ data: t }, { data: s }] = await Promise.all([
      supabase.from('tournaments').select('*').eq('id', id).single(),
      supabase
        .from('stages')
        .select('*, matches(*)')
        .eq('tournament_id', id)
        .order('order_num'),
    ])
    if (!t) { router.push('/admin/tournaments'); return }
    setTournament(t as Tournament)
    setForm(t as Tournament)
    setStageList((s ?? []) as (Stage & { matches: Match[] })[])
  }, [id, supabase, router])

  useEffect(() => { load() }, [load])

  async function saveTournament() {
    if (!form.name?.trim()) return
    setSaving(true)
    setErr('')
    const { error } = await supabase.from('tournaments').update({
      name: form.name,
      short_name: form.short_name || null,
      type: form.type,
      region: form.region || null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      prize_pool: form.prize_pool || null,
      status: form.status,
      description: form.description || null,
      banner_url: form.banner_url ?? null,
    }).eq('id', id)
    setSaving(false)
    if (error) { setErr('Save failed: ' + error.message); return }
    setEditMode(false)
    load()
  }

  async function deleteTournament() {
    if (!confirm('Delete this tournament? All related data will be removed.')) return
    await supabase.from('tournaments').delete().eq('id', id)
    router.push('/admin/tournaments')
  }

  async function addStage() {
    if (!newStageName.trim()) return
    setErr('')
    const maxOrder = stageList.length > 0 ? Math.max(...stageList.map((s) => s.order_num)) + 1 : 0
    const { error } = await supabase.from('stages').insert([{
      tournament_id: id,
      name: newStageName.trim(),
      type: newStageType,
      order_num: maxOrder,
    }])
    if (error) { setErr('Failed to add stage: ' + error.message); return }
    setAddingStage(false)
    setNewStageName('')
    await load()
  }

  async function deleteStage(stageId: string) {
    if (!confirm('Delete this stage and all its matches?')) return
    await supabase.from('stages').delete().eq('id', stageId)
    load()
  }

  if (!tournament) return <div className="p-8 text-gray-400">Loading...</div>

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center gap-2 text-sm text-gray-400 mb-6">
        <Link href="/admin/tournaments" className="hover:text-gray-600">Tournaments</Link>
        <span>/</span>
        <span className="text-gray-700">{tournament.name}</span>
      </div>

      {err && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 flex items-center justify-between">
          {err}
          <button onClick={() => setErr('')} className="text-red-400 hover:text-red-600 ml-4">✕</button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-8">
        <div className="flex items-start justify-between mb-4">
          <h1 className="text-xl font-bold text-gray-900">{tournament.name}</h1>
          <div className="flex gap-2">
            {!editMode ? (
              <>
                <button onClick={() => setEditMode(true)}
                  className="text-sm px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700">
                  Edit
                </button>
                <button onClick={deleteTournament}
                  className="text-sm px-3 py-1.5 border border-red-200 rounded-lg hover:bg-red-50 text-red-600">
                  Delete
                </button>
              </>
            ) : (
              <>
                <button onClick={saveTournament} disabled={saving}
                  className="text-sm px-3 py-1.5 bg-yellow-400 hover:bg-yellow-300 rounded-lg text-gray-900 font-medium">
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button onClick={() => { setEditMode(false); setForm(tournament) }}
                  className="text-sm px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700">
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>

        {editMode ? (
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="text-xs text-gray-500 block mb-1">Tournament Name</label>
              <input value={form.name ?? ''} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={INPUT_CLS} />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Tag</label>
              <input value={form.short_name ?? ''} onChange={(e) => setForm((f) => ({ ...f, short_name: e.target.value }))} className={INPUT_CLS} />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Status</label>
              <select value={form.status ?? 'upcoming'} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as TournamentStatus }))} className={INPUT_CLS}>
                <option value="upcoming">Upcoming</option>
                <option value="ongoing">Ongoing</option>
                <option value="completed">Completed</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Format</label>
              <select value={form.type ?? 'online'} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as TournamentType }))} className={INPUT_CLS}>
                <option value="online">Online</option>
                <option value="lan">LAN</option>
                <option value="regional">Regional</option>
                <option value="global">Global</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Region</label>
              <input value={form.region ?? ''} onChange={(e) => setForm((f) => ({ ...f, region: e.target.value }))} className={INPUT_CLS} />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Start Date</label>
              <input type="date" value={form.start_date ?? ''} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} className={INPUT_CLS} />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">End Date</label>
              <input type="date" value={form.end_date ?? ''} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} className={INPUT_CLS} />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Prize Pool</label>
              <input value={form.prize_pool ?? ''} onChange={(e) => setForm((f) => ({ ...f, prize_pool: e.target.value }))} className={INPUT_CLS} />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-gray-500 block mb-1">Description</label>
              <textarea value={form.description ?? ''} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2} className={INPUT_CLS} />
            </div>
            <div className="col-span-2">
              <ImageUpload
                currentUrl={form.banner_url ?? null}
                storagePath={`tournaments/${id}/banner`}
                onUpdate={(url) => setForm((f) => ({ ...f, banner_url: url ?? undefined }))}
                shape="wide"
                size="lg"
                label="Tournament Logo / Banner"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {tournament.banner_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={tournament.banner_url} alt="banner" className="rounded-lg max-h-40 object-contain border border-gray-100" />
            )}
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
            {[
              ['Status', tournament.status === 'upcoming' ? 'Upcoming' : tournament.status === 'ongoing' ? 'Ongoing' : 'Completed'],
              ['Format', tournament.type],
              ['Region', tournament.region ?? '-'],
              ['Prize Pool', tournament.prize_pool ?? '-'],
              ['Period', `${tournament.start_date ?? '?'} ~ ${tournament.end_date ?? '?'}`],
              ['Tag', tournament.short_name ?? '-'],
            ].map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <span className="text-gray-400 w-20 shrink-0">{k}</span>
                <span className="text-gray-800">{v}</span>
              </div>
            ))}
            {tournament.description && (
              <div className="col-span-2 flex gap-2">
                <span className="text-gray-400 w-20 shrink-0">Description</span>
                <span className="text-gray-600">{tournament.description}</span>
              </div>
            )}
          </div>
          </div>
        )}
      </div>

      <div>
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Stages</h2>

        <div className="space-y-2">
          {stageList.length === 0 && !addingStage && (
            <p className="text-sm text-gray-400 text-center py-4">No stages yet.</p>
          )}

          {stageList
            .slice()
            .sort((a, b) => a.order_num - b.order_num)
            .map((stage) => (
              <div key={stage.id} className="flex items-center justify-between border border-gray-200 rounded-lg px-4 py-2.5 bg-white hover:bg-gray-50">
                <div>
                  <span className="text-sm font-medium text-gray-800">{stage.name}</span>
                  <span className="ml-2 text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                    {stage.type === 'group' ? 'Group' : stage.type === 'playoff' ? 'Playoff' : 'Final'}
                  </span>
                  <span className="ml-2 text-xs text-gray-400">{stage.matches.length} matches</span>
                </div>
                <div className="flex gap-3">
                  <Link
                    href={`/admin/tournaments/${id}/stages/${stage.id}`}
                    className="text-xs font-medium text-yellow-600 hover:text-yellow-700"
                  >
                    Manage →
                  </Link>
                  <button onClick={() => deleteStage(stage.id)}
                    className="text-xs text-red-400 hover:text-red-600">Delete</button>
                </div>
              </div>
            ))}

          {addingStage ? (
            <div className="border border-dashed border-gray-300 rounded-lg p-3 flex gap-2 flex-wrap bg-white">
              <input
                autoFocus
                value={newStageName}
                onChange={(e) => setNewStageName(e.target.value)}
                placeholder="Stage name"
                className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm min-w-0"
                onKeyDown={(e) => { if (e.key === 'Enter') addStage() }}
              />
              <select value={newStageType} onChange={(e) => setNewStageType(e.target.value)}
                className="border border-gray-300 rounded px-2 py-1 text-sm">
                <option value="group">Group</option>
                <option value="playoff">Playoff</option>
                <option value="grand_final">Final</option>
              </select>
              <button onClick={addStage}
                className="bg-yellow-400 hover:bg-yellow-300 text-gray-900 text-xs font-medium px-3 py-1 rounded">
                Add
              </button>
              <button onClick={() => { setAddingStage(false); setNewStageName('') }}
                className="text-xs text-gray-400 hover:text-gray-600 px-2">Cancel</button>
            </div>
          ) : (
            <button
              onClick={() => { setAddingStage(true); setNewStageName(''); setNewStageType('group') }}
              className="w-full border border-dashed border-gray-300 rounded-lg py-2.5 text-sm text-gray-400 hover:text-gray-600 hover:border-gray-400 transition-colors bg-white"
            >
              + Add Stage
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
