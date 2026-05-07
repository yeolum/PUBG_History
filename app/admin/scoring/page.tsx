'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

type RuleType = 'super' | 'super_v1' | 'chicken' | 'chicken_v2'

interface ScoringRule {
  id: string
  name: string
  type: RuleType
  placement_pts: number[]
  kill_pts: number
  description: string | null
  created_at: string
}

const DEFAULT_PLACEMENT = [10, 6, 5, 4, 3, 2, 1, 1]

const RULE_TYPE_LABELS: Record<RuleType, string> = {
  super: 'SUPER v2',
  super_v1: 'SUPER v1',
  chicken: 'Chicken',
  chicken_v2: 'Chicken v2',
}

const RULE_TYPE_DESCS: Record<RuleType, string> = {
  super: '순위점수 + 킬점수 합산, 동점 시 순위점수 우선',
  super_v1: '킬점수 + 순위점수 합산, 동점 시 킬점수 우선',
  chicken: '치킨 먹은 횟수 우선, 동수이면 아래 순위점수 기준으로 정렬',
  chicken_v2: '치킨 먹은 횟수 우선 → 동수이면 총 킬점수 → 마지막 매치 킬수 → 마지막 매치 생존순위',
}

function PlacementPtsDisplay({ pts }: { pts: number[] }) {
  return (
    <div className="flex gap-1 flex-wrap">
      {pts.map((v, i) => (
        <span key={i} className="inline-flex items-center gap-0.5">
          <span className="text-[10px] text-gray-400">{i + 1}위</span>
          <span className="font-semibold text-gray-800">{v}</span>
          {i < pts.length - 1 && <span className="text-gray-300 ml-0.5">·</span>}
        </span>
      ))}
    </div>
  )
}

export default function ScoringPage() {
  const supabase = createClient()
  const [rules, setRules] = useState<ScoringRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  // Form state
  const [formName, setFormName] = useState('')
  const [formType, setFormType] = useState<RuleType>('super')
  const [formPts, setFormPts] = useState<string[]>(DEFAULT_PLACEMENT.map(String))
  const [formKillPts, setFormKillPts] = useState('1')
  const [formDesc, setFormDesc] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('scoring_rules')
      .select('*')
      .order('created_at', { ascending: true })
    if (error) setError(error.message)
    else setRules((data ?? []) as ScoringRule[])
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  function resetForm() {
    setFormName('')
    setFormType('super')
    setFormPts(DEFAULT_PLACEMENT.map(String))
    setFormKillPts('1')
    setFormDesc('')
  }

  async function handleSave() {
    if (!formName.trim()) return
    const pts = formPts.map((v) => parseInt(v) || 0)
    setSaving(true)
    const { error } = await supabase.from('scoring_rules').insert({
      name: formName.trim(),
      type: formType,
      placement_pts: pts,
      kill_pts: parseFloat(formKillPts) || 0,
      description: formDesc.trim() || null,
    })
    setSaving(false)
    if (error) { alert(error.message); return }
    setAddOpen(false)
    resetForm()
    load()
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`"${name}" 룰을 삭제하시겠습니까?`)) return
    const { error } = await supabase.from('scoring_rules').delete().eq('id', id)
    if (error) { alert(error.message); return }
    load()
  }

  const inputCls = 'border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-yellow-400'

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">포인트제도 관리</h1>
          <p className="text-xs text-gray-400 mt-0.5">대회 스코어보드에 적용할 포인트 룰을 관리합니다</p>
        </div>
        <button
          onClick={() => { setAddOpen(true); resetForm() }}
          className="bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold text-sm px-4 py-2 rounded-lg"
        >
          + 룰 추가
        </button>
      </div>

      {/* 룰 설명 박스 */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        {(Object.keys(RULE_TYPE_LABELS) as RuleType[]).map((t) => (
          <div key={t} className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${t === 'chicken' || t === 'chicken_v2' ? 'bg-blue-100 text-blue-700' : 'bg-yellow-100 text-yellow-700'}`}>
                {RULE_TYPE_LABELS[t]}
              </span>
            </div>
            <p className="text-xs text-gray-500">{RULE_TYPE_DESCS[t]}</p>
          </div>
        ))}
      </div>

      {/* 룰 추가 폼 */}
      {addOpen && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-5 mb-5">
          <p className="text-xs font-semibold text-gray-700 mb-4">새 룰 추가</p>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">룰 이름 *</label>
              <input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="예: SUPER, PGC 2024"
                className={inputCls + ' w-full'}
              />
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">룰 타입 *</label>
              <select
                value={formType}
                onChange={(e) => setFormType(e.target.value as RuleType)}
                className={inputCls + ' w-full'}
              >
                <option value="super">SUPER v2 (동점 시 순위점수 우선)</option>
                <option value="super_v1">SUPER v1 (동점 시 킬점수 우선)</option>
                <option value="chicken">Chicken (치킨 우선)</option>
                <option value="chicken_v2">Chicken v2 (치킨→킬점수→마지막매치킬→생존순위)</option>
              </select>
            </div>
          </div>
          <div className="mb-3">
            <label className="block text-[11px] text-gray-500 mb-1.5">
              순위별 점수 (1위~{formPts.length}위)
              {formType === 'chicken' && <span className="text-blue-500 ml-1">— 치킨 미획득 팀의 정렬 기준</span>}
            </label>
            <div className="flex gap-1.5 flex-wrap">
              {formPts.map((v, i) => (
                <div key={i} className="flex flex-col items-center gap-0.5">
                  <span className="text-[10px] text-gray-400">{i + 1}위</span>
                  <input
                    type="number"
                    min="0"
                    value={v}
                    onChange={(e) => {
                      const next = [...formPts]
                      next[i] = e.target.value
                      setFormPts(next)
                    }}
                    className="border border-gray-300 rounded px-1.5 py-1 text-xs text-center focus:outline-none focus:ring-1 focus:ring-yellow-400 w-12"
                  />
                </div>
              ))}
              <div className="flex flex-col items-center gap-0.5 ml-2">
                <span className="text-[10px] text-transparent">-</span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setFormPts((p) => [...p, '0'])}
                    className="text-xs border border-dashed border-gray-300 hover:border-yellow-400 text-gray-400 hover:text-yellow-600 px-1.5 py-1 rounded"
                  >+</button>
                  {formPts.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setFormPts((p) => p.slice(0, -1))}
                      className="text-xs border border-dashed border-gray-300 hover:border-red-300 text-gray-400 hover:text-red-500 px-1.5 py-1 rounded"
                    >−</button>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">킬 점수 (킬 1개당)</label>
              <input
                type="number"
                min="0"
                step="0.5"
                value={formKillPts}
                onChange={(e) => setFormKillPts(e.target.value)}
                className={inputCls + ' w-24'}
              />
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">설명 (선택)</label>
              <input
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
                placeholder="룰 설명..."
                className={inputCls + ' w-full'}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving || !formName.trim()}
              className="text-xs bg-yellow-400 hover:bg-yellow-300 disabled:opacity-40 text-gray-900 font-semibold px-4 py-1.5 rounded"
            >
              {saving ? '저장 중...' : '저장'}
            </button>
            <button
              onClick={() => { setAddOpen(false); resetForm() }}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {/* 룰 목록 */}
      {loading ? (
        <p className="text-gray-400 text-sm">Loading...</p>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-600">
          <p className="font-semibold mb-1">테이블 오류</p>
          <p className="text-xs">{error}</p>
          <p className="text-xs mt-2 text-red-400">
            Supabase에서 <code className="bg-red-100 px-1 rounded">scoring_rules</code> 테이블을 생성해야 합니다.
          </p>
          <pre className="mt-2 bg-red-100 rounded p-2 text-[10px] overflow-x-auto">{`CREATE TABLE scoring_rules (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('super', 'super_v1', 'chicken')),
  placement_pts integer[] NOT NULL DEFAULT '{10,6,5,4,3,2,1,1}',
  kill_pts numeric NOT NULL DEFAULT 1,
  description text,
  created_at timestamptz DEFAULT now()
);`}</pre>
        </div>
      ) : rules.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-gray-400 text-sm">
          등록된 포인트 룰이 없습니다. 룰을 추가해보세요.
        </div>
      ) : (
        <div className="space-y-3">
          {rules.map((rule) => (
            <div key={rule.id} className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-semibold text-gray-900 text-sm">{rule.name}</span>
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${rule.type === 'chicken' || rule.type === 'chicken_v2' ? 'bg-blue-100 text-blue-700' : 'bg-yellow-100 text-yellow-700'}`}>
                      {RULE_TYPE_LABELS[rule.type]}
                    </span>
                  </div>
                  <div className="mb-2">
                    <PlacementPtsDisplay pts={rule.placement_pts} />
                  </div>
                  <div className="flex items-center gap-4 text-xs text-gray-500">
                    <span>킬 점수: <span className="font-semibold text-gray-700">{rule.kill_pts}pt</span></span>
                    {rule.description && <span className="text-gray-400">{rule.description}</span>}
                  </div>
                  {rule.type === 'chicken' && (
                    <p className="text-[11px] text-blue-500 mt-1.5">
                      치킨 먹은 팀을 치킨 획득 매치 수 기준으로 상위 배치 → 미획득 팀은 위 순위점수 기준 정렬
                    </p>
                  )}
                  {rule.type === 'chicken_v2' && (
                    <p className="text-[11px] text-blue-500 mt-1.5">
                      치킨 횟수 → 총 킬점수 → 마지막 매치 킬수 → 마지막 매치 생존순위
                    </p>
                  )}
                </div>
                <button
                  onClick={() => handleDelete(rule.id, rule.name)}
                  className="text-gray-300 hover:text-red-500 text-lg leading-none shrink-0 transition-colors"
                  title="삭제"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
