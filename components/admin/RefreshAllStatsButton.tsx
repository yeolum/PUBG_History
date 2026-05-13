'use client'

import { useState } from 'react'

export default function RefreshAllStatsButton({ tournamentIds, tournamentNames }: {
  tournamentIds: string[]
  tournamentNames: Record<string, string>
}) {
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [progress, setProgress] = useState(0)
  const [failedIds, setFailedIds] = useState<string[]>([])

  async function handleClick() {
    if (state === 'running') return
    setState('running')
    setProgress(0)
    setFailedIds([])

    const failed: string[] = []
    for (let i = 0; i < tournamentIds.length; i++) {
      try {
        const res = await fetch('/api/admin/compute-tournament-stats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tournamentId: tournamentIds[i] }),
        })
        if (!res.ok) failed.push(tournamentIds[i])
      } catch {
        failed.push(tournamentIds[i])
      }
      setProgress(i + 1)
    }

    setFailedIds(failed)
    setState(failed.length > 0 ? 'error' : 'done')
  }

  const label =
    state === 'running'
      ? `${progress}/${tournamentIds.length} 처리 중...`
      : state === 'done'
      ? `갱신 완료 (${tournamentIds.length}건) — 다시 실행`
      : state === 'error'
      ? `완료 (오류 ${failedIds.length}건) — 다시 실행`
      : `전체 통계 새로고침 (${tournamentIds.length}건)`

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleClick}
        disabled={state === 'running'}
        className={`disabled:opacity-60 font-semibold text-sm px-4 py-2 rounded-lg border transition-colors ${
          state === 'error'
            ? 'bg-red-50 hover:bg-red-100 text-red-700 border-red-300'
            : state === 'done'
            ? 'bg-green-50 hover:bg-green-100 text-green-700 border-green-300'
            : 'bg-white hover:bg-gray-50 text-gray-700 border-gray-300'
        }`}
      >
        {label}
      </button>
      {state === 'error' && failedIds.length > 0 && (
        <div className="text-xs text-red-600 text-right max-w-xs">
          {failedIds.map((id) => (
            <div key={id}>{tournamentNames[id] ?? id}</div>
          ))}
        </div>
      )}
    </div>
  )
}
