'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { MAP_NAMES } from '@/lib/pubg-api'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''

const ALL_MAPS = Object.entries(MAP_NAMES).map(([key, displayName]) => ({ key, displayName }))

function mapImageUrl(mapKey: string, bust?: number) {
  const base = `${SUPABASE_URL}/storage/v1/object/public/map-images/${mapKey}.jpg`
  return bust ? `${base}?t=${bust}` : base
}

export default function AdminMapsPage() {
  const supabase = createClient()
  const [uploading, setUploading] = useState<string | null>(null)
  const [busts, setBusts] = useState<Record<string, number>>({})
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({})
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})

  async function handleUpload(mapKey: string, file: File) {
    setUploading(mapKey)
    const { error } = await supabase.storage
      .from('map-images')
      .upload(`${mapKey}.jpg`, file, { upsert: true, contentType: file.type })
    setUploading(null)
    if (error) { alert('업로드 실패: ' + error.message); return }
    setBusts((prev) => ({ ...prev, [mapKey]: Date.now() }))
    setImgErrors((prev) => ({ ...prev, [mapKey]: false }))
  }

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center gap-2 text-sm text-gray-400 mb-6">
        <Link href="/admin" className="hover:text-gray-600">Admin</Link>
        <span>/</span>
        <span className="text-gray-700">맵 이미지</span>
      </div>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">PUBG 맵 이미지 관리</h1>
          <p className="text-sm text-gray-400">업로드된 이미지는 전체 대회의 낙하 지점 맵에서 공통으로 사용됩니다.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {ALL_MAPS.map(({ key, displayName }) => {
          const isUploading = uploading === key
          const hasError = imgErrors[key]
          const bust = busts[key]
          return (
            <div key={key} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              {/* Map preview */}
              <div className="relative bg-gray-100" style={{ aspectRatio: '1' }}>
                {!hasError && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={mapImageUrl(key, bust)}
                    alt={displayName}
                    className="absolute inset-0 w-full h-full object-cover"
                    onError={() => setImgErrors((prev) => ({ ...prev, [key]: true }))}
                  />
                )}
                <div
                  className="absolute inset-0 opacity-10"
                  style={{
                    backgroundImage: 'linear-gradient(#aaa 1px, transparent 1px), linear-gradient(90deg, #aaa 1px, transparent 1px)',
                    backgroundSize: '10% 10%',
                  }}
                />
                {hasError && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <p className="text-gray-400 text-xs bg-white/80 px-3 py-1.5 rounded-lg">이미지 없음</p>
                  </div>
                )}
              </div>

              {/* Info + upload */}
              <div className="p-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{displayName}</p>
                  <p className="text-[11px] text-gray-400 font-mono">{key}</p>
                </div>
                <input
                  ref={(el) => { fileRefs.current[key] = el }}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(key, f) }}
                />
                <button
                  onClick={() => fileRefs.current[key]?.click()}
                  disabled={isUploading}
                  className="shrink-0 px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  {isUploading ? '업로드 중...' : '이미지 업로드'}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
