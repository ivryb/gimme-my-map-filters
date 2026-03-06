import { describe, expect, it } from 'vitest'
import {
  normalizeBounds,
  normalizeMinRating,
  splitBoundsForDateLine,
} from '#/lib/search-contract'

describe('normalizeMinRating', () => {
  it('rounds to 0.1 increments', () => {
    expect(normalizeMinRating(4.64)).toBe(4.6)
    expect(normalizeMinRating(4.66)).toBe(4.7)
  })

  it('clamps to range', () => {
    expect(normalizeMinRating(-1)).toBe(0)
    expect(normalizeMinRating(9)).toBe(5)
  })
})

describe('normalizeBounds', () => {
  it('rounds coordinates to 5 decimals', () => {
    expect(
      normalizeBounds({
        north: -8.1234567,
        south: -9.1234567,
        east: 115.1234567,
        west: 114.1234567,
      })
    ).toEqual({
      north: -8.12346,
      south: -9.12346,
      east: 115.12346,
      west: 114.12346,
    })
  })
})

describe('splitBoundsForDateLine', () => {
  it('returns one segment when viewport does not cross date line', () => {
    const bounds = {
      north: 10,
      south: -10,
      east: 120,
      west: 100,
    }

    expect(splitBoundsForDateLine(bounds)).toEqual([bounds])
  })

  it('returns two segments when viewport crosses date line', () => {
    const bounds = {
      north: 10,
      south: -10,
      east: -170,
      west: 170,
    }

    expect(splitBoundsForDateLine(bounds)).toEqual([
      {
        north: 10,
        south: -10,
        east: 180,
        west: 170,
      },
      {
        north: 10,
        south: -10,
        east: -170,
        west: -180,
      },
    ])
  })
})
