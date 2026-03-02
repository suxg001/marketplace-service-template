export interface AdCreative {
  creativeId: string;
  advertiser: string;
  platform: string;
  placement: string;
  destinationUrl: string;
  mediaType: 'image' | 'video';
  mediaUrl: string;
  cta: string;
  capturedAt: string;
  country: string;
}

export interface AdQueryInput {
  platform?: string;
  placement?: string;
  country?: string;
  query?: string;
  advertiser?: string;
  limit?: number;
}

export interface AdProvider {
  name: string;
  verify(input: AdQueryInput): Promise<AdCreative[]>;
  library(input: AdQueryInput): Promise<AdCreative[]>;
}

function seededHash(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function buildCreative(seed: string, i: number, input: AdQueryInput): AdCreative {
  const hash = seededHash(`${seed}:${i}`);
  const country = (input.country || 'US').toUpperCase();
  const platform = (input.platform || 'meta').toLowerCase();
  const placement = (input.placement || 'feed').toLowerCase();
  const mediaType = hash % 2 === 0 ? 'image' : 'video';
  const adTopic = input.query || input.advertiser || 'growth tools';

  return {
    creativeId: `cr_${platform}_${country}_${hash.toString(36).slice(0, 8)}`,
    advertiser: input.advertiser || `Brand ${String.fromCharCode(65 + (hash % 26))}`,
    platform,
    placement,
    destinationUrl: `https://example-ad-landing.com/${encodeURIComponent(adTopic)}?src=${platform}&c=${country}`,
    mediaType,
    mediaUrl: `https://cdn.example-ad-assets.com/${platform}/${hash}.${mediaType === 'image' ? 'jpg' : 'mp4'}`,
    cta: hash % 3 === 0 ? 'Learn More' : hash % 3 === 1 ? 'Shop Now' : 'Get Quote',
    capturedAt: new Date(Date.now() - i * 1800000).toISOString(),
    country,
  };
}

class MockAdProvider implements AdProvider {
  name = 'mock-ad-provider-v1';

  async verify(input: AdQueryInput): Promise<AdCreative[]> {
    const count = Math.min(Math.max(input.limit || 8, 1), 20);
    const seed = `${input.platform || 'meta'}:${input.placement || 'feed'}:${input.country || 'US'}:${input.query || 'default'}`;
    return Array.from({ length: count }).map((_, i) => buildCreative(seed, i, input));
  }

  async library(input: AdQueryInput): Promise<AdCreative[]> {
    const count = Math.min(Math.max(input.limit || 10, 1), 50);
    const seed = `${input.query || 'library'}:${input.advertiser || 'all'}:${input.country || 'US'}`;
    return Array.from({ length: count }).map((_, i) => buildCreative(seed, i, input));
  }
}

export const adProvider: AdProvider = new MockAdProvider();
