'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Alias {
  id: string
  alias: string
}

interface Props {
  playerId: string
  playerNickname: string
  onClose: () => void
  onChanged?: () => void
}

export default function PlayerAliasesModal({ playerId, playerNickname, onClose, onChanged }: Props) {
  const supabase = createClient()
  const [aliases, setAliases] = useState<Alias[]>([])
  const [newAlias, setNewAlias] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const reload = useCallback(async () => {
    const { data } = await supabase
      .from('player_aliases')
      .select('id, alias')
      .eq('player_id', playerId)
      .order('alias')
    setAliases((data ?? []) as Alias[])
  }, [playerId, supabase])

  useEffect(() => { reload() }, [reload])

  async function addAlias() {
    const trimmed = newAlias.trim()
    if (!trimmed) return
    setBusy(true)
    setErr('')
    const { error } = await supabase
      .from('player_aliases')
      .insert([{ player_id: playerId, alias: trimmed }])
    if (error) {
      const msg = error.message.toLowerCase().includes('duplicate') || error.code === '23505'
        ? `"${trimmed}" is already used (possibly by another player). Aliases are unique site-wide.`
        : error.message
      setErr(msg)
      setBusy(false)
      return
    }
    setNewAlias('')
    await reload()
    onChanged?.()
    setBusy(false)
  }

  async function removeAlias(aliasId: string) {
    setBusy(true)
    setErr('')
    const { error } = await supabase.from('player_aliases').delete().eq('id', aliasId)
    if (error) { setErr(error.message); setBusy(false); return }
    setAliases((prev) => prev.filter((a) => a.id !== aliasId))
    onChanged?.()
    setBusy(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-200">
          <h3 className="text-base font-semibold text-gray-900">
            Aliases — <span className="text-yellow-600">{playerNickname}</span>
          </h3>
          <p className="text-xs text-gray-500 mt-1">
            Other names (PUBG in-game tags, former nicknames) that should match this player during match import.
          </p>
        </div>

        <div className="px-5 py-4 max-h-[60vh] overflow-y-auto">
          {aliases.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {aliases.map((a) => (
                <div key={a.id} className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-lg px-2 py-0.5">
                  <span className="text-xs text-gray-700 font-mono">{a.alias}</span>
                  <button
                    onClick={() => removeAlias(a.id)}
                    disabled={busy}
                    className="text-gray-300 hover:text-red-500 text-sm leading-none ml-0.5 disabled:opacity-50"
                  >×</button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-400 mb-3">No aliases yet — add the PUBG in-game name(s) below.</p>
          )}

          <div className="flex gap-2">
            <input
              autoFocus
              value={newAlias}
              onChange={(e) => setNewAlias(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addAlias() }}
              placeholder="e.g. DNS_Caydel, caydel-"
              disabled={busy}
              className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 disabled:opacity-60"
            />
            <button
              onClick={addAlias}
              disabled={busy || !newAlias.trim()}
              className="px-3 py-1.5 text-sm bg-yellow-400 hover:bg-yellow-300 disabled:opacity-50 text-gray-900 font-semibold rounded-lg"
            >
              {busy ? '...' : 'Add'}
            </button>
          </div>
          {err && <p className="text-xs text-red-500 mt-2">{err}</p>}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 flex justify-end">
          <button onClick={onClose} className="px-4 py-1.5 text-sm text-gray-600 hover:text-gray-800">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
