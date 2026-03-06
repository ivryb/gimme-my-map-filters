import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { Search, SlidersHorizontal } from "lucide-react";
import SearchMap, { type MapView } from "#/components/search-map";
import ResultsPanel from "#/components/results-panel";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Slider } from "#/components/ui/slider";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "#/components/ui/sheet";
import {
  placesSearchResponseSchema,
  type PlacesSearchRequest,
  type PlacesSearchResponse,
} from "#/lib/search-contract";
import { parseHomeSearch } from "#/lib/home-search";

const DEFAULT_CENTER = {
  lat: -8.670458,
  lng: 115.212629,
};
const DEFAULT_ZOOM = 11;
const HOME_STATE_STORAGE_KEY = "guesthouse-search:home-state:v1";

type HomeResultState = {
  places: PlacesSearchResponse["places"];
  totalBeforePostFilter: number;
  totalAfterPostFilter: number;
  cache: PlacesSearchResponse["cache"] | null;
};

function makeSearchFilterKey(
  query: string,
  minRating: number,
  minReviews: number,
) {
  return `${query.trim().toLowerCase()}|${minRating.toFixed(1)}|${minReviews}`;
}

type PersistedHomeState = {
  query: string;
  minRating: number;
  minReviews: number;
  selectedPlaceId: string | null;
  currentMapView: MapView | null;
  initialCenter: {
    lat: number;
    lng: number;
  };
  initialZoom: number;
  mapMovedSinceLastSearch: boolean;
  hasCompletedSearch: boolean;
  resultState: HomeResultState;
};

const EMPTY_RESULT_STATE: HomeResultState = {
  places: [],
  totalBeforePostFilter: 0,
  totalAfterPostFilter: 0,
  cache: null,
};

let memoryHomeState: PersistedHomeState | null = null;
const photoUriMemoryCache = new Map<string, string | null>();
const photoUriInflightCache = new Map<string, Promise<string | null>>();

function loadPersistedHomeState(): PersistedHomeState | null {
  if (memoryHomeState) {
    return memoryHomeState;
  }

  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.sessionStorage.getItem(HOME_STATE_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as PersistedHomeState;
    memoryHomeState = parsed;
    return parsed;
  } catch {
    return null;
  }
}

function persistHomeState(next: PersistedHomeState) {
  memoryHomeState = next;

  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.setItem(HOME_STATE_STORAGE_KEY, JSON.stringify(next));
}

function areSearchFiltersEqual(
  persisted: PersistedHomeState,
  query: string,
  minRating: number,
  minReviews: number,
) {
  return (
    persisted.query === query &&
    persisted.minRating === minRating &&
    persisted.minReviews === minReviews
  );
}

export const Route = createFileRoute("/")({
  validateSearch: parseHomeSearch,
  component: HomePage,
});

function HomePage() {
  const routeSearch = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const restoredState = useMemo(() => loadPersistedHomeState(), []);

  const initialQuery = routeSearch.q ?? restoredState?.query ?? "";
  const initialMinRating =
    routeSearch.minRating ?? restoredState?.minRating ?? 4.5;
  const initialMinReviews =
    routeSearch.minReviews ?? restoredState?.minReviews ?? 20;

  const initialCenter =
    routeSearch.lat !== undefined && routeSearch.lng !== undefined
      ? { lat: routeSearch.lat, lng: routeSearch.lng }
      : (restoredState?.initialCenter ?? DEFAULT_CENTER);

  const initialZoom =
    routeSearch.zoom ?? restoredState?.initialZoom ?? DEFAULT_ZOOM;

  const canRestoreResults =
    restoredState !== null &&
    areSearchFiltersEqual(
      restoredState,
      initialQuery,
      initialMinRating,
      initialMinReviews,
    );

  const [query, setQuery] = useState(initialQuery);
  const [minRating, setMinRating] = useState(initialMinRating);
  const [minReviews, setMinReviews] = useState(initialMinReviews);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(
    canRestoreResults ? restoredState.selectedPlaceId : null,
  );
  const [currentMapView, setCurrentMapView] = useState<MapView | null>(
    canRestoreResults ? restoredState.currentMapView : null,
  );
  const [mapMovedSinceLastSearch, setMapMovedSinceLastSearch] = useState(
    canRestoreResults ? restoredState.mapMovedSinceLastSearch : false,
  );
  const [hasCompletedSearch, setHasCompletedSearch] = useState(
    canRestoreResults ? restoredState.hasCompletedSearch : false,
  );
  const [searchError, setSearchError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [mapCenter, setMapCenter] = useState(initialCenter);
  const [resultState, setResultState] = useState<HomeResultState>(
    canRestoreResults ? restoredState.resultState : EMPTY_RESULT_STATE,
  );
  const [lastCompletedFilterKey, setLastCompletedFilterKey] = useState<
    string | null
  >(
    canRestoreResults && restoredState?.hasCompletedSearch
      ? makeSearchFilterKey(initialQuery, initialMinRating, initialMinReviews)
      : null,
  );
  const [pendingFilterKey, setPendingFilterKey] = useState<string | null>(null);

  useEffect(() => {
    const hasLocationFromSearch =
      routeSearch.lat !== undefined && routeSearch.lng !== undefined;

    if (
      hasLocationFromSearch ||
      restoredState?.initialCenter ||
      !navigator.geolocation
    ) {
      return;
    }

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setMapCenter({
          lat: coords.latitude,
          lng: coords.longitude,
        });
      },
      () => {
        // Keep fallback center if geolocation fails.
      },
      { enableHighAccuracy: false, timeout: 7000 },
    );
  }, [restoredState?.initialCenter, routeSearch.lat, routeSearch.lng]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void navigate({
        replace: true,
        search: (previous) => ({
          ...previous,
          q: query.trim() || undefined,
          minRating,
          minReviews,
        }),
      });
    }, 250);

    return () => {
      clearTimeout(timer);
    };
  }, [minRating, minReviews, navigate, query]);

  useEffect(() => {
    persistHomeState({
      query,
      minRating,
      minReviews,
      selectedPlaceId,
      currentMapView,
      initialCenter: mapCenter,
      initialZoom,
      mapMovedSinceLastSearch,
      hasCompletedSearch,
      resultState,
    });
  }, [
    currentMapView,
    hasCompletedSearch,
    initialZoom,
    mapCenter,
    mapMovedSinceLastSearch,
    minRating,
    minReviews,
    query,
    resultState,
    selectedPlaceId,
  ]);

  const searchMutation = useMutation({
    onMutate: (payload: PlacesSearchRequest) => {
      setPendingFilterKey(
        makeSearchFilterKey(
          payload.query,
          payload.filters.minRating,
          payload.filters.minReviews,
        ),
      );
    },
    mutationFn: async (payload: PlacesSearchRequest) => {
      const response = await fetch("/api/places/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? `Search failed (${response.status})`);
      }

      const json = await response.json();
      return placesSearchResponseSchema.parse(json);
    },
    onSuccess: (data, payload) => {
      setSearchError(null);
      setHasCompletedSearch(true);
      setResultState({
        places: data.places,
        totalBeforePostFilter: data.totalBeforePostFilter,
        totalAfterPostFilter: data.totalAfterPostFilter,
        cache: data.cache,
      });
      setLastCompletedFilterKey(
        makeSearchFilterKey(
          payload.query,
          payload.filters.minRating,
          payload.filters.minReviews,
        ),
      );
      setMapMovedSinceLastSearch(false);
    },
    onError: (error) => {
      setSearchError(error.message);
    },
    onSettled: () => {
      setPendingFilterKey(null);
    },
  });

  const hasValidSearchInput = query.trim().length > 0;

  const searchPayload = useMemo<PlacesSearchRequest | null>(() => {
    if (!currentMapView || !hasValidSearchInput) {
      return null;
    }

    return {
      query: query.trim(),
      bounds: currentMapView.bounds,
      filters: {
        minRating,
        minReviews,
      },
      fetchAllPages: true,
    };
  }, [currentMapView, hasValidSearchInput, minRating, minReviews, query]);

  const mapButtonLabel =
    hasCompletedSearch && mapMovedSinceLastSearch
      ? "Search this area"
      : "Run search";
  const keepPreviousResultsVisible =
    searchMutation.isPending &&
    resultState.places.length > 0 &&
    pendingFilterKey !== null &&
    pendingFilterKey === lastCompletedFilterKey;
  const resultsLoading = searchMutation.isPending && !keepPreviousResultsVisible;

  const resolvePhotoUri = useCallback(
    async (
      photoName: string,
      options?: {
        maxWidth?: number;
        maxHeight?: number;
      },
    ) => {
      const maxWidth = Math.min(1600, Math.max(16, options?.maxWidth ?? 520));
      const maxHeight = Math.min(
        1600,
        Math.max(16, options?.maxHeight ?? 360),
      );
      const cacheKey = `${photoName}|${maxWidth}|${maxHeight}`;

      if (photoUriMemoryCache.has(cacheKey)) {
        return photoUriMemoryCache.get(cacheKey) ?? null;
      }

      if (!photoUriInflightCache.has(cacheKey)) {
        const params = new URLSearchParams({
          name: photoName,
          maxWidth: String(maxWidth),
          maxHeight: String(maxHeight),
        });

        photoUriInflightCache.set(
          cacheKey,
          (async () => {
            const response = await fetch(`/api/places/photo-uri?${params}`);
            if (!response.ok) {
              photoUriMemoryCache.set(cacheKey, null);
              return null;
            }

            const body = (await response.json().catch(() => null)) as
              | { photoUri?: string }
              | null;
            const photoUri =
              typeof body?.photoUri === "string" ? body.photoUri : null;

            photoUriMemoryCache.set(cacheKey, photoUri);
            return photoUri;
          })().finally(() => {
            photoUriInflightCache.delete(cacheKey);
          }),
        );
      }

      return photoUriInflightCache.get(cacheKey) ?? null;
    },
    [],
  );

  function executeSearch() {
    if (!searchPayload) {
      setSearchError("Enter a query and wait for map bounds to load.");
      return;
    }

    searchMutation.mutate(searchPayload);
  }

  function onMapIdle(view: MapView) {
    setCurrentMapView(view);
    setMapCenter(view.center);

    if (hasCompletedSearch) {
      setMapMovedSinceLastSearch(true);
    }

    void navigate({
      replace: true,
      search: (previous) => ({
        ...previous,
        lat: Number(view.center.lat.toFixed(5)),
        lng: Number(view.center.lng.toFixed(5)),
        zoom: view.zoom,
      }),
    });
  }

  return (
    <main className="mx-auto flex w-full max-w-[1400px] flex-col gap-3 px-4 py-4 lg:h-[calc(100dvh-3.5rem)] lg:gap-0 lg:px-0 lg:py-0 lg:overflow-hidden">
      <div className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3 lg:hidden">
        <div>
          <h1 className="text-base font-semibold tracking-tight">
            Map Quality Search
          </h1>
          <p className="text-xs text-muted-foreground">
            Use filters and search this area.
          </p>
        </div>
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <Button variant="outline">
              <SlidersHorizontal className="size-4" />
              Filters
            </Button>
          </SheetTrigger>
          <SheetContent
            side="right"
            className="w-[92vw] max-w-md overflow-y-auto"
          >
            <SheetHeader>
              <SheetTitle>Search filters</SheetTitle>
            </SheetHeader>
            <div className="space-y-4 p-4">
              <FilterControls
                idPrefix="mobile"
                query={query}
                minRating={minRating}
                minReviews={minReviews}
                mapButtonLabel={mapButtonLabel}
                mapMovedSinceLastSearch={mapMovedSinceLastSearch}
                searchError={searchError}
                loading={searchMutation.isPending}
                canSearch={Boolean(searchPayload)}
                onQueryChange={setQuery}
                onMinRatingChange={setMinRating}
                onMinReviewsChange={setMinReviews}
                onSearch={executeSearch}
              />

              <ResultsPanel
                places={resultState.places}
                loading={resultsLoading}
                refreshing={keepPreviousResultsVisible}
                selectedPlaceId={selectedPlaceId}
                totalBeforePostFilter={resultState.totalBeforePostFilter}
                totalAfterPostFilter={resultState.totalAfterPostFilter}
                cacheStatus={resultState.cache}
                onSelectPlace={(placeId) => {
                  setSelectedPlaceId(placeId);
                  setSheetOpen(false);
                }}
                resolvePhotoUri={resolvePhotoUri}
              />
            </div>
          </SheetContent>
        </Sheet>
      </div>

      <div className="hidden items-center gap-3 border-b border-border bg-card px-4 py-3 lg:flex">
        <FilterControls
          idPrefix="desktop"
          horizontal
          query={query}
          minRating={minRating}
          minReviews={minReviews}
          mapButtonLabel={mapButtonLabel}
          mapMovedSinceLastSearch={mapMovedSinceLastSearch}
          searchError={searchError}
          loading={searchMutation.isPending}
          canSearch={Boolean(searchPayload)}
          onQueryChange={setQuery}
          onMinRatingChange={setMinRating}
          onMinReviewsChange={setMinReviews}
          onSearch={executeSearch}
        />
      </div>

      <div className="grid flex-1 gap-4 lg:grid-cols-[380px_minmax(0,1fr)] lg:gap-0 lg:overflow-hidden">
        <aside className="hidden h-full flex-col overflow-hidden bg-card lg:flex">
          <div className="flex-1 overflow-y-auto">
            <ResultsPanel
              places={resultState.places}
              loading={resultsLoading}
              refreshing={keepPreviousResultsVisible}
              selectedPlaceId={selectedPlaceId}
              totalBeforePostFilter={resultState.totalBeforePostFilter}
              totalAfterPostFilter={resultState.totalAfterPostFilter}
              cacheStatus={resultState.cache}
              onSelectPlace={setSelectedPlaceId}
              resolvePhotoUri={resolvePhotoUri}
            />
          </div>
        </aside>

        <section className="flex min-h-[70dvh] flex-col gap-3 lg:h-full lg:gap-0 lg:border-l lg:border-border">
          <div className="flex-1">
            <SearchMap
              initialCenter={mapCenter}
              initialZoom={initialZoom}
              places={resultState.places}
              highlightedPlaceId={selectedPlaceId}
              onMapIdle={onMapIdle}
              onMarkerClick={(place) => {
                setSelectedPlaceId(place.id);
              }}
            />
          </div>
        </section>
      </div>
    </main>
  );
}

type FilterControlsProps = {
  idPrefix: string;
  query: string;
  minRating: number;
  minReviews: number;
  mapButtonLabel: string;
  mapMovedSinceLastSearch: boolean;
  searchError: string | null;
  loading: boolean;
  canSearch: boolean;
  horizontal?: boolean;
  onQueryChange: (value: string) => void;
  onMinRatingChange: (value: number) => void;
  onMinReviewsChange: (value: number) => void;
  onSearch: () => void;
};

function FilterControls({
  idPrefix,
  query,
  minRating,
  minReviews,
  mapButtonLabel,
  mapMovedSinceLastSearch,
  searchError,
  loading,
  canSearch,
  horizontal = false,
  onQueryChange,
  onMinRatingChange,
  onMinReviewsChange,
  onSearch,
}: FilterControlsProps) {
  if (horizontal) {
    return (
      <div className="flex flex-1 flex-col gap-1.5">
        <div className="flex flex-1 items-center gap-3">
          <Input
            id={`${idPrefix}-query`}
            className="flex-1"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') onSearch(); }}
            placeholder="guest house, villa, hostel, etc"
          />

          <div className="flex shrink-0 items-center gap-2">
            <span className="whitespace-nowrap text-sm font-medium">Rating</span>
            <span className="w-8 text-center text-sm text-muted-foreground">
              {minRating.toFixed(1)}
            </span>
            <div className="w-32">
              <Slider
                min={0}
                max={5}
                step={0.1}
                value={[minRating]}
                onValueChange={(value) => onMinRatingChange(value[0] ?? 4.5)}
              />
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <label
              htmlFor={`${idPrefix}-reviews`}
              className="whitespace-nowrap text-sm font-medium"
            >
              Reviews
            </label>
            <Input
              id={`${idPrefix}-reviews`}
              type="number"
              min={0}
              className="w-24"
              value={minReviews}
              onChange={(event) => {
                const numeric = Number(event.target.value);
                onMinReviewsChange(
                  Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0,
                );
              }}
            />
          </div>

          <Button onClick={onSearch} disabled={loading || !canSearch}>
            <Search className="size-4" />
            {mapButtonLabel}
          </Button>
        </div>

        {searchError ? (
          <p className="text-xs text-destructive">{searchError}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label htmlFor={`${idPrefix}-query`} className="text-sm font-medium">
          Search query
        </label>
        <Input
          id={`${idPrefix}-query`}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') onSearch(); }}
          placeholder="guest house, villa, hostel, etc"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">Minimum rating</span>
          <span className="text-muted-foreground">{minRating.toFixed(1)}</span>
        </div>
        <Slider
          min={0}
          max={5}
          step={0.1}
          value={[minRating]}
          onValueChange={(value) => {
            onMinRatingChange(value[0] ?? 4.5);
          }}
        />
      </div>

      <div className="space-y-2">
        <label htmlFor={`${idPrefix}-reviews`} className="text-sm font-medium">
          Minimum reviews
        </label>
        <Input
          id={`${idPrefix}-reviews`}
          type="number"
          min={0}
          value={minReviews}
          onChange={(event) => {
            const numeric = Number(event.target.value);
            onMinReviewsChange(
              Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0,
            );
          }}
        />
      </div>

      <Button
        className="w-full"
        onClick={onSearch}
        disabled={loading || !canSearch}
      >
        <Search className="size-4" />
        {mapButtonLabel}
      </Button>

      {searchError ? (
        <p className="text-sm text-destructive">{searchError}</p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {mapMovedSinceLastSearch
            ? "Map moved. Search this area to refresh results."
            : "Set filters and run search on current map area."}
        </p>
      )}
    </div>
  );
}
