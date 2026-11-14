import { NextResponse } from 'next/server';
import { GET as googleFeedGET } from '@/app/feeds/google-saree.xml/route';

// Pinterest / Facebook feeds Google feed ke SAME items se bante hain, isliye
// product IDs (feed_idmap, skip_parents) hamesha Google feed jaise hi rehte hain.

export const SITE_URL = 'https://www.mishaboutique.com';
// Purane feed mein 584 items the. Isse kam aayein to adhoori file dene ke bajay error do.
export const MIN_ITEMS = 500;

export interface FeedItem {
  tags: Array<[string, string]>; // [naam bina "g:" ke, XML-escaped value]
}

export function unesc(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

export function escXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function parseGoogleXml(xml: string): FeedItem[] {
  const out: FeedItem[] = [];
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  for (const b of blocks) {
    const tags: Array<[string, string]> = [];
    const re = /<((?:g:)?[a-z_]+)>([\s\S]*?)<\/\1>/g;
    let m: RegExpExecArray | null;
    const inner = b.slice(6, -7);
    while ((m = re.exec(inner))) tags.push([m[1].replace(/^g:/, ''), m[2]]);
    out.push({ tags });
  }
  return out;
}

export function get(it: FeedItem, name: string): string {
  const f = it.tags.find((t) => t[0] === name);
  return f ? f[1] : '';
}
export function getAll(it: FeedItem, name: string): string[] {
  return it.tags.filter((t) => t[0] === name).map((t) => t[1]);
}

export function stockText(v: string): string {
  return v === 'out_of_stock' ? 'out of stock' : 'in stock';
}

/** Google feed ke items lao. Adhoora ho to null (caller 503 de). */
export async function loadItems(): Promise<FeedItem[] | null> {
  try {
    const res = await googleFeedGET();
    if (!res.ok) return null;
    const items = parseGoogleXml(await res.text());
    if (items.length < MIN_ITEMS) return null;
    return items;
  } catch {
    return null;
  }
}

export function unavailable(): NextResponse {
  return new NextResponse('Feed temporarily unavailable', {
    status: 503,
    headers: { 'Retry-After': '300', 'Cache-Control': 'no-store' },
  });
}

export const FEED_HEADERS = {
  'Cache-Control': 'public, max-age=300, stale-while-revalidate=60',
};
