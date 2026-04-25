'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Props {
  type: 'team' | 'player'
  entityId: string
  entityName: string   // current registered name (e.g. "DN SOOPers")
  pubgName: string     // raw PUBG in-game name (e.g. "DNF")
  matchCount: number
  onConfirm: (displayName: string | null) => void  // null = keep pubg name
  onClose: () => void
}

export default function DisplayNameModal({
  type, entityId, entityName, pubgName, matchCount, onConfirm, onClose,
}: Props) {
  const [aliases, setAliases] = useState<string[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [custom, setCustom] = useState('')
  const [useCustom, setUseCustom] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    async function fetchAliases() {
      const table = type === 'team' ? 'team_aliases' : 'player_aliases'
      const fk = type === 'team' ? 'team_id' : 'player_id'
      const { data } = await supabase.from(table).select('alias').eq(fk, entityId)
      setAliases((data ?? []).map((d) => d.alias))
    }
    fetchAliases()
  }, [entityId, type, supabase])

  const options: { value: string | null; label: string; badge: string }[] = [
    { value: null, label: pubgName, badge: 'PUBG name' },
    { value: entityName, label: entityName, badge: 'current name' },
    ...aliases.map((a) => ({ value: a, label: a, badge: 'former name' })),
  ]

  function handleConfirm() {
    if (useCustom) {
      onConfirm(custom.trim() || null)
    } else {
      onConfirm(selected)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-gray-900 mb-1">Choose Display Name</h3>
        <p className="text-sm text-gray-500 mb-4">
          How should{' '}
          <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-yellow-700">{pubgName}</span>
          {' '}appear in {matchCount > 1 ? `all ${matchCount} matches` : 'this match'}?
        </p>

        <div className="space-y-2 mb-4">
          {options.map((opt) => (
            <button
              key={opt.label}
              onClick={() => { setSelected(opt.value); setUseCustom(false) }}
              className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors flex items-center justify-between ${
                !useCustom && selected === opt.value
                  ? 'border-yellow-400 bg-yellow-50'
                  : 'border-gray-200 hover:border-yellow-300 hover:bg-gray-50'
              }`}
            >
              <span className="text-sm font-medium text-gray-800">{opt.label}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                opt.badge === 'former name' ? 'bg-blue-100 text-blue-600' :
                opt.badge === 'current name' ? 'bg-gray-100 text-gray-500' :
                'bg-orange-100 text-orange-500'
              }`}>{opt.badge}</span>
            </button>
          ))}

          <button
            onClick={() => { setUseCustom(true); setSelected(null) }}
            className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors ${
              useCustom ? 'border-yellow-400 bg-yellow-50' : 'border-dashed border-gray-200 hover:border-yellow-300'
            }`}
          >
            <span className="text-sm text-gray-500">Custom name...</span>
          </button>

          {useCustom && (
            <input
              autoFocus
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="Enter display name"
              className="w-full border border-yellow-400 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
            />
          )}
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!useCustom && selected === undefined}
            className="px-4 py-2 text-sm bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-medium rounded-lg disabled:opacity-50"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  )
}
