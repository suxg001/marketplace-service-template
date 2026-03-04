import { proxyFetch } from '../proxy';

export interface RealEstateProperty {
  zpid: string;
  address: string;
  price: number | null;
  zestimate: number | null;
  details: {
    bedrooms: number | null;
    bathrooms: number | null;
    sqft: number | null;
    lot_sqft: number | null;
    year_built: number | null;
    type: string | null;
    status: string | null;
  };
  price_history: Array<{ date: string; event: string; price: number | null }>;
  photos: string[];
}

function toNumber(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function extractJsonBlob(html: string, marker: string): any | null {
  const idx = html.indexOf(marker);
  if (idx < 0) return null;
  const start = html.indexOf('{', idx);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') inString = true;
    if (ch === '{') depth++;
    if (ch === '}') depth--;

    if (depth === 0) {
      const jsonText = html.slice(start, i + 1);
      try {
        return JSON.parse(jsonText);
      } catch {
        return null;
      }
    }
  }

  return null;
}

function flattenObjects(root: any, max = 12000): any[] {
  const out: any[] = [];
  const q: any[] = [root];
  while (q.length && out.length < max) {
    const cur = q.shift();
    if (!cur || typeof cur !== 'object') continue;
    out.push(cur);
    for (const v of Object.values(cur)) q.push(v);
  }
  return out;
}

function findFirstObject(root: any, predicate: (x: any) => boolean): any | null {
  for (const obj of flattenObjects(root)) {
    if (predicate(obj)) return obj;
  }
  return null;
}

function mapProperty(raw: any, fallbackZpid: string): RealEstateProperty {
  const address = raw?.address?.streetAddress || raw?.streetAddress || raw?.address || raw?.hdpData?.homeInfo?.streetAddress || '';
  const city = raw?.address?.city || raw?.city || raw?.hdpData?.homeInfo?.city || '';
  const state = raw?.address?.state || raw?.state || raw?.hdpData?.homeInfo?.state || '';
  const zip = raw?.address?.zipcode || raw?.zipcode || raw?.hdpData?.homeInfo?.zipcode || '';

  const line = [address, city && `${city},`, state, zip].filter(Boolean).join(' ').replace(/\s+,/g, ',').replace(/\s+/g, ' ').trim();

  const history = (raw?.priceHistory || raw?.hdpData?.homeInfo?.priceHistory || []) as any[];

  return {
    zpid: String(raw?.zpid || raw?.hdpData?.homeInfo?.zpid || fallbackZpid),
    address: line,
    price: toNumber(raw?.price || raw?.hdpData?.homeInfo?.price),
    zestimate: toNumber(raw?.zestimate || raw?.hdpData?.homeInfo?.zestimate),
    details: {
      bedrooms: toNumber(raw?.bedrooms || raw?.beds || raw?.hdpData?.homeInfo?.bedrooms),
      bathrooms: toNumber(raw?.bathrooms || raw?.baths || raw?.hdpData?.homeInfo?.bathrooms),
      sqft: toNumber(raw?.livingArea || raw?.area || raw?.hdpData?.homeInfo?.livingArea),
      lot_sqft: toNumber(raw?.lotSize || raw?.lotAreaValue || raw?.hdpData?.homeInfo?.lotSize),
      year_built: toNumber(raw?.yearBuilt || raw?.hdpData?.homeInfo?.yearBuilt),
      type: raw?.homeType || raw?.homeTypeString || raw?.hdpData?.homeInfo?.homeType || null,
      status: raw?.homeStatus || raw?.homeStatusForHDP || raw?.hdpData?.homeInfo?.homeStatus || null,
    },
    price_history: history.slice(0, 20).map((it: any) => ({
      date: String(it?.date || it?.time || ''),
      event: String(it?.event || it?.eventDescription || it?.buyerSeller || 'update'),
      price: toNumber(it?.price),
    })),
    photos: (raw?.photos || raw?.responsivePhotos || raw?.hdpData?.homeInfo?.photos || [])
      .map((p: any) => p?.mixedSources?.jpeg?.[0]?.url || p?.url || p)
      .filter((u: any) => typeof u === 'string')
      .slice(0, 20),
  };
}

async function fetchHtml(url: string): Promise<string> {
  const res = await proxyFetch(url, { timeoutMs: 45000, maxRetries: 2 });
  if (!res.ok) throw new Error(`Request failed: ${res.status} ${res.statusText}`);
  return await res.text();
}

export async function fetchPropertyByZpid(zpid: string): Promise<RealEstateProperty> {
  const html = await fetchHtml(`https://www.zillow.com/homedetails/${encodeURIComponent(zpid)}_zpid/`);

  const nextData = extractJsonBlob(html, '"__NEXT_DATA__"');
  const apolloData = extractJsonBlob(html, '"apiCache"') || extractJsonBlob(html, '"hdpApolloPreloadedData"');
  const root = { nextData, apolloData };

  const propertyObj = findFirstObject(root, (x) => (x?.zpid && (x?.price || x?.zestimate || x?.homeType)));
  if (!propertyObj) throw new Error('Could not parse Zillow property payload');

  return mapProperty(propertyObj, zpid);
}

export async function searchProperties(params: {
  address?: string;
  zip?: string;
  city?: string;
  type?: string;
  min_price?: number;
  max_price?: number;
  beds?: number;
  limit?: number;
}) {
  const query = params.address || params.zip || params.city;
  if (!query) throw new Error('address, zip, or city is required');

  const base = `https://www.zillow.com/homes/${encodeURIComponent(query)}_rb/`;
  const html = await fetchHtml(base);

  const nextData = extractJsonBlob(html, '"__NEXT_DATA__"');
  const candidates = flattenObjects(nextData).filter((x) => x && typeof x === 'object' && x.zpid && (x.price || x.unformattedPrice));

  const unique = new Map<string, any>();
  for (const c of candidates) unique.set(String(c.zpid), c);

  let rows = [...unique.values()].map((x) => ({
    zpid: String(x.zpid),
    address: x.address || x.streetAddress || x.hdpData?.homeInfo?.streetAddress || '',
    city: x.city || x.hdpData?.homeInfo?.city || '',
    state: x.state || x.hdpData?.homeInfo?.state || '',
    zip: x.zipcode || x.hdpData?.homeInfo?.zipcode || '',
    price: toNumber(x.unformattedPrice || x.price || x.hdpData?.homeInfo?.price),
    beds: toNumber(x.bedrooms || x.beds),
    baths: toNumber(x.bathrooms || x.baths),
    sqft: toNumber(x.livingArea || x.area),
    status: x.homeStatus || x.homeStatusForHDP || null,
    home_type: x.homeType || x.homeTypeString || null,
    url: typeof x.detailUrl === 'string' ? `https://www.zillow.com${x.detailUrl}` : null,
  }));

  if (params.min_price) rows = rows.filter((r) => !r.price || r.price >= params.min_price!);
  if (params.max_price) rows = rows.filter((r) => !r.price || r.price <= params.max_price!);
  if (params.beds) rows = rows.filter((r) => !r.beds || r.beds >= params.beds!);
  if (params.type) {
    const t = params.type.toLowerCase();
    rows = rows.filter((r) => (r.status || '').toLowerCase().includes(t) || (r.home_type || '').toLowerCase().includes(t));
  }

  return {
    query,
    totalFound: rows.length,
    results: rows.slice(0, Math.min(params.limit || 20, 50)),
  };
}

export async function marketByZip(zip: string) {
  const data = await searchProperties({ zip, limit: 50 });
  const priced = data.results.filter((r) => typeof r.price === 'number') as Array<typeof data.results[number] & { price: number }>;

  const prices = priced.map((r) => r.price).sort((a, b) => a - b);
  const median = prices.length ? prices[Math.floor(prices.length / 2)] : null;
  const avg = prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null;

  return {
    zip,
    inventory: data.totalFound,
    median_home_value: median,
    average_home_value: avg,
    median_rent: null,
  };
}

export async function compsByZpid(zpid: string, radius?: string) {
  const target = await fetchPropertyByZpid(zpid);
  const zipMatch = target.address.match(/\b(\d{5})\b/);
  const zip = zipMatch?.[1];
  if (!zip) throw new Error('Could not infer ZIP for comparable search');

  const search = await searchProperties({ zip, limit: 30 });
  const comps = search.results
    .filter((r) => r.zpid !== zpid)
    .slice(0, 10)
    .map((r) => ({
      zpid: r.zpid,
      address: [r.address, r.city, r.state, r.zip].filter(Boolean).join(', '),
      price: r.price,
      beds: r.beds,
      baths: r.baths,
      sqft: r.sqft,
      status: r.status,
      distance: radius || null,
      url: r.url,
    }));

  return { zpid, radius: radius || null, comps };
}
