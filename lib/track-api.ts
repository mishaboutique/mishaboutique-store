'use client';

import { supabase } from './supabase';
import { ActivityEventType } from './types';

const SESSION_KEY = 'saaj_session_id';

/**
 * Every browser tab/visit gets a random session id kept in sessionStorage
 * (cleared when the tab closes). This is how we stitch together "what did
 * this visitor look at" without requiring the shopper to log in.
 */
export function getSessionId(): string {
  if (typeof window === 'undefined') return 'server';
  try {
    let id = window.sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      window.sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    // Storage disabled (private mode etc.) — fall back to a per-call id.
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

interface TrackOptions {
  pagePath?: string;
  productId?: string;
  orderId?: string;
  userId?: string | null;
  metadata?: Record<string, any>;
}

// Set by /api/track/click/<sendId> (a non-httpOnly cookie) when a visitor
// arrives here via a link inside a WooCommerce campaign email. Reading it
// here means every event this visitor triggers afterwards (page_view,
// product_view, purchase, ...) gets tagged with the same send id, which is
// how the admin's cold/warm/hot audience view knows this person actually
// browsed the site (warm) or went on to view 2+ pages / buy (hot) after
// that specific email.
function getCampaignSendId(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)wc_sid=([0-9a-f-]{36})/i);
  return match ? match[1] : null;
}

// ── Shopper-insights context (visitor id, location, device, source) ────────
const VISITOR_KEY = 'saaj_visitor_id';
const GEO_KEY = 'saaj_geo_v1';
const SOURCE_KEY = 'saaj_src';
const GEO_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface Geo {
  country: string | null;
  region: string | null;
  city: string | null;
}

function randomId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Same browser = same id across visits (localStorage). Used for "kitni baar repeat aaya". */
export function getVisitorId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    let id = window.localStorage.getItem(VISITOR_KEY);
    if (!id) {
      id = randomId();
      window.localStorage.setItem(VISITOR_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

function getDevice(): string | null {
  if (typeof navigator === 'undefined') return null;
  return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
}

/** utm_source, else referrer host, else 'direct'. Remembered for the tab session. */
function getSource(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const saved = window.sessionStorage.getItem(SOURCE_KEY);
    if (saved) return saved;
    const utm = new URLSearchParams(window.location.search).get('utm_source');
    let src = utm ? utm.toLowerCase().slice(0, 40) : 'direct';
    if (!utm && document.referrer) {
      const host = new URL(document.referrer).hostname.replace(/^www\./, '');
      if (host && host !== window.location.hostname.replace(/^www\./, '')) src = host.slice(0, 40);
    }
    window.sessionStorage.setItem(SOURCE_KEY, src);
    return src;
  } catch {
    return null;
  }
}

let geoPromise: Promise<Geo | null> | null = null;

function readCachedGeo(): Geo | null {
  try {
    const raw = window.localStorage.getItem(GEO_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.at > GEO_TTL_MS) return null;
    return parsed.geo as Geo;
  } catch {
    return null;
  }
}

function getGeo(): Promise<Geo | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  const cached = readCachedGeo();
  if (cached) return Promise.resolve(cached);
  if (!geoPromise) {
    geoPromise = fetch('/api/geo')
      .then((r) => (r.ok ? r.json() : null))
      .then((geo: Geo | null) => {
        if (geo && geo.country) {
          try {
            window.localStorage.setItem(GEO_KEY, JSON.stringify({ at: Date.now(), geo }));
          } catch {}
        }
        return geo;
      })
      .catch(() => null);
  }
  // Never hold up tracking for more than 1.5s waiting on location.
  return Promise.race([geoPromise, new Promise<null>((res) => setTimeout(() => res(null), 1500))]);
}

/**
 * Fire-and-forget event log used by the Admin > Analytics dashboard for
 * sales trends, top products, conversion rate and customer behaviour.
 * Never throws — a failed tracking call should never break the storefront.
 */
export async function trackEvent(eventType: ActivityEventType, options: TrackOptions = {}) {
  try {
    const base = {
      session_id: getSessionId(),
      user_id: options.userId ?? null,
      event_type: eventType,
      page_path: options.pagePath ?? null,
      product_id: options.productId ?? null,
      order_id: options.orderId ?? null,
      metadata: options.metadata ?? {},
      campaign_send_id: getCampaignSendId(),
    };
    const geo = await getGeo();
    const { error } = await supabase.from('activity_events').insert({
      ...base,
      visitor_id: getVisitorId(),
      country: geo?.country ?? null,
      region: geo?.region ?? null,
      city: geo?.city ?? null,
      device: getDevice(),
      source: getSource(),
    });
    // If the Shopper Insights migration hasn't been run yet the extra columns
    // don't exist and the insert fails -- fall back to the old minimal row so
    // existing tracking keeps working either way.
    if (error) {
      await supabase.from('activity_events').insert(base);
    }
  } catch {
    // best-effort only
  }
}
