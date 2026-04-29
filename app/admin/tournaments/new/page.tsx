'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { TournamentStatus, TournamentType } from '@/lib/types'

const INPUT_CLS = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent'

const CURRENCIES = [
  { code: 'USD', symbol: '$' },
  { code: 'EUR', symbol: '€' },
  { code: 'KRW', symbol: '₩' },
  { code: 'GBP', symbol: '£' },
  { code: 'JPY', symbol: '¥' },
  { code: 'CNY', symbol: 'CN¥' },
  { code: 'AUD', symbol: 'A$' },
  { code: 'SGD', symbol: 'S$' },
]

function currencySymbol(code: string) {
  return CURRENCIES.find((c) => c.code === code)?.symbol ?? '$'
}

function fmtNum(val: string): string {
  const n = val.replace(/[^\d]/g, '')
  if (!n) return ''
  return parseInt(n, 10).toLocaleString('en-US')
}

function Field({ label, children, col2 }: { label: string; children: React.ReactNode; col2?: boolean }) {
  return (
    <div className={col2 ? 'col-span-2' : ''}>
      <label className="text-xs text-gray-500 block mb-1">{label}</label>
      {children}
    </div>
  )
}

export default function NewTournamentPage() {
  const router = useRouter()
  const supabase = createClient()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    name: '',
    short_name: '',
    status: 'upcoming' as TournamentStatus,
    type: 'online' as TournamentType,
    region: '',
    start_date: '',
    end_date: '',
    description: '',
    has_prize: false,
    has_pgs_points: false,
    has_pgc_points: false,
  })
  const [prizeCurrency, setPrizeCurrency] = useState('USD')
  const [prizePoolInput, setPrizePoolInput] = useState('')

  function set<K extends keyof typeof form>(key: K, value: typeof form[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Tournament name is required'); return }
    setSaving(true)
    setError('')
    try {
      const sym = currencySymbol(prizeCurrency)
      const prizePool = prizePoolInput ? `${sym}${prizePoolInput}` : null

      const { data, error: insertErr } = await supabase.from('tournaments').insert([{
        name: form.name.trim(),
        short_name: form.short_name.trim() || null,
        status: form.status,
        type: form.type,
        region: form.region.trim() || null,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        prize_pool: prizePool,
        description: form.description.trim() || null,
        has_prize: form.has_prize,
        has_pgs_points: form.has_pgs_points,
        has_pgc_points: form.has_pgc_points,
      }]).select().single()

      if (insertErr) throw insertErr
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

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="grid grid-cols-2 gap-4">

          <Field label="Tournament Name *" col2>
            <input
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. PUBG Global Series 2025"
              className={INPUT_CLS}
              required
            />
          </Field>

          <Field label="Tag">
            <input
              value={form.short_name}
              onChange={(e) => set('short_name', e.target.value)}
              placeholder="PGS25"
              className={INPUT_CLS}
            />
          </Field>

          <Field label="Status">
            <select value={form.status} onChange={(e) => set('status', e.target.value as TournamentStatus)} className={INPUT_CLS}>
              <option value="upcoming">Upcoming</option>
              <option value="ongoing">Ongoing</option>
              <option value="completed">Completed</option>
            </select>
          </Field>

          <Field label="Format">
            <select value={form.type} onChange={(e) => set('type', e.target.value as TournamentType)} className={INPUT_CLS}>
              <option value="online">Online</option>
              <option value="lan">LAN</option>
              <option value="regional">Regional</option>
              <option value="global">Global</option>
            </select>
          </Field>

          <Field label="Region">
            <input
              value={form.region}
              onChange={(e) => set('region', e.target.value)}
              placeholder="Korea, Global..."
              className={INPUT_CLS}
            />
          </Field>

          <Field label="Start Date">
            <input type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} className={INPUT_CLS} />
          </Field>

          <Field label="End Date">
            <input type="date" value={form.end_date} onChange={(e) => set('end_date', e.target.value)} className={INPUT_CLS} />
          </Field>

          <Field label="Prize Pool">
            <div className="flex gap-2">
              <select
                value={prizeCurrency}
                onChange={(e) => setPrizeCurrency(e.target.value)}
                className="border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 shrink-0"
              >
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>{c.code} ({c.symbol})</option>
                ))}
              </select>
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400 pointer-events-none">
                  {currencySymbol(prizeCurrency)}
                </span>
                <input
                  value={prizePoolInput}
                  onChange={(e) => setPrizePoolInput(fmtNum(e.target.value))}
                  placeholder="0"
                  className={INPUT_CLS + ' pl-7'}
                />
              </div>
            </div>
          </Field>

          <Field label="Description" col2>
            <textarea
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              rows={2}
              placeholder="Tournament description..."
              className={INPUT_CLS}
            />
          </Field>

          <div className="col-span-2">
            <label className="text-xs text-gray-500 block mb-2">Display Options</label>
            <div className="flex gap-4">
              {([
                { key: 'has_prize' as const, label: 'Prize Money' },
                { key: 'has_pgs_points' as const, label: 'PGS Points' },
                { key: 'has_pgc_points' as const, label: 'PGC Points' },
              ] as const).map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={form[key]}
                    onChange={(e) => set(key, e.target.checked)}
                    className="rounded border-gray-300 text-yellow-400 focus:ring-yellow-400"
                  />
                  <span className="text-sm text-gray-700">{label}</span>
                </label>
              ))}
            </div>
          </div>

          <p className="col-span-2 text-xs text-gray-400">
            * Tournament logo / banner can be uploaded after creation via the Edit button.
          </p>

        </div>

        {error && (
          <p className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
        )}

        <div className="flex gap-3 pt-5">
          <button
            type="submit"
            disabled={saving}
            className="bg-yellow-400 hover:bg-yellow-300 disabled:opacity-60 text-gray-900 font-semibold px-6 py-2 rounded-lg text-sm transition-colors"
          >
            {saving ? 'Saving...' : 'Create Tournament'}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="px-6 py-2 text-sm text-gray-600 hover:text-gray-800"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
