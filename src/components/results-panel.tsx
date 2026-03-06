import { useCallback, useEffect, useRef, useState } from 'react'
import { ExternalLink, Star } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import type { PlaceResult } from '#/lib/search-contract'

type ResultsPanelProps = {
  places: PlaceResult[]
  loading: boolean
  refreshing?: boolean
  selectedPlaceId: string | null
  totalBeforePostFilter: number
  totalAfterPostFilter: number
  cacheStatus: 'hit' | 'miss' | null
  onSelectPlace: (placeId: string) => void
  resolvePhotoUri: (
    photoName: string,
    options?: { maxWidth?: number; maxHeight?: number }
  ) => Promise<string | null>
}

export default function ResultsPanel({
  places,
  loading,
  refreshing = false,
  selectedPlaceId,
  totalBeforePostFilter,
  totalAfterPostFilter,
  cacheStatus,
  onSelectPlace,
  resolvePhotoUri,
}: ResultsPanelProps) {
  const cardRefs = useRef(new Map<string, HTMLDivElement>())
  const [visiblePlaceIds, setVisiblePlaceIds] = useState<Set<string>>(
    () => new Set()
  )
  const [photoUrisByName, setPhotoUrisByName] = useState<
    Record<string, string | null>
  >({})
  const photoUrisRef = useRef<Record<string, string | null>>({})
  const inflightPhotoNamesRef = useRef(new Set<string>())

  useEffect(() => {
    photoUrisRef.current = photoUrisByName
  }, [photoUrisByName])

  useEffect(() => {
    if (!selectedPlaceId) {
      return
    }

    const card = cardRefs.current.get(selectedPlaceId)
    if (!card) {
      return
    }

    card.scrollIntoView({
      block: 'nearest',
      behavior: 'smooth',
    })
  }, [selectedPlaceId])

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
      setVisiblePlaceIds(new Set(places.map((place) => place.id)))
      return
    }

    const validPlaceIds = new Set(places.map((place) => place.id))
    const observer = new IntersectionObserver(
      (entries) => {
        setVisiblePlaceIds((previous) => {
          let changed = false
          const next = new Set(previous)

          for (const entry of entries) {
            if (!entry.isIntersecting) {
              continue
            }

            const placeId = (entry.target as HTMLDivElement).dataset.placeId
            if (!placeId || !validPlaceIds.has(placeId) || next.has(placeId)) {
              continue
            }

            next.add(placeId)
            changed = true
          }

          return changed ? next : previous
        })
      },
      {
        rootMargin: '200px 0px',
        threshold: 0.01,
      }
    )

    for (const [placeId, element] of cardRefs.current) {
      if (!validPlaceIds.has(placeId)) {
        continue
      }

      observer.observe(element)
    }

    return () => {
      observer.disconnect()
    }
  }, [places])

  useEffect(() => {
    const validIds = new Set(places.map((place) => place.id))
    setVisiblePlaceIds((previous) => {
      let changed = false
      const next = new Set<string>()

      for (const placeId of previous) {
        if (!validIds.has(placeId)) {
          changed = true
          continue
        }

        next.add(placeId)
      }

      return changed ? next : previous
    })
  }, [places])

  const ensurePhotoUri = useCallback(
    async (photoName: string) => {
      if (Object.hasOwn(photoUrisRef.current, photoName)) {
        return
      }

      if (inflightPhotoNamesRef.current.has(photoName)) {
        return
      }

      inflightPhotoNamesRef.current.add(photoName)

      try {
        const photoUri = await resolvePhotoUri(photoName, {
          maxWidth: 640,
          maxHeight: 420,
        })

        setPhotoUrisByName((previous) => {
          if (Object.hasOwn(previous, photoName)) {
            return previous
          }

          return {
            ...previous,
            [photoName]: photoUri,
          }
        })
      } finally {
        inflightPhotoNamesRef.current.delete(photoName)
      }
    },
    [resolvePhotoUri]
  )

  useEffect(() => {
    for (const place of places) {
      if (place.photoNames.length === 0) {
        continue
      }

      if (visiblePlaceIds.has(place.id) || place.id === selectedPlaceId) {
        void ensurePhotoUri(place.photoNames[0]!)
      }

      if (place.id !== selectedPlaceId) {
        continue
      }

      for (const photoName of place.photoNames.slice(1, 5)) {
        void ensurePhotoUri(photoName)
      }
    }
  }, [ensurePhotoUri, places, selectedPlaceId, visiblePlaceIds])

  if (loading) {
    return (
      <section className="space-y-0">
        {Array.from({ length: 3 }).map((_, index) => (
          <Card
            key={index}
            className="animate-pulse gap-2 rounded-none border-0 border-t px-4 py-3 shadow-none"
          >
            <CardHeader className="gap-2 px-0 pb-1">
              <div className="h-4 w-40 rounded bg-muted" />
              <div className="h-3 w-24 rounded bg-muted" />
            </CardHeader>
            <CardContent className="px-0">
              <div className="h-3 w-full rounded bg-muted" />
            </CardContent>
          </Card>
        ))}
      </section>
    )
  }

  if (places.length === 0) {
    return (
      <section className="border-t border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
        No places match your current filters in this map area.
      </section>
    )
  }

  return (
    <section className="space-y-0">
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3 pb-1 text-xs text-muted-foreground">
        <Badge variant="outline">Raw: {totalBeforePostFilter}</Badge>
        <Badge variant="outline">After filters: {totalAfterPostFilter}</Badge>
        {refreshing ? <Badge variant="secondary">Updating...</Badge> : null}
        {cacheStatus ? (
          <Badge variant={cacheStatus === 'hit' ? 'secondary' : 'outline'}>
            Cache: {cacheStatus}
          </Badge>
        ) : null}
      </div>

      <div className="space-y-0">
        {places.map((place) => {
          const isSelected = place.id === selectedPlaceId

          return (
            <Card
              key={place.id}
              ref={(element) => {
                if (element) {
                  cardRefs.current.set(place.id, element)
                } else {
                  cardRefs.current.delete(place.id)
                }
              }}
              data-place-id={place.id}
              className={`w-full cursor-pointer gap-0 rounded-none border-0 border-t py-0 shadow-none transition-colors hover:bg-muted/25 ${
                isSelected ? 'bg-muted/35' : ''
              }`}
              onClick={() => onSelectPlace(place.id)}
            >
              <CardHeader className="gap-1 px-4 py-3">
                <CardTitle className="text-sm leading-snug font-semibold">
                  {place.name}
                </CardTitle>
                <CardDescription className="inline-flex items-center gap-1.5 text-xs">
                  <Star className="size-3" />
                  {place.rating ?? 'N/A'}
                  <span className="text-muted-foreground/50">·</span>
                  {place.userRatingCount.toLocaleString()} reviews
                </CardDescription>
                {place.googleMapsUri ? (
                  <CardAction>
                    <a
                      href={place.googleMapsUri}
                      target="_blank"
                      rel="noreferrer"
                      className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <ExternalLink className="size-4" />
                    </a>
                  </CardAction>
                ) : null}
              </CardHeader>

              <CardContent className="space-y-2 px-4 py-3">
                {place.photoNames[0] ? (
                  <div className="space-y-2">
                    <div className="overflow-hidden rounded-md border border-border bg-muted/30">
                      {photoUrisByName[place.photoNames[0]] ? (
                        <img
                          src={photoUrisByName[place.photoNames[0]]!}
                          alt={`${place.name} photo`}
                          className="h-40 w-full object-cover"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <div className="h-40 animate-pulse bg-muted" />
                      )}
                    </div>

                    {isSelected && place.photoNames.length > 1 ? (
                      <div className="grid grid-cols-4 gap-2">
                        {place.photoNames.slice(1, 5).map((photoName) => {
                          const uri = photoUrisByName[photoName]

                          return (
                            <div
                              key={photoName}
                              className="overflow-hidden rounded-md border border-border bg-muted/30"
                            >
                              {uri ? (
                                <img
                                  src={uri}
                                  alt={`${place.name} photo`}
                                  className="h-16 w-full object-cover"
                                  loading="lazy"
                                  decoding="async"
                                />
                              ) : (
                                <div className="h-16 animate-pulse bg-muted" />
                              )}
                            </div>
                          )
                        })}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </CardContent>

            </Card>
          )
        })}
      </div>
    </section>
  )
}
