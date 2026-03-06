import * as z from 'zod'

export const coordinateSchema = z.number().finite()

export const boundsSchema = z
  .object({
    north: coordinateSchema.min(-90).max(90),
    south: coordinateSchema.min(-90).max(90),
    east: coordinateSchema.min(-180).max(180),
    west: coordinateSchema.min(-180).max(180),
  })
  .refine((value) => value.north > value.south, {
    message: 'north must be greater than south',
    path: ['north'],
  })

export const searchFiltersSchema = z.object({
  minRating: z.number().min(0).max(5).default(4.5),
  minReviews: z.number().int().min(0).max(1_000_000).default(20),
})

export const placesSearchRequestSchema = z.object({
  query: z.string().trim().min(1).max(120),
  bounds: boundsSchema,
  filters: searchFiltersSchema,
  fetchAllPages: z.boolean().default(true),
})

export const placeResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string(),
  lat: z.number(),
  lng: z.number(),
  rating: z.number().nullable(),
  userRatingCount: z.number().int().nonnegative(),
  googleMapsUri: z.string().nullable(),
  primaryPhotoName: z.string().nullable().default(null),
  photoNames: z.array(z.string()).default([]),
  photoAttributions: z.array(z.string()).default([]),
})

export const placesSearchResponseSchema = z.object({
  places: z.array(placeResultSchema),
  totalBeforePostFilter: z.number().int().nonnegative(),
  totalAfterPostFilter: z.number().int().nonnegative(),
  cache: z.enum(['hit', 'miss']),
  requestId: z.string(),
})

export type Bounds = z.infer<typeof boundsSchema>
export type SearchFilters = z.infer<typeof searchFiltersSchema>
export type PlacesSearchRequest = z.infer<typeof placesSearchRequestSchema>
export type PlaceResult = z.infer<typeof placeResultSchema>
export type PlacesSearchResponse = z.infer<typeof placesSearchResponseSchema>

export function normalizeMinRating(input: number): number {
  const clamped = Math.min(5, Math.max(0, input))
  return Math.round(clamped * 10) / 10
}

export function normalizeBounds(bounds: Bounds): Bounds {
  const round = (value: number) => Number(value.toFixed(5))
  return {
    north: round(bounds.north),
    south: round(bounds.south),
    east: round(bounds.east),
    west: round(bounds.west),
  }
}

export function splitBoundsForDateLine(bounds: Bounds): Bounds[] {
  if (bounds.west <= bounds.east) {
    return [bounds]
  }

  return [
    {
      ...bounds,
      west: bounds.west,
      east: 180,
    },
    {
      ...bounds,
      west: -180,
      east: bounds.east,
    },
  ]
}
