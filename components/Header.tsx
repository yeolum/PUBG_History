import Link from 'next/link'

const NAV = [
  { href: '/tournaments', label: 'Tournaments' },
  { href: '/teams', label: 'Teams' },
  { href: '/players', label: 'Players' },
]

export default function Header() {
  return (
    <header className="bg-gray-900 text-white shadow-md">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-8">
        <Link href="/" className="text-lg font-bold tracking-tight text-yellow-400 hover:text-yellow-300">
          PUBG History
        </Link>
        <nav className="flex items-center gap-6">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="text-sm text-gray-300 hover:text-white transition-colors">
              {n.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  )
}
