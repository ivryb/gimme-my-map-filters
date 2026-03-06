import { createHash } from 'node:crypto'
import { getSearchCache } from '#/lib/server/search-cache.server'

const PHOTO_MEDIA_BASE_URL = 'https://places.googleapis.com/v1'
const DEFAULT_MAX_WIDTH_PX = 480
const DEFAULT_MAX_HEIGHT_PX = 360
const PHOTO_CACHE_TTL_SECONDS = Number(
  process.env.PHOTO_CACHE_TTL_SECONDS ?? 60 * 60 * 6
)

const PHOTO_NAME_PATTERN = /^places\/[^/]+\/photos\/[^/]+$/
const inflight = new Map<string, Promise<string>>()

type ResolvePhotoUriInput = {
  photoName: string
  maxWidthPx?: number
  maxHeightPx?: number
}

type GooglePhotoMediaResponse = {
  photoUri?: string
}

function normalizePhotoSize(value: number | undefined, fallback: number) {
  if (!Number.isFinite(value)) {
    return fallback
  }

  return Math.min(1600, Math.max(16, Math.floor(value!)))
}

function normalizePhotoName(photoName: string) {
  const normalized = photoName.trim().replace(/^\/+/, '')
  if (!PHOTO_NAME_PATTERN.test(normalized)) {
    throw new Error('Invalid photo name')
  }

  return normalized
}

function makePhotoCacheKey({
  photoName,
  maxWidthPx,
  maxHeightPx,
}: {
  photoName: string
  maxWidthPx: number
  maxHeightPx: number
}) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        photoName,
        maxWidthPx,
        maxHeightPx,
      })
    )
    .digest('hex')
}

async function fetchPhotoUri({
  apiKey,
  photoName,
  maxWidthPx,
  maxHeightPx,
}: {
  apiKey: string
  photoName: string
  maxWidthPx: number
  maxHeightPx: number
}) {
  const url = new URL(`${PHOTO_MEDIA_BASE_URL}/${photoName}/media`)
  url.searchParams.set('maxWidthPx', String(maxWidthPx))
  url.searchParams.set('maxHeightPx', String(maxHeightPx))
  url.searchParams.set('skipHttpRedirect', 'true')

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'X-Goog-Api-Key': apiKey,
    },
  })

  if (!response.ok) {
    const details = await response.text()
    throw new Error(`Google photo request failed (${response.status}): ${details}`)
  }

  const json = (await response.json()) as GooglePhotoMediaResponse
  if (!json.photoUri) {
    throw new Error('Google photo request returned no photoUri')
  }

  return json.photoUri
}

export async function resolvePlacePhotoUri(input: ResolvePhotoUriInput) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) {
    throw new Error('Missing GOOGLE_PLACES_API_KEY')
  }

  const photoName = normalizePhotoName(input.photoName)
  const maxWidthPx = normalizePhotoSize(input.maxWidthPx, DEFAULT_MAX_WIDTH_PX)
  const maxHeightPx = normalizePhotoSize(
    input.maxHeightPx,
    DEFAULT_MAX_HEIGHT_PX
  )

  const cache = getSearchCache<string>()
  const cacheKey = `photo:${makePhotoCacheKey({ photoName, maxWidthPx, maxHeightPx })}`
  const cached = await cache.get(cacheKey)
  if (cached) {
    return cached
  }

  if (!inflight.has(cacheKey)) {
    inflight.set(
      cacheKey,
      (async () => {
        const photoUri = await fetchPhotoUri({
          apiKey,
          photoName,
          maxWidthPx,
          maxHeightPx,
        })

        await cache.set(cacheKey, photoUri, PHOTO_CACHE_TTL_SECONDS)
        return photoUri
      })().finally(() => {
        inflight.delete(cacheKey)
      })
    )
  }

  return inflight.get(cacheKey)!
}

