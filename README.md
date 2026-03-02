# issue91-mvp-api

MVP service for:
- Mobile SERP Tracker
- Google Maps Lead Generator
- Reviews & Business Data API
- AI Search endpoint for bounty #149

## Setup
```bash
cp .env.example .env
npm install
npm start
```

## Auth
All requests need header:
`x-api-key: <API_KEY from .env>`

## Example calls

### 1) Mobile SERP
```bash
curl -X POST http://localhost:3000/api/serp/mobile-search \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: change-me' \
  -d '{"keyword":"pizza","region":"us","language":"en","page":1}'
```

### 2) AI Search (#149)
```bash
curl -X POST http://localhost:3000/api/serp/ai-search \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: change-me' \
  -d '{"keyword":"pizza","region":"us","language":"en","engines":["google","bing"],"page":1}'
```

### 3) Maps leads
```bash
curl -X POST http://localhost:3000/api/maps/leads \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: change-me' \
  -d '{"keyword":"dentist","city":"Austin","limit":5}'
```

### 4) Business reviews
```bash
curl -X POST http://localhost:3000/api/business/reviews \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: change-me' \
  -d '{"business_name":"Austin Dentist"}'
```

## Response envelope
```json
{
  "success": true,
  "data": {},
  "error": null,
  "meta": {}
}
```
