'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { Tournament, Series, Stage, Match, TournamentStatus, TournamentType } from '@/lib/types'
import ImageUpload from '@/components/admin/ImageUpload'

const INPUT_CLS = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400'

export default function AdminTournamentDetailPage() {
  const { id } = useParams() as { id: string }
  const router = useRouter()
  const supabase = createClient()

  const [tournament, setTournament] = useState<Tournament | null>(null)
  const [seriesList, setSeriesList] = useState<(Series & { stages: (Stage & { matches: Match[] })[] })[]>([])
  const [editMode, setEditMode] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<Partial<Tournament>>({})
  const [err, setErr] = useState('')

  const [newSeriesName, setNewSeriesName] = useState('')
  const [seriesAdding, setSeriesAdding] = useState(false)
  const [addingStage, setAddingStage] = useState<string | null>(null)
  const [newStageName, setNewStageName] = useState('')
  const [newStageType, setNewStageType] = useState('group')

  const load = useCallback(async () => {
    const [{ data: t }, { data: s }] = await Promise.all([
      supabase.from('tournaments').select('*').eq('id', id).single(),
      supabase
        .from('series')
        .select('*, stages(*, matches(*))')
        .eq('tournament_id', id)
        .order('order_num'),
    ])
    if (!t) { router.push('/admin/tournaments'); return }
    setTournament(t as Tournament)
    setForm(t as Tournament)
    setSeriesList((s ?? []) as (Series & { stages: (Stage & { matches: Match[] })[] })[])
  }, [id, supabase, router])

  useEffect(() => { load() }, [load])

  async function saveTournament() {
    if (!form.name?.trim()) return
    setSaving(true)
    setErr('')
    const { error } = await supabase.from('tournaments').update({
      name: form.name,
      short_name: form.short_name || null,
      type: form.type,
      region: form.region || null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      prize_pool: form.prize_pool || null,
      status: form.status,
      description: form.description || null,
      banner_url: form.banner_url ?? null,
    }).eq('id', id)
    setSaving(false)
    if (error) { setErr('저장 실패: ' + error.message); return }
    setEditMode(false)
    load()
  }

  async function deleteTournament() {
    if (!confirm('이 대회를 삭제하시겠습니까? 모든 관련 데이터가 삭제됩니다.')) return
    await supabase.from('tournaments').delete().eq('id', id)
    router.push('/admin/tournaments')
  }

  async function addSeries() {
    if (!newSeriesName.trim()) return
    setSeriesAdding(true)
    setErr('')
    const maxOrder = seriesList.length > 0 ? Math.max(...seriesList.map((s) => s.order_num)) + 1 : 0
    const { error } = await supabase
      .from('series')
      .insert([{ tournament_id: id, name: newSeriesName.trim(), order_num: maxOrder }])
    setSeriesAdding(false)
    if (error) { setErr('시리즈 추가 실패: ' + error.message); return }
    setNewSeriesName('')
    await load()
  }

  async function deleteSeries(seriesId: string) {
    if (!confirm('이 시리즈와 모든 스테이지, 매치를 삭제하시겠습니까?')) return
    await supabase.from('series').delete().eq('id', seriesId)
    load()
  }

  async function addStage(seriesId: string) {
    if (!newStageName.trim()) return
    setErr('')
    const s = seriesList.find((x) => x.id === seriesId)
    const maxOrder = s && s.stages.length > 0 ? Math.max(...s.stages.map((st) => st.order_num)) + 1 : 0
    const { error } = await supabase.from('stages').insert([{
      series_id: seriesId,
      name: newStageName.trim(),
      type: newStageType,
      order_num: maxOrder,
    }])
    if (error) { setErr('스테이지 추가 실패: ' + error.message); return }
    setAddingStage(null)
    setNewStageName('')
    await load()
  }

  async function deleteStage(stageId: string) {
    if (!confirm('이 스테이지와 모든 매치를 삭제하시겠습니까?')) return
    await supabase.from('stages').delete().eq('id', stageId)
    load()
  }

  if (!tournament) return <div className="p-8 text-gray-400">로딩 중...</div>

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center gap-2 text-sm text-gray-400 mb-6">
        <Link href="/admin/tournaments" className="hover:text-gray-600">대회 관리</Link>
        <span>/</span>
        <span className="text-gray-700">{tournament.name}</span>
      </div>

      {err && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 flex items-center justify-between">
          {err}
          <button onClick={() => setErr('')} className="text-red-400 hover:text-red-600 ml-4">✕</button>
        </div>
      )}

      {/* 대회 정보 */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-8">
        <div className="flex items-start justify-between mb-4">
          <h1 className="text-xl font-bold text-gray-900">{tournament.name}</h1>
          <div className="flex gap-2">
            {!editMode ? (
              <>
                <button onClick={() => setEditMode(true)}
                  className="text-sm px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700">
                  수정
                </button>
                <button onClick={deleteTournament}
                  className="text-sm px-3 py-1.5 border border-red-200 rounded-lg hover:bg-red-50 text-red-600">
                  삭제
                </button>
              </>
            ) : (
              <>
                <button onClick={saveTournament} disabled={saving}
                  className="text-sm px-3 py-1.5 bg-yellow-400 hover:bg-yellow-300 rounded-lg text-gray-900 font-medium">
                  {saving ? '저장...' : '저장'}
                </button>
                <button onClick={() => { setEditMode(false); setForm(tournament) }}
                  className="text-sm px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700">
                  취소
                </button>
              </>
            )}
          </div>
        </div>

        {editMode ? (
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="text-xs text-gray-500 block mb-1">대회명</label>
              <input value={form.name ?? ''} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={INPUT_CLS} />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">약어</label>
              <input value={form.short_name ?? ''} onChange={(e) => setForm((f) => ({ ...f, short_name: e.target.value }))} className={INPUT_CLS} />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">상태</label>
              <select value={form.status ?? 'upcoming'} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as TournamentStatus }))} className={INPUT_CLS}>
                <option value="upcoming">예정</option>
                <option value="ongoing">진행중</option>
                <option value="completed">종료</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">형식</label>
              <select value={form.type ?? 'online'} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as TournamentType }))} className={INPUT_CLS}>
                <option value="online">온라인</option>
                <option value="lan">LAN</option>
                <option value="regional">지역</option>
                <option value="global">글로벌</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">지역</label>
              <input value={form.region ?? ''} onChange={(e) => setForm((f) => ({ ...f, region: e.target.value }))} className={INPUT_CLS} />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">시작일</label>
              <input type="date" value={form.start_date ?? ''} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} className={INPUT_CLS} />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">종료일</label>
              <input type="date" value={form.end_date ?? ''} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} className={INPUT_CLS} />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">상금</label>
              <input value={form.prize_pool ?? ''} onChange={(e) => setForm((f) => ({ ...f, prize_pool: e.target.value }))} className={INPUT_CLS} />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-gray-500 block mb-1">설명</label>
              <textarea value={form.description ?? ''} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2} className={INPUT_CLS} />
            </div>
            <div className="col-span-2">
              <ImageUpload
                currentUrl={form.banner_url ?? null}
                storagePath={`tournaments/${id}/banner`}
                onUpdate={(url) => setForm((f) => ({ ...f, banner_url: url ?? undefined }))}
                shape="wide"
                size="lg"
                label="대회 로고 / 배너"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {tournament.banner_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={tournament.banner_url} alt="banner" className="rounded-lg max-h-40 object-contain border border-gray-100" />
            )}
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
            {[
              ['상태', tournament.status === 'upcoming' ? '예정' : tournament.status === 'ongoing' ? '진행중' : '종료'],
              ['형식', tournament.type],
              ['지역', tournament.region ?? '-'],
              ['상금', tournament.prize_pool ?? '-'],
              ['기간', `${tournament.start_date ?? '?'} ~ ${tournament.end_date ?? '?'}`],
              ['약어', tournament.short_name ?? '-'],
            ].map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <span className="text-gray-400 w-16 shrink-0">{k}</span>
                <span className="text-gray-800">{v}</span>
              </div>
            ))}
            {tournament.description && (
              <div className="col-span-2 flex gap-2">
                <span className="text-gray-400 w-16 shrink-0">설명</span>
                <span className="text-gray-600">{tournament.description}</span>
              </div>
            )}
          </div>
          </div>
        )}
      </div>

      {/* 시리즈 목록 */}
      <div>
        <h2 className="text-lg font-semibold text-gray-800 mb-4">시리즈</h2>

        <div className="space-y-4">
          {seriesList.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-4">아직 시리즈가 없습니다. 아래에서 추가하세요.</p>
          )}

          {seriesList.map((series) => (
            <div key={series.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 bg-gray-50 border-b border-gray-200">
                <h3 className="font-semibold text-gray-800">{series.name}</h3>
                <button onClick={() => deleteSeries(series.id)}
                  className="text-xs text-red-400 hover:text-red-600">삭제</button>
              </div>

              <div className="p-4 space-y-2">
                {series.stages
                  .slice()
                  .sort((a, b) => a.order_num - b.order_num)
                  .map((stage) => (
                    <div key={stage.id} className="flex items-center justify-between border border-gray-100 rounded-lg px-4 py-2.5 hover:bg-gray-50">
                      <div>
                        <span className="text-sm font-medium text-gray-800">{stage.name}</span>
                        <span className="ml-2 text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                          {stage.type === 'group' ? '그룹' : stage.type === 'playoff' ? '플레이오프' : '파이널'}
                        </span>
                        <span className="ml-2 text-xs text-gray-400">{stage.matches.length}경기</span>
                      </div>
                      <div className="flex gap-3">
                        <Link
                          href={`/admin/tournaments/${id}/series/${series.id}/stages/${stage.id}`}
                          className="text-xs font-medium text-yellow-600 hover:text-yellow-700"
                        >
                          매치 관리 →
                        </Link>
                        <button onClick={() => deleteStage(stage.id)}
                          className="text-xs text-red-400 hover:text-red-600">삭제</button>
                      </div>
                    </div>
                  ))}

                {addingStage === series.id ? (
                  <div className="border border-dashed border-gray-300 rounded-lg p-3 flex gap-2 flex-wrap">
                    <input
                      autoFocus
                      value={newStageName}
                      onChange={(e) => setNewStageName(e.target.value)}
                      placeholder="스테이지 이름"
                      className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm min-w-0"
                      onKeyDown={(e) => { if (e.key === 'Enter') addStage(series.id) }}
                    />
                    <select value={newStageType} onChange={(e) => setNewStageType(e.target.value)}
                      className="border border-gray-300 rounded px-2 py-1 text-sm">
                      <option value="group">그룹</option>
                      <option value="playoff">플레이오프</option>
                      <option value="grand_final">파이널</option>
                    </select>
                    <button onClick={() => addStage(series.id)}
                      className="bg-yellow-400 hover:bg-yellow-300 text-gray-900 text-xs font-medium px-3 py-1 rounded">
                      추가
                    </button>
                    <button onClick={() => { setAddingStage(null); setNewStageName('') }}
                      className="text-xs text-gray-400 hover:text-gray-600 px-2">취소</button>
                  </div>
                ) : (
                  <button
                    onClick={() => { setAddingStage(series.id); setNewStageName(''); setNewStageType('group') }}
                    className="w-full border border-dashed border-gray-300 rounded-lg py-2 text-sm text-gray-400 hover:text-gray-600 hover:border-gray-400 transition-colors"
                  >
                    + 스테이지 추가
                  </button>
                )}
              </div>
            </div>
          ))}

          {/* 시리즈 추가 */}
          <div className="bg-white rounded-xl border border-dashed border-gray-300 p-4">
            <p className="text-xs text-gray-400 mb-2">새 시리즈 추가 (예: 그룹 스테이지, 플레이오프, 파이널)</p>
            <div className="flex gap-2">
              <input
                value={newSeriesName}
                onChange={(e) => setNewSeriesName(e.target.value)}
                placeholder="시리즈 이름"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                onKeyDown={(e) => { if (e.key === 'Enter') addSeries() }}
              />
              <button
                onClick={addSeries}
                disabled={seriesAdding || !newSeriesName.trim()}
                className="bg-yellow-400 hover:bg-yellow-300 disabled:opacity-50 text-gray-900 font-medium text-sm px-4 py-2 rounded-lg whitespace-nowrap"
              >
                {seriesAdding ? '추가 중...' : '+ 시리즈 추가'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
