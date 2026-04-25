'use client'

import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Props {
  currentUrl: string | null
  storagePath: string
  onUpdate: (url: string | null) => void
  shape?: 'square' | 'wide'
  size?: 'sm' | 'lg'
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

    const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
      upsert: true,
      contentType: file.type,
    })

    if (error) {
      alert('Upload failed: ' + error.message)
      setUploading(false)
      return
    }

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
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
              <span className="text-xs">{uploading ? 'Uploading...' : 'Click to upload'}</span>
            </div>
          )}
          {uploading && (
            <div className="absolute inset-0 bg-white/70 flex items-center justify-center text-xs text-gray-500">
              Uploading...
            </div>
          )}
          {previewUrl && !uploading && (
            <div className="absolute inset-0 bg-black/0 hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 hover:opacity-100">
              <span className="text-white text-xs font-medium bg-black/50 px-2 py-1 rounded">Change</span>
            </div>
          )}
        </div>
        {previewUrl && (
          <button onClick={handleRemove} className="text-xs text-red-400 hover:text-red-600">
            Remove image
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

  return (
    <div className="relative group">
      <button
        type="button"
        onClick={() => !uploading && inputRef.current?.click()}
        title="Click to change image"
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
