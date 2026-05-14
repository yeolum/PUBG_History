'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { TournamentStatus, TournamentType } from '@/lib/types'
import { CURRENCIES, currencySymbol, fmtNumberInput, parseNumberInput } from '@/lib/currency'
import ImageUpload from '@/components/admin/ImageUpload'

const INPUT_CLS = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent'

function Field({ label, children, col2 }: { label: string; children: React.ReactNode; col2?: boolean }) {
  return (
    <div className={col2 ? 'col-span-2' : ''}>
      <label className="text-xs text-gray-500 block mb-1">{label}</label>
      {children}
    </div>
  )
}

function autoStatus(startDate: string, endDate: string): TournamentStatus {
  const today = new Date().toISOString().slice(0, 10)
  if (!startDate && !endDate) return 'upcoming'
  if (startDate && today < startDate) return 'upcoming'
  if (endDate && today > endDate) return 'completed'
  return 'ongoing'
}

const STATUS_LABEL: Record<TournamentStatus, string> = {
  upcoming: 'Upcoming',
  ongoing: 'Ongoing',
  completed: 'Completed',
}

const STATUS_COLOR: Record<TournamentStatus, string> = {
  upcoming: 'bg-gray-100 text-gray-600',
  ongoing: 'bg-green-100 text-green-700',
  completed: 'bg-blue-100 text-blue-700',
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

  const computedStatus = useMemo(
    () => autoStatus(form.start_date, form.end_date),
    [form.start_date, form.end_date],
  )

  function set<K extends keyof typeof form>(key: K, value: typeof form[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

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
        status: computedStatus,
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

          <Field label="Tournament Name *" col2>
            <input
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. PUBG Global Series 2025"
              className={INPUT_CLS}
              required
            />
          </Field>

          <Field label="Short Name">
            <input
              value={form.short_name}
              onChange={(e) => set('short_name', e.target.value)}
              placeholder="PUBG Global Series 25"
              className={INPUT_CLS}
            />
          </Field>

          <Field label="Tag">
            <input
              value={form.tag}
              onChange={(e) => set('tag', e.target.value)}
              placeholder="PGS25"
              className={INPUT_CLS}
            />
          </Field>

          <Field label="Format">
            <select value={form.type} onChange={(e) => set('type', e.target.value as TournamentType)} className={INPUT_CLS}>
              <option value="regional">Regional</option>
              <option value="continental">Continental</option>
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

          <div>
            <label className="text-xs text-gray-500 block mb-1.5">Status (자동)</label>
            <span className={`inline-flex items-center px-3 py-1.5 rounded-lg text-sm font-medium ${STATUS_COLOR[computedStatus]}`}>
              {STATUS_LABEL[computedStatus]}
            </span>
          </div>

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
                  onChange={(e) => setPrizePoolInput(fmtNumberInput(e.target.value))}
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
