import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { ZodError } from 'zod'
import { searchPlaces } from '#/lib/server/places-search.server'

const RATE_LIMIT_WINDOW_MS = 60_000
const MAX_REQUESTS_PER_WINDOW = 45
const rateLimitStore = new Map<string, { count: number; resetAt: number }>()

function isRateLimited(clientKey: string) {
  const now = Date.now()

  if (rateLimitStore.size > 1000) {
    for (const [key, value] of rateLimitStore) {
      if (value.resetAt <= now) {
        rateLimitStore.delete(key)
      }
    }
  }

  const existing = rateLimitStore.get(clientKey)

  if (!existing || existing.resetAt <= now) {
    rateLimitStore.set(clientKey, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    })
    return false
  }

  if (existing.count >= MAX_REQUESTS_PER_WINDOW) {
    return true
  }

  existing.count += 1
  return false
}

export const Route = createFileRoute('/api/places/search')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const forwarded = request.headers.get('x-forwarded-for')
          const clientKey = forwarded?.split(',')[0]?.trim() || 'local'

          if (isRateLimited(clientKey)) {
            return json(
              {
                error: 'Rate limit exceeded. Please wait and try again.',
              },
              { status: 429 }
            )
          }

          const body = await request.json()
          const result = await searchPlaces(body)

          return json(result, {
            headers: {
              'Cache-Control': 'no-store',
            },
          })
        } catch (error) {
          if (error instanceof ZodError) {
            return json(
              {
                error: 'Invalid request payload',
                issues: error.flatten(),
              },
              { status: 400 }
            )
          }

          return json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Unexpected server error',
            },
            { status: 500 }
          )
        }
      },
    },
  },
})
