import { createHash, randomUUID } from 'node:crypto'
import {
  normalizeBounds,
  normalizeMinRating,
  placesSearchRequestSchema,
  splitBoundsForDateLine,
  type Bounds,
  type PlaceResult,
  type PlacesSearchRequest,
  type PlacesSearchResponse,
} from '#/lib/search-contract'
import { getSearchCache } from '#/lib/server/search-cache.server'

const PLACES_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText'
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.rating',
  'places.userRatingCount',
  'places.googleMapsUri',
  'places.photos',
  'nextPageToken',
].join(',')

const MAX_PAGES = 3
const CACHE_TTL_SECONDS = Number(process.env.CACHE_TTL_SECONDS ?? 60 * 60 * 24 * 30)

type GoogleTextSearchResponse = {
  places?: Array<{
    id?: string
    displayName?: { text?: string }
    formattedAddress?: string
    location?: { latitude?: number; longitude?: number }
    rating?: number
    userRatingCount?: number
    googleMapsUri?: string
    photos?: Array<{
      name?: string
      authorAttributions?: Array<{
        displayName?: string
        uri?: string
      }>
    }>
  }>
  nextPageToken?: string
}

type GooglePlace = NonNullable<GoogleTextSearchResponse['places']>[number]
type SearchPayload = Omit<PlacesSearchResponse, 'cache' | 'requestId'>

const inflight = new Map<string, Promise<PlacesSearchResponse>>()

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

function makeCacheKey(request: PlacesSearchRequest) {
  const normalized = {
    query: request.query.trim().toLowerCase(),
    bounds: normalizeBounds(request.bounds),
    filters: {
      minRating: normalizeMinRating(request.filters.minRating),
      minReviews: request.filters.minReviews,
    },
    fetchAllPages: request.fetchAllPages,
  }

  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
}

function toGoogleRectangle(bounds: Bounds) {
  return {
    low: {
      latitude: bounds.south,
      longitude: bounds.west,
    },
    high: {
      latitude: bounds.north,
      longitude: bounds.east,
    },
  }
}

async function fetchGooglePage({
  apiKey,
  query,
  bounds,
  minRating,
  pageToken,
}: {
  apiKey: string
  query: string
  bounds: Bounds
  minRating: number
  pageToken?: string
}) {
  const body: Record<string, unknown> = {
    textQuery: query,
    minRating,
    pageSize: 20,
    rankPreference: 'RELEVANCE',
    locationRestriction: {
      rectangle: toGoogleRectangle(bounds),
    },
  }

  if (pageToken) {
    body.pageToken = pageToken
  }

  const response = await fetch(PLACES_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const details = await response.text()
    throw new Error(`Google Places request failed (${response.status}): ${details}`)
  }

  return (await response.json()) as GoogleTextSearchResponse
}

async function fetchForBounds({
  apiKey,
  query,
  bounds,
  minRating,
  fetchAllPages,
}: {
  apiKey: string
  query: string
  bounds: Bounds
  minRating: number
  fetchAllPages: boolean
}) {
  const pagesToFetch = fetchAllPages ? MAX_PAGES : 1
  const collected: NonNullable<GoogleTextSearchResponse['places']> = []

  let nextToken: string | undefined

  for (let page = 0; page < pagesToFetch; page += 1) {
    const data = await fetchGooglePage({
      apiKey,
      query,
      bounds,
      minRating,
      pageToken: nextToken,
    })

    if (data.places?.length) {
      collected.push(...data.places)
    }

    if (!data.nextPageToken) {
      break
    }

    nextToken = data.nextPageToken

    if (page < pagesToFetch - 1) {
      await sleep(1200)
    }
  }

  return collected
}

function toPlaceResult(raw: GooglePlace): PlaceResult | null {
  const latitude = raw.location?.latitude
  const longitude = raw.location?.longitude

  if (
    !raw.id ||
    latitude === undefined ||
    longitude === undefined ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    return null
  }

  const rating = Number.isFinite(raw.rating) ? raw.rating! : null
  const userRatingCount = Number.isFinite(raw.userRatingCount)
    ? Math.max(0, Math.floor(raw.userRatingCount!))
    : 0
  const normalizedPhotoNames = (raw.photos ?? [])
    .map((photo) => photo.name?.trim() ?? '')
    .filter((name) => name.length > 0)
  const firstPhoto = normalizedPhotoNames[0] ?? null
  const photoAttributions = (raw.photos ?? [])
    .flatMap((photo) => photo.authorAttributions ?? [])
    .map((attribution) => {
      const displayName = attribution.displayName?.trim()
      const uri = attribution.uri?.trim()

      if (displayName && uri) {
        return `${displayName} (${uri})`
      }

      return displayName || uri || null
    })
    .filter((value): value is string => value !== null)

  return {
    id: raw.id,
    name: raw.displayName?.text?.trim() || 'Unnamed place',
    address: raw.formattedAddress?.trim() || 'Address unavailable',
    lat: latitude,
    lng: longitude,
    rating,
    userRatingCount,
    googleMapsUri:
      raw.googleMapsUri ?? `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(raw.id)}`,
    primaryPhotoName: firstPhoto,
    photoNames: normalizedPhotoNames,
    photoAttributions,
  }
}

function dedupePlaces(rawPlaces: NonNullable<GoogleTextSearchResponse['places']>) {
  const unique = new Map<string, PlaceResult>()

  for (const raw of rawPlaces) {
    const place = toPlaceResult(raw)
    if (!place) {
      continue
    }

    const existing = unique.get(place.id)
    if (!existing) {
      unique.set(place.id, place)
      continue
    }

    if (place.userRatingCount > existing.userRatingCount) {
      unique.set(place.id, place)
    }
  }

  return [...unique.values()]
}

function sortPlaces(places: PlaceResult[]) {
  return places.sort((a, b) => {
    if (b.userRatingCount !== a.userRatingCount) {
      return b.userRatingCount - a.userRatingCount
    }

    const ratingA = a.rating ?? -1
    const ratingB = b.rating ?? -1

    if (ratingB !== ratingA) {
      return ratingB - ratingA
    }

    return a.name.localeCompare(b.name)
  })
}

async function computeSearchPayload(request: PlacesSearchRequest): Promise<SearchPayload> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY

  if (!apiKey) {
    throw new Error('Missing GOOGLE_PLACES_API_KEY')
  }

  const normalizedBounds = normalizeBounds(request.bounds)
  const boundsSegments = splitBoundsForDateLine(normalizedBounds)
  const minRating = normalizeMinRating(request.filters.minRating)

  const rawResults: NonNullable<GoogleTextSearchResponse['places']> = []

  for (const segment of boundsSegments) {
    const fromSegment = await fetchForBounds({
      apiKey,
      query: request.query,
      bounds: segment,
      minRating,
      fetchAllPages: request.fetchAllPages,
    })

    rawResults.push(...fromSegment)
  }

  const deduped = dedupePlaces(rawResults)
  const totalBeforePostFilter = deduped.length

  const filtered = sortPlaces(
    deduped.filter((place) => place.userRatingCount >= request.filters.minReviews)
  )

  return {
    places: filtered,
    totalBeforePostFilter,
    totalAfterPostFilter: filtered.length,
  }
}

export async function searchPlaces(rawRequest: unknown): Promise<PlacesSearchResponse> {
  const parsed = placesSearchRequestSchema.parse(rawRequest)
  const request: PlacesSearchRequest = {
    ...parsed,
    query: parsed.query.trim(),
    bounds: normalizeBounds(parsed.bounds),
    filters: {
      minRating: normalizeMinRating(parsed.filters.minRating),
      minReviews: parsed.filters.minReviews,
    },
  }

  const cacheKey = makeCacheKey(request)
  const cache = getSearchCache<SearchPayload>()

  const cached = await cache.get(cacheKey)
  if (cached) {
    return {
      ...cached,
      cache: 'hit',
      requestId: randomUUID(),
    }
  }

  if (!inflight.has(cacheKey)) {
    inflight.set(
      cacheKey,
      (async () => {
        const payload = await computeSearchPayload(request)
        await cache.set(cacheKey, payload, CACHE_TTL_SECONDS)

        return {
          ...payload,
          cache: 'miss',
          requestId: randomUUID(),
        } satisfies PlacesSearchResponse
      })().finally(() => {
        inflight.delete(cacheKey)
      })
    )
  }

  const response = await inflight.get(cacheKey)
  if (!response) {
    throw new Error('Search request dedupe unexpectedly returned no response')
  }

  return response
}
