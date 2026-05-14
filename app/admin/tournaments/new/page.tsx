'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { TournamentStatus, TournamentType } from '@/lib/types'
import { CURRENCIES, currencySymbol, fmtNumberInput, parseNumberInput } from '@/lib/currency'
import ImageUpload from '@/components/admin/ImageUpload'

const INPUT_CLS = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400'

function autoStatus(startDate: string, endDate: string): TournamentStatus {
  const today = new Date().toISOString().slice(0, 10)
  if (!startDate && !endDate) return 'upcoming'
  if (startDate && today < startDate) return 'upcoming'
  if (endDate && today > endDate) return 'completed'
  return 'ongoing'
}

export default function NewTournamentPage() {
  const router = useRouter()
  const supabase = createClient()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [tournamentId] = useState(() => crypto.randomUUID())
  const [bannerUrl, setBannerUrl] = useState<string | null>(null)

  const [form, setForm] = useState({
    name: '',
    short_name: '',
    tag: '',
    status: 'upcoming' as TournamentStatus,
    type: 'regional' as TournamentType,
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Tournament name is required'); return }
    setSaving(true)
    setError('')
    try {
      const { data, error: insertErr } = await supabase.from('tournaments').insert([{
        id: tournamentId,
        name: form.name.trim(),
        short_name: form.short_name.trim() || null,
        tag: form.tag.trim() || null,
        status: form.status,
        type: form.type,
        region: form.region.trim() || null,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        prize_pool: parseNumberInput(prizePoolInput),
        currency: prizeCurrency,
        description: form.description.trim() || null,
        has_prize: form.has_prize,
        has_pgs_points: form.has_pgs_points,
        has_pgc_points: form.has_pgc_points,
        banner_url: bannerUrl,
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

          <div className="col-span-2">
            <label className="text-xs text-gray-500 block mb-1">Tournament Name *</label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. PUBG Global Series 2025"
              className={INPUT_CLS}
              required
            />
          </div>

          <div>
            <label className="text-xs text-gray-500 block mb-1">Short Name</label>
            <input
              value={form.short_name}
              onChange={(e) => setForm((f) => ({ ...f, short_name: e.target.value }))}
              placeholder="PUBG Global Series 25"
              className={INPUT_CLS}
            />
          </div>

          <div>
            <label className="text-xs text-gray-500 block mb-1">Tag</label>
            <input
              value={form.tag}
              onChange={(e) => setForm((f) => ({ ...f, tag: e.target.value }))}
              placeholder="PGS25"
              className={INPUT_CLS}
            />
          </div>

          <div>
            <label className="text-xs text-gray-500 block mb-1">Status</label>
            <select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as TournamentStatus }))}
              className={INPUT_CLS}
            >
              <option value="upcoming">Upcoming</option>
              <option value="ongoing">Ongoing</option>
              <option value="completed">Completed</option>
            </select>
          </div>

          <div>
            <label className="text-xs text-gray-500 block mb-1">Format</label>
            <select
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as TournamentType }))}
              className={INPUT_CLS}
            >
              <option value="regional">Regional</option>
              <option value="continental">Continental</option>
              <option value="global">Global</option>
            </select>
          </div>

          <div>
            <label className="text-xs text-gray-500 block mb-1">Region</label>
            <input
              value={form.region}
              onChange={(e) => setForm((f) => ({ ...f, region: e.target.value }))}
              placeholder="Korea, Global..."
              className={INPUT_CLS}
            />
          </div>

          <div>
            <label className="text-xs text-gray-500 block mb-1">Start Date</label>
            <input
              type="date"
              value={form.start_date}
              onChange={(e) => {
                const v = e.target.value
                setForm((f) => ({ ...f, start_date: v, status: autoStatus(v, f.end_date) }))
              }}
              className={INPUT_CLS}
            />
          </div>

          <div>
            <label className="text-xs text-gray-500 block mb-1">End Date</label>
            <input
              type="date"
              value={form.end_date}
              onChange={(e) => {
                const v = e.target.value
                setForm((f) => ({ ...f, end_date: v, status: autoStatus(f.start_date, v) }))
              }}
              className={INPUT_CLS}
            />
          </div>

          <div>
            <label className="text-xs text-gray-500 block mb-1">Prize Pool</label>
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
                  onChange={(e) => setPrizePoolInput(fmtNumberInput(e.target.value))}
                  placeholder="0"
                  className={INPUT_CLS + ' pl-7'}
                />
              </div>
            </div>
          </div>

          <div className="col-span-2">
            <label className="text-xs text-gray-500 block mb-1">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={2}
              placeholder="Tournament description..."
              className={INPUT_CLS}
            />
          </div>

          <div className="col-span-2">
            <ImageUpload
              currentUrl={bannerUrl}
              storagePath={`tournaments/${tournamentId}/banner`}
              onUpdate={(url) => setBannerUrl(url)}
              shape="wide"
              size="lg"
              label="Tournament Logo / Banner"
            />
          </div>

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
                    onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.checked }))}
                    className="rounded border-gray-300 text-yellow-400 focus:ring-yellow-400"
                  />
                  <span className="text-sm text-gray-700">{label}</span>
                </label>
              ))}
            </div>
          </div>

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
