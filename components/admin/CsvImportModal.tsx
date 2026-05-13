'use client'

import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

type ImportType = 'teams' | 'players'

interface TeamRow { name: string; short_name: string; nationality: string; description: string }
interface PlayerRow { nickname: string; real_name: string; nationality: string; birth_date: string; team_name: string }
type ParsedRow = TeamRow | PlayerRow

interface ResultRow { index: number; input: string; status: 'ok' | 'skip' | 'error'; message?: string }

const TEAM_HEADERS = ['name', 'short_name', 'nationality', 'description']
const PLAYER_HEADERS = ['nickname', 'real_name', 'nationality', 'birth_date', 'team_name']

const TEAM_EXAMPLE = `name,short_name,nationality,description
Gen.G Esports,GEN,Korea,
PUBG Mobile Team,PMT,USA,`

const PLAYER_EXAMPLE = `nickname,real_name,nationality,birth_date,team_name
Heaven,Kim Minjun,Korea,2000-01-01,Gen.G Esports
Pio,Lee Jungwoo,Korea,,`

function parseCsv(text: string): string[][] {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map((line) =>
      line.split(',').map((cell) => cell.trim().replace(/^"|"$/g, ''))
    )
}

function parseTeamRows(rows: string[][]): TeamRow[] {
  return rows.map(([name = '', short_name = '', nationality = '', description = '']) => ({
    name: name.trim(),
    short_name: short_name.trim(),
    nationality: nationality.trim(),
    description: description.trim(),
  }))
}

function parsePlayerRows(rows: string[][]): PlayerRow[] {
  return rows.map(([nickname = '', real_name = '', nationality = '', birth_date = '', team_name = '']) => ({
    nickname: nickname.trim(),
    real_name: real_name.trim(),
    nationality: nationality.trim(),
    birth_date: birth_date.trim(),
    team_name: team_name.trim(),
  }))
}

interface Props {
  type: ImportType
  onDone: () => void
  onClose: () => void
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAllPaged(query: any): Promise<any[]> {
  const PAGE = 1000
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any[] = []
  let page = 0
  while (true) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: batch } = await (query as any).order('id').range(page * PAGE, (page + 1) * PAGE - 1)
    if (!batch || batch.length === 0) break
    rows.push(...batch)
    if (batch.length < PAGE) break
    page++
  }
  return rows
}

export default function CsvImportModal({ type, onDone, onClose }: Props) {
  const supabase = createClient()
  const fileRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<'upload' | 'preview' | 'done'>('upload')
  const [parsed, setParsed] = useState<ParsedRow[]>([])
  const [results, setResults] = useState<ResultRow[]>([])
  const [importing, setImporting] = useState(false)
  const [parseError, setParseError] = useState('')

  function handleFile(file: File) {
    setParseError('')
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = (e.target?.result as string) ?? ''
      const rows = parseCsv(text)
      if (rows.length < 2) { setParseError('File must have at least a header row and one data row'); return }

      const header = rows[0].map((h) => h.toLowerCase())
      const required = type === 'teams' ? TEAM_HEADERS[0] : PLAYER_HEADERS[0]
      if (!header.includes(required)) {
        setParseError(`Header is missing "${required}" column. Check the example format.`)
        return
      }

      const dataRows = rows.slice(1)
      const p = type === 'teams' ? parseTeamRows(dataRows) : parsePlayerRows(dataRows)
      setParsed(p)
      setStep('preview')
    }
    reader.readAsText(file, 'UTF-8')
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  async function runImport() {
    setImporting(true)
    const res: ResultRow[] = []

    if (type === 'teams') {
      for (let i = 0; i < parsed.length; i++) {
        const row = parsed[i] as TeamRow
        if (!row.name) { res.push({ index: i, input: '(empty name)', status: 'skip', message: 'Name required' }); continue }
        const { error } = await supabase.from('teams').insert([{
          name: row.name,
          short_name: row.short_name || null,
          nationality: row.nationality || null,
          description: row.description || null,
        }])
        if (error) {
          res.push({ index: i, input: row.name, status: 'error', message: error.message })
        } else {
          res.push({ index: i, input: row.name, status: 'ok' })
        }
      }
    } else {
      const [teamRows, aliasRows] = await Promise.all([
        fetchAllPaged(supabase.from('teams').select('id, name')),
        fetchAllPaged(supabase.from('team_aliases').select('alias, team_id')),
      ])
      const teamMap: Record<string, string> = {}
      for (const t of teamRows ?? []) teamMap[t.name.toLowerCase()] = t.id
      for (const a of aliasRows ?? []) teamMap[a.alias.toLowerCase()] = a.team_id

      for (let i = 0; i < parsed.length; i++) {
        const row = parsed[i] as PlayerRow
        if (!row.nickname) { res.push({ index: i, input: '(empty nickname)', status: 'skip', message: 'Nickname required' }); continue }

        const teamId = row.team_name ? teamMap[row.team_name.toLowerCase()] ?? null : null
        if (row.team_name && !teamId) {
          res.push({
            index: i, input: row.nickname, status: 'error',
            message: `Team "${row.team_name}" not found`,
          })
          continue
        }

        const { error } = await supabase.from('players').insert([{
          nickname: row.nickname,
          real_name: row.real_name || null,
          nationality: row.nationality || null,
          birth_date: row.birth_date || null,
          team_id: teamId,
        }])
        if (error) {
          res.push({ index: i, input: row.nickname, status: 'error', message: error.message })
        } else {
          res.push({ index: i, input: row.nickname, status: 'ok' })
        }
      }
    }

    setResults(res)
    setImporting(false)
    setStep('done')
    onDone()
  }

  const okCount = results.filter((r) => r.status === 'ok').length
  const errCount = results.filter((r) => r.status === 'error').length

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">
            CSV Import — {type === 'teams' ? 'Teams' : 'Players'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {step === 'upload' && (
            <div className="space-y-5">
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">CSV Format Example</p>
                <pre className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-xs text-gray-700 font-mono whitespace-pre overflow-x-auto">
                  {type === 'teams' ? TEAM_EXAMPLE : PLAYER_EXAMPLE}
                </pre>
                <p className="text-xs text-gray-400 mt-1.5">
                  {type === 'players' ? '• team_name must match an already-registered team name or alias' : '• The first column "name" is required'}
                </p>
              </div>

              <div
                onDrop={onDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => fileRef.current?.click()}
                className="border-2 border-dashed border-gray-300 rounded-xl p-10 text-center cursor-pointer hover:border-yellow-400 hover:bg-yellow-50 transition-colors"
              >
                <p className="text-sm text-gray-500">Drag & drop a CSV file or click to select</p>
                <p className="text-xs text-gray-400 mt-1">UTF-8 encoded .csv file</p>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
                />
              </div>

              {parseError && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">{parseError}</p>
              )}
            </div>
          )}

          {step === 'preview' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                <span className="font-semibold">{parsed.length} rows</span> parsed — review and confirm import.
              </p>
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      {(type === 'teams' ? TEAM_HEADERS : PLAYER_HEADERS).map((h) => (
                        <th key={h} className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {parsed.slice(0, 50).map((row, i) => (
                      <tr key={i} className={i % 2 === 0 ? '' : 'bg-gray-50'}>
                        {Object.values(row).map((v, j) => (
                          <td key={j} className="px-3 py-2 text-gray-700 max-w-[160px] truncate">{v || <span className="text-gray-300">-</span>}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsed.length > 50 && (
                  <p className="text-xs text-gray-400 text-center py-2 border-t border-gray-100">
                    ... and {parsed.length - 50} more rows (all will be imported)
                  </p>
                )}
              </div>
            </div>
          )}

          {step === 'done' && (
            <div className="space-y-4">
              <div className="flex gap-4">
                <div className="flex-1 bg-green-50 border border-green-200 rounded-xl p-4 text-center">
                  <p className="text-2xl font-bold text-green-700">{okCount}</p>
                  <p className="text-xs text-green-600 mt-0.5">Succeeded</p>
                </div>
                <div className="flex-1 bg-red-50 border border-red-200 rounded-xl p-4 text-center">
                  <p className="text-2xl font-bold text-red-600">{errCount}</p>
                  <p className="text-xs text-red-500 mt-0.5">Failed</p>
                </div>
              </div>

              {errCount > 0 && (
                <div className="border border-red-200 rounded-xl overflow-hidden">
                  <p className="text-xs font-semibold text-red-600 px-4 py-2 bg-red-50 border-b border-red-200">Failed Rows</p>
                  {results.filter((r) => r.status !== 'ok').map((r) => (
                    <div key={r.index} className="px-4 py-2 border-b border-red-100 last:border-0 text-xs">
                      <span className="font-medium text-gray-700">{r.input}</span>
                      <span className="ml-2 text-red-500">{r.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
          {step === 'preview' && (
            <>
              <button onClick={() => setStep('upload')} className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2">
                Re-select
              </button>
              <button
                onClick={runImport}
                disabled={importing}
                className="bg-yellow-400 hover:bg-yellow-300 disabled:opacity-50 text-gray-900 font-semibold text-sm px-5 py-2 rounded-lg"
              >
                {importing ? 'Importing...' : `Import ${parsed.length} rows`}
              </button>
            </>
          )}
          {(step === 'upload' || step === 'done') && (
            <button onClick={onClose} className="bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium px-5 py-2 rounded-lg">
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
