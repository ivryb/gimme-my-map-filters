import { useEffect, useMemo, useRef, useState } from 'react'
import { importLibrary, setOptions } from '@googlemaps/js-api-loader'
import type { Bounds, PlaceResult } from '#/lib/search-contract'

export type MapView = {
  center: {
    lat: number
    lng: number
  }
  zoom: number
  bounds: Bounds
}

type SearchMapProps = {
  initialCenter: { lat: number; lng: number }
  initialZoom: number
  places: PlaceResult[]
  highlightedPlaceId?: string | null
  onMapIdle: (view: MapView) => void
  onMarkerClick: (place: PlaceResult) => void
}

type MarkerEntry = {
  place: PlaceResult
  marker: google.maps.Marker
  labelOverlay: PlaceLabelOverlay
}

type PlaceLabelOverlay = google.maps.OverlayView & {
  setVisible: (visible: boolean) => void
  setHighlighted: (highlighted: boolean) => void
}

const LABEL_MIN_ZOOM = 16

function areClose(a: number, b: number) {
  return Math.abs(a - b) < 0.00001
}

function hasMeaningfulMapChange(previous: MapView | null, next: MapView) {
  if (!previous) {
    return true
  }

  return (
    previous.zoom !== next.zoom ||
    !areClose(previous.center.lat, next.center.lat) ||
    !areClose(previous.center.lng, next.center.lng) ||
    !areClose(previous.bounds.north, next.bounds.north) ||
    !areClose(previous.bounds.south, next.bounds.south) ||
    !areClose(previous.bounds.east, next.bounds.east) ||
    !areClose(previous.bounds.west, next.bounds.west)
  )
}

function createPlaceLabelOverlay({
  map,
  position,
  label,
  onClick,
}: {
  map: google.maps.Map
  position: google.maps.LatLngLiteral
  label: string
  onClick: () => void
}): PlaceLabelOverlay {
  class ClickablePlaceLabelOverlay
    extends google.maps.OverlayView
    implements PlaceLabelOverlay
  {
    private readonly position = position
    private readonly label = label
    private readonly onClick = onClick
    private element: HTMLButtonElement | null = null
    private isVisible = true
    private isHighlighted = false

    onAdd() {
      const element = document.createElement('button')
      element.type = 'button'
      element.className = 'map-place-label-button'
      element.textContent = this.label
      element.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        this.onClick()
      })

      this.getPanes()?.overlayMouseTarget?.appendChild(element)
      element.style.display = this.isVisible ? 'inline-flex' : 'none'
      element.classList.toggle('is-selected', this.isHighlighted)
      this.element = element
    }

    draw() {
      if (!this.element) {
        return
      }

      const projection = this.getProjection()
      if (!projection) {
        return
      }

      const point = projection.fromLatLngToDivPixel(
        new google.maps.LatLng(this.position)
      )

      if (!point) {
        return
      }

      this.element.style.left = `${point.x}px`
      this.element.style.top = `${point.y}px`
    }

    onRemove() {
      if (!this.element) {
        return
      }

      this.element.remove()
      this.element = null
    }

    setVisible(visible: boolean) {
      this.isVisible = visible

      if (!this.element) {
        return
      }

      this.element.style.display = visible ? 'inline-flex' : 'none'
    }

    setHighlighted(highlighted: boolean) {
      this.isHighlighted = highlighted

      if (!this.element) {
        return
      }

      this.element.classList.toggle('is-selected', highlighted)
    }
  }

  const overlay = new ClickablePlaceLabelOverlay()
  overlay.setMap(map)
  return overlay
}

export default function SearchMap({
  initialCenter,
  initialZoom,
  places,
  highlightedPlaceId,
  onMapIdle,
  onMarkerClick,
}: SearchMapProps) {
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const markersRef = useRef<MarkerEntry[]>([])
  const idleListenerRef = useRef<google.maps.MapsEventListener | null>(null)
  const zoomListenerRef = useRef<google.maps.MapsEventListener | null>(null)
  const lastViewRef = useRef<MapView | null>(null)
  const onMapIdleRef = useRef(onMapIdle)
  const onMarkerClickRef = useRef(onMarkerClick)
  const placesRef = useRef(places)

  const mapsApiKey = useMemo(
    () => import.meta.env.VITE_GOOGLE_MAPS_JS_API_KEY?.trim(),
    []
  )

  useEffect(() => {
    onMapIdleRef.current = onMapIdle
  }, [onMapIdle])

  useEffect(() => {
    onMarkerClickRef.current = onMarkerClick
  }, [onMarkerClick])

  useEffect(() => {
    placesRef.current = places
  }, [places])

  function shortenLabel(name: string) {
    const normalized = name.trim()
    if (normalized.length <= 24) {
      return normalized
    }

    return `${normalized.slice(0, 22)}...`
  }

  function updateMarkerLabels() {
    const map = mapRef.current
    if (!map) {
      return
    }

    const shouldShow = (map.getZoom() ?? 0) >= LABEL_MIN_ZOOM

    for (const entry of markersRef.current) {
      entry.labelOverlay.setVisible(shouldShow)
    }
  }

  function updateMarkerHighlight() {
    for (const entry of markersRef.current) {
      const isSelected = highlightedPlaceId === entry.place.id
      entry.marker.setZIndex(isSelected ? 10_000 : undefined)
      entry.marker.setAnimation(
        isSelected ? google.maps.Animation.BOUNCE : null
      )
      entry.labelOverlay.setHighlighted(isSelected)

      if (isSelected) {
        setTimeout(() => {
          entry.marker.setAnimation(null)
        }, 700)
      }
    }
  }

  useEffect(() => {
    let isCancelled = false

    async function setupMap() {
      if (!containerRef.current) {
        return
      }

      if (!mapsApiKey) {
        setError('Missing VITE_GOOGLE_MAPS_JS_API_KEY')
        return
      }

      try {
        setOptions({ key: mapsApiKey })
        await importLibrary('maps')

        if (isCancelled || !containerRef.current) {
          return
        }

        const map = new google.maps.Map(containerRef.current, {
          center: initialCenter,
          zoom: initialZoom,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          clickableIcons: false,
          gestureHandling: 'greedy',
        })

        mapRef.current = map

        idleListenerRef.current = map.addListener('idle', () => {
          const bounds = map.getBounds()
          const center = map.getCenter()

          if (!bounds || !center) {
            return
          }

          const next: MapView = {
            center: {
              lat: center.lat(),
              lng: center.lng(),
            },
            zoom: map.getZoom() ?? initialZoom,
            bounds: {
              north: bounds.getNorthEast().lat(),
              east: bounds.getNorthEast().lng(),
              south: bounds.getSouthWest().lat(),
              west: bounds.getSouthWest().lng(),
            },
          }

          if (hasMeaningfulMapChange(lastViewRef.current, next)) {
            lastViewRef.current = next
            onMapIdleRef.current(next)
          }

          updateMarkerLabels()
        })

        zoomListenerRef.current = map.addListener('zoom_changed', () => {
          updateMarkerLabels()
        })
      } catch (setupError) {
        const message =
          setupError instanceof Error ? setupError.message : 'Failed to load Google Map'
        setError(message)
      }
    }

    setupMap()

    return () => {
      isCancelled = true

      if (idleListenerRef.current) {
        idleListenerRef.current.remove()
      }

      if (zoomListenerRef.current) {
        zoomListenerRef.current.remove()
      }

      for (const entry of markersRef.current) {
        entry.marker.setMap(null)
        entry.labelOverlay.setMap(null)
      }

      markersRef.current = []
      mapRef.current = null
    }
  }, [mapsApiKey])

  useEffect(() => {
    const map = mapRef.current
    if (!map) {
      return
    }

    map.setCenter(initialCenter)
    map.setZoom(initialZoom)
  }, [initialCenter, initialZoom])

  useEffect(() => {
    const map = mapRef.current
    if (!map) {
      return
    }

    for (const entry of markersRef.current) {
      entry.marker.setMap(null)
      entry.labelOverlay.setMap(null)
    }
    markersRef.current = []

    markersRef.current = places.map((place) => {
      const marker = new google.maps.Marker({
        map,
        position: { lat: place.lat, lng: place.lng },
      })

      const labelOverlay = createPlaceLabelOverlay({
        map,
        position: { lat: place.lat, lng: place.lng },
        label: shortenLabel(place.name),
        onClick: () => {
          onMarkerClickRef.current(place)
        },
      })

      marker.addListener('click', () => {
        onMarkerClickRef.current(place)
      })

      return { place, marker, labelOverlay }
    })

    updateMarkerLabels()
    updateMarkerHighlight()
  }, [places])

  useEffect(() => {
    const map = mapRef.current
    if (!map) {
      return
    }

    if (!highlightedPlaceId) {
      updateMarkerHighlight()
      return
    }

    const found = placesRef.current.find((place) => place.id === highlightedPlaceId)
    if (!found) {
      updateMarkerHighlight()
      return
    }

    map.panTo({ lat: found.lat, lng: found.lng })
    updateMarkerHighlight()
  }, [highlightedPlaceId])

  return (
    <div className="relative h-full min-h-[360px] w-full overflow-hidden rounded-xl border border-border bg-muted/20 lg:rounded-none lg:border-0">
      <div ref={containerRef} className="absolute inset-0" />
      {error ? (
        <div className="absolute inset-0 grid place-items-center bg-background/90 p-4 text-center text-sm text-destructive">
          {error}
        </div>
      ) : null}
    </div>
  )
}
