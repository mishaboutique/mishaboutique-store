import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { computeTrendingRanking } from '@/lib/trending-core';

/**
 * GET /api/products/trending -> { ranked: string[] }
 * Product ids, conversion-priority se (Purchase > Begin checkout > Add to cart > Views,
 * pichle 30 din), phir lifetime popularity. 1 ghante ka cache = Supabase par bahut kam load.
 */
export const revalidate = 3600;

const cachedRanking = unstable_cache(computeTrendingRanking, ['trending-ranking-v1'], { revalidate: 3600 });

export async function GET() {
  try {
    return NextResponse.json({ ranked: await cachedRanking() });
  } catch (err) {
    console.error('[trending] error', err);
    return NextResponse.json({ ranked: [] });
  }
}
