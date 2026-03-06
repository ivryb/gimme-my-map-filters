import { createFileRoute } from '@tanstack/react-router'
import { parseHomeSearch } from '#/lib/home-search'

export const Route = createFileRoute('/about')({
  validateSearch: parseHomeSearch,
  component: AboutPage,
})

function AboutPage() {
  return (
    <main className="mx-auto w-full max-w-[900px] px-4 py-10">
      <section className="space-y-4 rounded-xl border border-border bg-card p-6">
        <h1 className="text-2xl font-semibold tracking-tight">About this app</h1>
        <p className="text-sm text-muted-foreground">
          This project improves place discovery by combining Google Places data
          with stronger filters than Google Maps UI provides.
        </p>
        <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
          <li>Minimum rating filter</li>
          <li>Minimum review-count filter</li>
          <li>Viewport-based search on the current map area</li>
          <li>Cached server requests to reduce duplicate API calls</li>
        </ul>
      </section>
    </main>
  )
}
