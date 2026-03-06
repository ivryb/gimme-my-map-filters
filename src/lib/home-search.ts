export type HomeSearch = {
  q?: string
  minRating?: number
  minReviews?: number
  lat?: number
  lng?: number
  zoom?: number
}

function parseNumeric(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) {
      return numeric
    }
  }

  return undefined
}

export function parseHomeSearch(search: Record<string, unknown>): HomeSearch {
  const parsed: HomeSearch = {}

  if (typeof search.q === 'string' && search.q.trim().length > 0) {
    parsed.q = search.q
  }

  const minRating = parseNumeric(search.minRating)
  if (minRating !== undefined) {
    parsed.minRating = minRating
  }

  const minReviews = parseNumeric(search.minReviews)
  if (minReviews !== undefined) {
    parsed.minReviews = minReviews
  }

  const lat = parseNumeric(search.lat)
  const lng = parseNumeric(search.lng)
  const zoom = parseNumeric(search.zoom)

  if (lat !== undefined && lng !== undefined) {
    parsed.lat = lat
    parsed.lng = lng
  }

  if (zoom !== undefined) {
    parsed.zoom = zoom
  }

  return parsed
}
