'use client'

import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Props {
  currentUrl: string | null
  storagePath: string          // e.g. "teams/uuid/logo"
  onUpdate: (url: string | null) => void
  shape?: 'square' | 'wide'   // square=팀/선수, wide=대회 배너
  size?: 'sm' | 'lg'          // sm=리스트 행, lg=상세 페이지
  label?: string
}

const BUCKET = 'images'

export default function ImageUpload({ currentUrl, storagePath, onUpdate, shape = 'square', size = 'sm', label }: Props) {
  const supabase = createClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentUrl)

  async function handleFile(file: File) {
    if (!file.type.startsWith('image/')) return
    setUploading(true)

    const ext = file.name.split('.').pop() ?? 'jpg'
    const path = `${storagePath}.${ext}`

    // 기존 파일 덮어쓰기 (upsert)
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
      upsert: true,
      contentType: file.type,
    })

    if (error) {
      alert('업로드 실패: ' + error.message)
      setUploading(false)
      return
    }

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
    // 캐시 버스팅: 쿼리스트링 추가
    const publicUrl = data.publicUrl + '?t=' + Date.now()
    setPreviewUrl(publicUrl)
    onUpdate(publicUrl)
    setUploading(false)
  }

  async function handleRemove(e: React.MouseEvent) {
    e.stopPropagation()
    setPreviewUrl(null)
    onUpdate(null)
  }

  // ── 큰 업로드 영역 (대회 배너) ──
  if (size === 'lg') {
    return (
      <div className="space-y-2">
        {label && <p className="text-xs text-gray-500">{label}</p>}
        <div
          onClick={() => !uploading && inputRef.current?.click()}
          className={`relative border-2 rounded-xl overflow-hidden cursor-pointer hover:border-yellow-400 transition-colors
            ${shape === 'wide' ? 'aspect-[3/1]' : 'aspect-square max-w-[180px]'}
            ${previewUrl ? 'border-gray-200' : 'border-dashed border-gray-300'}`}
        >
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="uploaded" className="w-full h-full object-cover" />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 bg-gray-50">
              <span className="text-2xl mb-1">+</span>
              <span className="text-xs">{uploading ? '업로드 중...' : '클릭하여 업로드'}</span>
            </div>
          )}
          {uploading && (
            <div className="absolute inset-0 bg-white/70 flex items-center justify-center text-xs text-gray-500">
              업로드 중...
            </div>
          )}
          {previewUrl && !uploading && (
            <div className="absolute inset-0 bg-black/0 hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 hover:opacity-100">
              <span className="text-white text-xs font-medium bg-black/50 px-2 py-1 rounded">변경</span>
            </div>
          )}
        </div>
        {previewUrl && (
          <button onClick={handleRemove} className="text-xs text-red-400 hover:text-red-600">
            이미지 제거
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
        />
      </div>
    )
  }

  // ── 소형 썸네일 (팀/선수 리스트 행) ──
  return (
    <div className="relative group">
      <button
        type="button"
        onClick={() => !uploading && inputRef.current?.click()}
        title="클릭하여 이미지 변경"
        className={`block rounded-lg overflow-hidden border border-gray-200 bg-gray-50 shrink-0
          ${shape === 'wide' ? 'w-16 h-10' : 'w-10 h-10'}`}
      >
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="logo" className="w-full h-full object-cover" />
        ) : (
          <span className="flex items-center justify-center w-full h-full text-gray-300 text-xs">
            {uploading ? '...' : '+'}
          </span>
        )}
      </button>

      {previewUrl && !uploading && (
        <button
          type="button"
          onClick={handleRemove}
          className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-[10px] leading-none
            hidden group-hover:flex items-center justify-center"
        >
          ×
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
      />
    </div>
  )
}
