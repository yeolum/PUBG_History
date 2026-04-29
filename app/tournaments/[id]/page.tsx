import { createPublicClient } from '@/lib/supabase/server'
import Header from '@/components/Header'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Tournament } from '@/lib/types'
import type { Metadata } from 'next'
import { Suspense } from 'react'
import TournamentContent from './TournamentContent'

export const revalidate = 30

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const supabase = createPublicClient()
  const { data } = await supabase.from('tournaments').select('name').eq('id', id).single()
  return { title: data?.name ?? 'Tournament' }
}

const STATUS_LABEL: Record<string, string> = { upcoming: 'Upcoming', ongoing: 'Ongoing', completed: 'Completed' }

function ContentSpinner() {
  return (
    <div className="flex items-center justify-center py-24">
      <div className="w-10 h-10 rounded-full border-[3px] border-yellow-400 border-t-transparent animate-spin" />
    </div>
  )
}

export default async function TournamentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createPublicClient()

  const { data: tournament } = await supabase.from('tournaments').select('*').eq('id', id).single()
  if (!tournament) notFound()
  const t = tournament as Tournament

  return (
    <>
      <Header />
      <main className="max-w-5xl mx-auto px-4 py-10 w-full">
        {/* Tournament header — renders immediately */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <Link href="/tournaments" className="text-sm text-gray-400 hover:text-gray-600">← Tournaments</Link>
          </div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold text-gray-900">{t.name}</h1>
            {t.short_name && (
              <span className="text-xs font-mono bg-gray-100 px-2 py-0.5 rounded text-gray-500">{t.short_name}</span>
            )}
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              t.status === 'ongoing' ? 'bg-green-100 text-green-700' :
              t.status === 'upcoming' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
            }`}>{STATUS_LABEL[t.status]}</span>
          </div>
          {t.region && <p className="text-sm text-gray-500">{t.region}</p>}
          {(t.start_date || t.end_date) && (
            <p className="text-sm text-gray-400 mt-0.5">{t.start_date ?? '?'} ~ {t.end_date ?? '?'}</p>
          )}
          {t.prize_pool && <p className="text-base font-semibold text-yellow-600 mt-0.5">{t.prize_pool}</p>}
          {t.description && <p className="text-sm text-gray-600 mt-1">{t.description}</p>}
        </div>

        {/* Roster + tabs — streamed after heavy data loads */}
        <Suspense fallback={<ContentSpinner />}>
          <TournamentContent id={id} tournament={t} />
        </Suspense>
      </main>
    </>
  )
}
