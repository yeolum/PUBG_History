import Header from '@/components/Header'
import Link from 'next/link'

function Shimmer({ className }: { className: string }) {
  return <div className={`bg-gray-200 rounded animate-pulse ${className}`} />
}

export default function TournamentDetailLoading() {
  return (
    <>
      <Header />
      <main className="max-w-5xl mx-auto px-4 py-10 w-full">
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <Link href="/tournaments" className="text-sm text-gray-400 hover:text-gray-600">← Tournaments</Link>
          </div>
          <div className="flex items-center gap-3 mb-2">
            <Shimmer className="h-8 w-56" />
            <Shimmer className="h-5 w-16" />
            <Shimmer className="h-5 w-20" />
          </div>
          <Shimmer className="h-4 w-28 mb-1" />
          <Shimmer className="h-4 w-44 mb-1" />
          <Shimmer className="h-5 w-32" />
        </div>

        <div className="flex items-center justify-center py-24">
          <div className="w-10 h-10 rounded-full border-[3px] border-yellow-400 border-t-transparent animate-spin" />
        </div>
      </main>
    </>
  )
}
