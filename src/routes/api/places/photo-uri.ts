import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { ZodError, z } from 'zod'
import { resolvePlacePhotoUri } from '#/lib/server/place-photo.server'

const photoQuerySchema = z.object({
  name: z.string().trim().regex(/^places\/[^/]+\/photos\/[^/]+$/),
  maxWidth: z.coerce.number().int().min(16).max(1600).optional(),
  maxHeight: z.coerce.number().int().min(16).max(1600).optional(),
})

export const Route = createFileRoute('/api/places/photo-uri')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url)
          const query = photoQuerySchema.parse({
            name: url.searchParams.get('name') ?? '',
            maxWidth: url.searchParams.get('maxWidth') ?? undefined,
            maxHeight: url.searchParams.get('maxHeight') ?? undefined,
          })

          const photoUri = await resolvePlacePhotoUri({
            photoName: query.name,
            maxWidthPx: query.maxWidth,
            maxHeightPx: query.maxHeight,
          })

          return json(
            { photoUri },
            {
              headers: {
                'Cache-Control': 'public, max-age=1800',
              },
            }
          )
        } catch (error) {
          if (error instanceof ZodError) {
            return json(
              {
                error: 'Invalid query parameters',
                issues: error.flatten(),
              },
              { status: 400 }
            )
          }

          return json(
            {
              error:
                error instanceof Error ? error.message : 'Unexpected server error',
            },
            { status: 500 }
          )
        }
      },
    },
  },
})
