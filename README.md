# Guesthouse Search

A better-filter UI on top of Google Places + Google Maps.

It solves the core issue in Google Maps discovery: you can require a high rating, but not a meaningful minimum review count.

## What it does

- Search any free-text query ("guest house", "hostel", "villa", etc.)
- Restrict search to the **currently visible map viewport**
- Filter by:
  - minimum rating
  - minimum number of reviews
- Sort results by review count, then rating
- Open selected places directly in Google Maps (new tab)
- Cache API responses to reduce repeated calls

## Stack

- TanStack Start (React + file-based routing)
- Bun runtime + package manager
- TanStack Query
- shadcn/ui (minimal black/white styling)
- Google Places API (Text Search, New)
- Google Maps JavaScript API
- Cache:
  - SQLite locally
  - Vercel KV in production (optional)

## Setup

1. Install dependencies:

```bash
bun install
```

2. Copy env file and fill keys:

```bash
cp .env.example .env
```

3. Enable these Google APIs in your Google Cloud project:
- Places API (New)
- Maps JavaScript API

4. Run locally:

```bash
bun --bun run dev
```

App will start at `http://localhost:3000`.

## Environment variables

See `.env.example`.

Required:
- `GOOGLE_PLACES_API_KEY`
- `VITE_GOOGLE_MAPS_JS_API_KEY`

Optional:
- `CACHE_PROVIDER=sqlite|kv`
- `SQLITE_CACHE_PATH`
- `CACHE_TTL_SECONDS`
- `KV_REST_API_URL`, `KV_REST_API_TOKEN` (when `CACHE_PROVIDER=kv`)

## API route

`POST /api/places/search`

Request shape:

```json
{
  "query": "guest house",
  "bounds": {
    "north": -8.5,
    "south": -8.8,
    "east": 115.4,
    "west": 115.1
  },
  "filters": {
    "minRating": 4.5,
    "minReviews": 20
  },
  "fetchAllPages": true
}
```

## Notes

- Cache TTL defaults to 30 days (as configured).
- International Date Line crossing viewports are handled by splitting into two API queries and deduping.
- Price filters are intentionally deferred in this v1.
