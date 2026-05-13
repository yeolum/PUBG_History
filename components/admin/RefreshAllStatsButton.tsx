'use client'

import { useState } from 'react'

export default function RefreshAllStatsButton({ tournamentIds }: { tournamentIds: string[] }) {
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [progress, setProgress] = useState(0)
  const [failCount, setFailCount] = useState(0)

  async function handleClick() {
    if (state === 'running') return
    setState('running')
    setProgress(0)
    setFailCount(0)

    let failed = 0
    for (let i = 0; i < tournamentIds.length; i++) {
      try {
        const res = await fetch('/api/admin/compute-tournament-stats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tournamentId: tournamentIds[i] }),
        })
        if (!res.ok) failed++
      } catch {
        failed++
      }
      setProgress(i + 1)
    }

    setFailCount(failed)
    setState(failed > 0 ? 'error' : 'done')
    setTimeout(() => setState('idle'), 4000)
  }

  const label =
    state === 'running'
      ? `${progress}/${tournamentIds.length} 완료...`
      : state === 'done'
      ? '갱신 완료!'
      : state === 'error'
      ? `오류 ${failCount}건 발생`
      : '전체 통계 새로고침'

  return (
    <button
      onClick={handleClick}
      disabled={state === 'running'}
      className="bg-white hover:bg-gray-50 disabled:opacity-60 text-gray-700 font-semibold text-sm px-4 py-2 rounded-lg border border-gray-300 transition-colors"
    >
      {label}
    </button>
  )
}
