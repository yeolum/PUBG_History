export const CURRENCIES = [
  { code: 'USD', symbol: '$' },
  { code: 'EUR', symbol: '€' },
  { code: 'KRW', symbol: '₩' },
  { code: 'GBP', symbol: '£' },
  { code: 'JPY', symbol: '¥' },
  { code: 'CNY', symbol: 'CN¥' },
  { code: 'AUD', symbol: 'A$' },
  { code: 'SGD', symbol: 'S$' },
] as const

export function currencySymbol(code: string | null | undefined): string {
  return CURRENCIES.find((c) => c.code === code)?.symbol ?? '$'
}

export function formatPrize(amount: number | string | null | undefined, currency: string | null | undefined): string {
  if (amount == null || amount === '') return '-'
  const num = typeof amount === 'string' ? Number(amount) : amount
  if (!Number.isFinite(num)) return '-'
  return `${currencySymbol(currency)}${num.toLocaleString('en-US')}`
}

export function fmtNumberInput(val: string): string {
  const n = val.replace(/[^\d]/g, '')
  if (!n) return ''
  return parseInt(n, 10).toLocaleString('en-US')
}

export function parseNumberInput(val: string | number | null | undefined): number | null {
  if (val == null || val === '') return null
  const s = typeof val === 'number' ? String(val) : val
  const stripped = s.replace(/[^\d]/g, '')
  if (!stripped) return null
  return parseInt(stripped, 10)
}
