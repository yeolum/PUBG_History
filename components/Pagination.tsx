'use client'

interface Props {
  total: number
  page: number
  pageSize: number
  onPageChange: (p: number) => void
  onPageSizeChange: (s: number) => void
}

const PAGE_SIZES = [10, 25, 50]

export default function Pagination({ total, page, pageSize, onPageChange, onPageSizeChange }: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, total)

  const lo = Math.max(1, Math.min(page - 2, totalPages - 4))
  const hi = Math.min(totalPages, lo + 4)
  const pages: number[] = []
  for (let i = lo; i <= hi; i++) pages.push(i)

  const btn = (active: boolean, disabled?: boolean) =>
    `min-w-[28px] h-7 px-1.5 rounded border text-xs transition-colors ${
      active ? 'bg-yellow-400 border-yellow-400 text-gray-900 font-medium' :
      disabled ? 'border-gray-200 text-gray-300 cursor-default pointer-events-none' :
      'border-gray-200 text-gray-600 hover:border-gray-400'
    }`

  return (
    <div className="flex items-center justify-between mt-4 flex-wrap gap-2">
      <div className="flex items-center gap-1.5 text-xs text-gray-500">
        <span>Show</span>
        {PAGE_SIZES.map(s => (
          <button key={s} onClick={() => { onPageSizeChange(s); onPageChange(1) }} className={btn(s === pageSize)}>
            {s}
          </button>
        ))}
        {total > 0 && <span className="text-gray-400 ml-1">{start}–{end} / {total}</span>}
      </div>
      {totalPages > 1 && (
        <div className="flex items-center gap-0.5 text-xs">
          <button onClick={() => onPageChange(1)} disabled={page === 1} className={btn(false, page === 1)}>«</button>
          <button onClick={() => onPageChange(page - 1)} disabled={page === 1} className={btn(false, page === 1)}>‹</button>
          {pages.map(p => (
            <button key={p} onClick={() => onPageChange(p)} className={btn(p === page)}>{p}</button>
          ))}
          <button onClick={() => onPageChange(page + 1)} disabled={page === totalPages} className={btn(false, page === totalPages)}>›</button>
          <button onClick={() => onPageChange(totalPages)} disabled={page === totalPages} className={btn(false, page === totalPages)}>»</button>
        </div>
      )}
    </div>
  )
}
