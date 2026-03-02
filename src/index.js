const express = require('express');
const dotenv = require('dotenv');
dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || 'change-me';
const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60000);
const RATE_MAX = Number(process.env.RATE_LIMIT_MAX || 60);

const buckets = new Map();

const ok = (data, meta = {}) => ({ success: true, data, error: null, meta });
const fail = (message, code = 'BAD_REQUEST', meta = {}) => ({ success: false, data: null, error: { code, message }, meta });

app.use((req, _res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`);
  });
  next();
});

app.use((req, res, next) => {
  const key = req.header('x-api-key');
  if (!key || key !== API_KEY) {
    return res.status(401).json(fail('Unauthorized: invalid x-api-key', 'UNAUTHORIZED'));
  }
  req.apiKey = key;
  next();
});

app.use((req, res, next) => {
  const now = Date.now();
  const item = buckets.get(req.apiKey) || { count: 0, resetAt: now + WINDOW_MS };
  if (now > item.resetAt) {
    item.count = 0;
    item.resetAt = now + WINDOW_MS;
  }
  item.count += 1;
  buckets.set(req.apiKey, item);
  if (item.count > RATE_MAX) {
    return res.status(429).json(fail('Rate limit exceeded', 'RATE_LIMIT', { resetAt: item.resetAt }));
  }
  res.setHeader('X-RateLimit-Limit', RATE_MAX);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, RATE_MAX - item.count));
  res.setHeader('X-RateLimit-Reset', item.resetAt);
  next();
});

function requireFields(body, fields) {
  const missing = fields.filter((f) => body[f] === undefined || body[f] === null || body[f] === '');
  if (missing.length) {
    const err = new Error(`Missing required fields: ${missing.join(', ')}`);
    err.status = 400;
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
}

function validateAiSearchInput(body) {
  requireFields(body, ['keyword', 'region', 'language']);
  const engines = body.engines ?? ['google', 'bing'];
  if (!Array.isArray(engines) || engines.length === 0) {
    const err = new Error('engines must be a non-empty array when provided');
    err.status = 400;
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  return { keyword: body.keyword, region: body.region, language: body.language, engines, page: Number(body.page || 1) };
}

const aiSearchProvider = {
  name: 'mock-ai-search',
  search({ keyword, region, language, engines, page }) {
    return engines.map((engine) => ({
      engine,
      results: Array.from({ length: 5 }).map((_, i) => ({
        title: `[${engine}] ${keyword} result ${(page - 1) * 5 + i + 1}`,
        url: `https://example.com/${engine}/search/${encodeURIComponent(keyword)}/${(page - 1) * 5 + i + 1}`,
        snippet: `Mock ${engine} AI/SERP result for ${keyword} in ${region}/${language}.`,
        rank: (page - 1) * 5 + i + 1,
        sourceEngine: engine
      }))
    }));
  }
};

app.post('/api/serp/mobile-search', (req, res) => {
  requireFields(req.body, ['keyword', 'region', 'language']);
  const { keyword, region, language, page = 1 } = req.body;
  const start = (page - 1) * 10;
  const items = Array.from({ length: 10 }).map((_, i) => ({
    title: `${keyword} result ${start + i + 1}`,
    url: `https://example.com/search/${encodeURIComponent(keyword)}/${start + i + 1}`,
    snippet: `Mock mobile SERP item for ${keyword} in ${region}/${language}.`,
    rank: start + i + 1
  }));
  res.json(ok({ items }, { provider: 'mock', endpoint: 'mobile-search' }));
});

app.post('/api/serp/ai-search', (req, res) => {
  const input = validateAiSearchInput(req.body);
  const groupedResults = aiSearchProvider.search(input);
  res.json(ok({ keyword: input.keyword, page: input.page, engines: groupedResults }, { provider: aiSearchProvider.name, endpoint: 'ai-search' }));
});

app.post('/api/maps/leads', (req, res) => {
  requireFields(req.body, ['keyword', 'city']);
  const { keyword, city, limit = 10 } = req.body;
  const n = Math.min(Number(limit) || 10, 50);
  const leads = Array.from({ length: n }).map((_, i) => ({
    businessName: `${city} ${keyword} ${i + 1}`,
    address: `${i + 1} ${city} Central St`,
    phone: `+1-555-01${String(i).padStart(2, '0')}`,
    rating: Number((4 + ((i % 10) / 20)).toFixed(1)),
    reviewsCount: 20 + i * 7,
    mapUrl: `https://maps.google.com/?q=${encodeURIComponent(`${city} ${keyword} ${i + 1}`)}`
  }));
  res.json(ok({ leads }, { provider: 'mock', endpoint: 'maps-leads' }));
});

app.post('/api/business/reviews', (req, res) => {
  const { place_id, business_name } = req.body;
  if (!place_id && !business_name) {
    return res.status(400).json(fail('Either place_id or business_name is required', 'VALIDATION_ERROR'));
  }
  const base = place_id || business_name;
  const recentReviews = Array.from({ length: 5 }).map((_, i) => ({
    author: `user_${i + 1}`,
    rating: 5 - (i % 2),
    text: `Mock review ${i + 1} for ${base}`,
    publishedAt: new Date(Date.now() - i * 86400000).toISOString()
  }));
  res.json(ok({ averageRating: 4.4, totalReviews: 127, recentReviews }, { provider: 'mock', endpoint: 'business-reviews' }));
});

app.get('/healthz', (_req, res) => res.json(ok({ status: 'ok' })));

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  const code = err.code || 'INTERNAL_ERROR';
  const message = status === 500 ? 'Internal server error' : err.message;
  if (status === 500) console.error(err);
  res.status(status).json(fail(message, code));
});

app.listen(PORT, () => {
  console.log(`issue91-mvp-api listening on :${PORT}`);
});
