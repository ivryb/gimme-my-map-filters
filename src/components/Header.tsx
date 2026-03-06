import { Link, useRouterState } from '@tanstack/react-router'
import type { HomeSearch } from '#/lib/home-search'

export default function Header() {
  const currentSearch = useRouterState({
    select: (state) => state.location.search,
  }) as HomeSearch

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-[1400px] items-center justify-between px-4">
        <Link
          to="/"
          search={currentSearch}
          className="text-sm font-semibold tracking-tight no-underline"
        >
          Guesthouse Search
        </Link>

        <nav className="flex items-center gap-4 text-sm text-muted-foreground">
          <Link to="/" search={currentSearch} activeProps={{ className: 'text-foreground' }}>
            Search
          </Link>
          <Link
            to="/about"
            search={currentSearch}
            activeProps={{ className: 'text-foreground' }}
          >
            About
          </Link>
        </nav>
      </div>
    </header>
  )
}
