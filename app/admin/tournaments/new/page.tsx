'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { TournamentStatus, TournamentType } from '@/lib/types'

export default function NewTournamentPage() {
  const router = useRouter()
  const supabase = createClient()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    name: '',
    short_name: '',
    type: 'online' as TournamentType,
    region: '',
    start_date: '',
    end_date: '',
    prize_pool: '',
    status: 'upcoming' as TournamentStatus,
    description: '',
  })

  function set(key: string, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Tournament name is required'); return }
    setSaving(true)
    setError('')
    try {
      const { data, error } = await supabase.from('tournaments').insert([{
        name: form.name.trim(),
        short_name: form.short_name.trim() || null,
        type: form.type,
        region: form.region.trim() || null,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        prize_pool: form.prize_pool.trim() || null,
        status: form.status,
        description: form.description.trim() || null,
      }]).select().single()

      if (error) throw error
      router.push(`/admin/tournaments/${data.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-8">New Tournament</h1>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        <Field label="Tournament Name *">
          <input
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="e.g. PUBG Global Series 2025"
            className={INPUT_CLS}
            required
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Tag">
            <input value={form.short_name} onChange={(e) => set('short_name', e.target.value)}
              placeholder="PGS25" className={INPUT_CLS} />
          </Field>
          <Field label="Format">
            <select value={form.type} onChange={(e) => set('type', e.target.value)} className={INPUT_CLS}>
              <option value="online">Online</option>
              <option value="lan">LAN</option>
              <option value="regional">Regional</option>
              <option value="global">Global</option>
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Region">
            <input value={form.region} onChange={(e) => set('region', e.target.value)}
              placeholder="Korea, Global..." className={INPUT_CLS} />
          </Field>
          <Field label="Prize Pool">
            <input value={form.prize_pool} onChange={(e) => set('prize_pool', e.target.value)}
              placeholder="$1,000,000" className={INPUT_CLS} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Start Date">
            <input type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)}
              className={INPUT_CLS} />
          </Field>
          <Field label="End Date">
            <input type="date" value={form.end_date} onChange={(e) => set('end_date', e.target.value)}
              className={INPUT_CLS} />
          </Field>
        </div>

        <Field label="Status">
          <select value={form.status} onChange={(e) => set('status', e.target.value)} className={INPUT_CLS}>
            <option value="upcoming">Upcoming</option>
            <option value="ongoing">Ongoing</option>
            <option value="completed">Completed</option>
          </select>
        </Field>

        <Field label="Description">
          <textarea value={form.description} onChange={(e) => set('description', e.target.value)}
            rows={3} placeholder="Tournament description..." className={INPUT_CLS} />
        </Field>

        {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={saving}
            className="bg-yellow-400 hover:bg-yellow-300 disabled:opacity-60 text-gray-900 font-semibold px-6 py-2 rounded-lg text-sm transition-colors">
            {saving ? 'Saving...' : 'Create Tournament'}
          </button>
          <button type="button" onClick={() => router.back()}
            className="px-6 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
        </div>
      </form>
    </div>
  )
}

const INPUT_CLS = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  )
}
