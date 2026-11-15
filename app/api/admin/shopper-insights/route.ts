import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyAdminToken, ADMIN_SESSION_COOKIE } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

/**
 * Admin > Analytics > Shopper Insights.
 *
 * Reads ONLY the activity_events table (add_to_cart, checkout_start, purchase
 * + a narrow product_view read) for the chosen date range and aggregates in
 * memory. No new tables, no extra services -> fits Supabase / Vercel free tier.
 *
 * Free-tier guards: max 90 days range, max ~30k + 20k rows read per request,
 * 60s in-memory cache per range (so pressing Refresh repeatedly is free).
 */

const MAX_RANGE_DAYS = 90;
const PAGE = 1000; // Supabase returns max 1000 rows per request
const MAX_PAGES_MAIN = 30;
const MAX_PAGES_VIEWS = 20;
const CACHE_MS = 60_000;
const IST_MS = 5.5 * 60 * 60 * 1000;

const BASE_COLS = 'session_id, user_id, event_type, product_id, metadata, created_at';
const NEW_COLS = ', visitor_id, country, region, city, device, source';

const INDIA_STATES: Record<string, string> = {
  AN: 'Andaman & Nicobar', AP: 'Andhra Pradesh', AR: 'Arunachal Pradesh', AS: 'Assam', BR: 'Bihar',
  CH: 'Chandigarh', CT: 'Chhattisgarh', DD: 'Daman & Diu', DL: 'Delhi', DN: 'Dadra & Nagar Haveli',
  GA: 'Goa', GJ: 'Gujarat', HP: 'Himachal Pradesh', HR: 'Haryana', JH: 'Jharkhand',
  JK: 'Jammu & Kashmir', KA: 'Karnataka', KL: 'Kerala', LA: 'Ladakh', LD: 'Lakshadweep',
  MH: 'Maharashtra', ML: 'Meghalaya', MN: 'Manipur', MP: 'Madhya Pradesh', MZ: 'Mizoram',
  NL: 'Nagaland', OR: 'Odisha', OD: 'Odisha', PB: 'Punjab', PY: 'Puducherry', RJ: 'Rajasthan',
  SK: 'Sikkim', TG: 'Telangana', TN: 'Tamil Nadu', TR: 'Tripura', UP: 'Uttar Pradesh',
  UT: 'Uttarakhand', UK: 'Uttarakhand', WB: 'West Bengal',
};

type Ev = {
  session_id: string;
  user_id: string | null;
  event_type: string;
  product_id: string | null;
  metadata: any;
  created_at: string;
  visitor_id?: string | null;
  country?: string | null;
  region?: string | null;
  city?: string | null;
  device?: string | null;
  source?: string | null;
};

type V = {
  key: string;
  sessions: Set<string>;
  days: Set<string>;
  viewed: boolean;
  atcEvents: number;
  checkoutSessions: Set<string>;
  purchased: boolean;
  orders: number;
  revenue: number;
  cartValue: number;
  email: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  device: string | null;
  source: string | null;
  firstSeen: string;
  lastSeen: string;
  products: Map<string, number>;
};

const cache = new Map<string, { at: number; body: any }>();

const istDay = (iso: string) => new Date(new Date(iso).getTime() + IST_MS).toISOString().slice(0, 10);
const istHour = (iso: string) => new Date(new Date(iso).getTime() + IST_MS).getUTCHours();

async function fetchAll(
  build: (cols: string) => (a: number, b: number) => PromiseLike<{ data: any[] | null; error: any }>,
  colsFull: string,
  colsBase: string,
  maxPages: number
) {
  let cols = colsFull;
  let needsMigration = false;
  const rows: Ev[] = [];
  let truncated = false;
  for (let page = 0; page < maxPages; page++) {
    let { data, error } = await build(cols)(page * PAGE, page * PAGE + PAGE - 1);
    if (error && cols === colsFull && page === 0) {
      // columns from the migration don't exist yet -> retry with the old ones
      cols = colsBase;
      needsMigration = true;
      ({ data, error } = await build(cols)(0, PAGE - 1));
    }
    if (error) throw error;
    rows.push(...((data ?? []) as Ev[]));
    if (!data || data.length < PAGE) break;
    if (page === maxPages - 1) truncated = true;
  }
  return { rows, truncated, needsMigration };
}

export async function GET(req: Request) {
  const cookie = cookies().get(ADMIN_SESSION_COOKIE)?.value ?? null;
  const verified = await verifyAdminToken(cookie);
  if (!verified.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  let to = new Date(url.searchParams.get('to') ?? Date.now());
  let from = new Date(url.searchParams.get('from') ?? Date.now() - 30 * 86400_000);
  if (isNaN(to.getTime())) to = new Date();
  if (isNaN(from.getTime())) from = new Date(to.getTime() - 30 * 86400_000);
  if (from > to) [from, to] = [to, from];
  const minFrom = new Date(to.getTime() - MAX_RANGE_DAYS * 86400_000);
  if (from < minFrom) from = minFrom;

  const cacheKey = `${Math.floor(from.getTime() / 60000)}-${Math.floor(to.getTime() / 60000)}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) return NextResponse.json(hit.body);

  try {
    const sb = getSupabaseAdmin();
    const f = from.toISOString();
    const t = to.toISOString();

    const main = await fetchAll(
      (cols) => (a, b) =>
        sb.from('activity_events').select(cols)
          .in('event_type', ['add_to_cart', 'checkout_start', 'purchase'])
          .gte('created_at', f).lte('created_at', t)
          .order('created_at', { ascending: true }).range(a, b),
      BASE_COLS + NEW_COLS,
      BASE_COLS,
      MAX_PAGES_MAIN
    );
    const views = await fetchAll(
      (cols) => (a, b) =>
        sb.from('activity_events').select(cols)
          .eq('event_type', 'product_view')
          .gte('created_at', f).lte('created_at', t)
          .order('created_at', { ascending: true }).range(a, b),
      'session_id, user_id, event_type, product_id, created_at, visitor_id, country, region, city, device, source',
      'session_id, user_id, event_type, product_id, created_at',
      MAX_PAGES_VIEWS
    );

    const events = [...main.rows, ...views.rows].sort((x, y) => x.created_at.localeCompare(y.created_at));
    const needsMigration = main.needsMigration || views.needsMigration;
    const truncated = main.truncated || views.truncated;

    // ── group by visitor ────────────────────────────────────────────────
    const visitors = new Map<string, V>();
    type P = {
      views: Set<string>; atcEvents: number; atcQty: number;
      atcV: Set<string>; coV: Set<string>; colors: Map<string, number>;
    };
    const products = new Map<string, P>();
    const getP = (id: string): P => {
      let p = products.get(id);
      if (!p) { p = { views: new Set(), atcEvents: 0, atcQty: 0, atcV: new Set(), coV: new Set(), colors: new Map() }; products.set(id, p); }
      return p;
    };
    const sessionsViewed = new Set<string>();
    const sessionsAtc = new Set<string>();
    const sessionsCo = new Set<string>();
    const sessionsBuy = new Set<string>();
    const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, atc: 0, checkout: 0 }));
    const coSeenHour = new Set<string>();
    const daily = new Map<string, { atc: number; checkout: number; purchase: number }>();
    const dayRow = (d: string) => { let r = daily.get(d); if (!r) { r = { atc: 0, checkout: 0, purchase: 0 }; daily.set(d, r); } return r; };
    let atcEventsTotal = 0, atcQtyTotal = 0, ordersTotal = 0, revenueTotal = 0;
    const productNames = new Set<string>();

    for (const e of events) {
      const key = e.visitor_id || e.user_id || e.session_id;
      let v = visitors.get(key);
      if (!v) {
        v = {
          key, sessions: new Set(), days: new Set(), viewed: false, atcEvents: 0,
          checkoutSessions: new Set(), purchased: false, orders: 0, revenue: 0, cartValue: 0,
          email: null, country: null, region: null, city: null, device: null, source: null,
          firstSeen: e.created_at, lastSeen: e.created_at, products: new Map(),
        };
        visitors.set(key, v);
      }
      v.sessions.add(e.session_id);
      v.days.add(istDay(e.created_at));
      v.lastSeen = e.created_at;
      if (e.country) { v.country = e.country; v.region = e.region ?? v.region; v.city = e.city ?? v.city; }
      if (e.device) v.device = e.device;
      if (e.source && !v.source) v.source = e.source;
      const md = e.metadata ?? {};
      const day = istDay(e.created_at);

      if (e.event_type === 'product_view') {
        v.viewed = true;
        sessionsViewed.add(e.session_id);
        if (e.product_id) getP(e.product_id).views.add(e.session_id);
      } else if (e.event_type === 'add_to_cart') {
        const qty = Math.max(1, Number(md.quantity) || 1);
        v.atcEvents += 1;
        atcEventsTotal += 1; atcQtyTotal += qty;
        sessionsAtc.add(e.session_id);
        dayRow(day).atc += 1;
        hourly[istHour(e.created_at)].atc += 1;
        if (e.product_id) {
          const p = getP(e.product_id);
          p.atcEvents += 1; p.atcQty += qty; p.atcV.add(key);
          const color = typeof md.color === 'string' && md.color ? md.color : null;
          if (color) p.colors.set(color, (p.colors.get(color) ?? 0) + 1);
          v.products.set(e.product_id, (v.products.get(e.product_id) ?? 0) + 1);
          productNames.add(e.product_id);
        }
      } else if (e.event_type === 'checkout_start') {
        sessionsCo.add(e.session_id);
        if (!v.checkoutSessions.has(e.session_id)) {
          v.checkoutSessions.add(e.session_id);
          dayRow(day).checkout += 1;
        }
        const hk = `${e.session_id}-${istHour(e.created_at)}`;
        if (!coSeenHour.has(hk)) { coSeenHour.add(hk); hourly[istHour(e.created_at)].checkout += 1; }
        const cv = Number(md.cartValue) || 0;
        if (cv > v.cartValue) v.cartValue = cv;
        if (e.product_id) {
          getP(e.product_id).coV.add(key);
          v.products.set(e.product_id, v.products.get(e.product_id) ?? 0);
          productNames.add(e.product_id);
        }
      } else if (e.event_type === 'purchase') {
        v.purchased = true; v.orders += 1;
        ordersTotal += 1;
        const total = Number(md.total) || 0;
        v.revenue += total; revenueTotal += total;
        sessionsBuy.add(e.session_id);
        dayRow(day).purchase += 1;
        if (typeof md.email === 'string' && md.email) v.email = md.email;
      }
    }

    // product names for the products that actually show up in cart/checkout
    // (+ top viewed ones) -- one query, capped.
    const ranked = Array.from(products.entries())
      .sort((a, b) => (b[1].atcEvents + b[1].coV.size) - (a[1].atcEvents + a[1].coV.size) || b[1].views.size - a[1].views.size)
      .slice(0, 100);
    const ids = ranked.map(([id]) => id);
    const { data: prows } = ids.length
      ? await sb.from('products').select('id, name, slug').in('id', ids)
      : { data: [] as { id: string; name: string; slug: string }[] };
    const pmap = new Map((prows ?? []).map((p: any) => [p.id, p]));

    const productRows = ranked.map(([id, p]) => ({
      productId: id,
      name: pmap.get(id)?.name ?? 'Unknown product',
      slug: pmap.get(id)?.slug ?? null,
      views: p.views.size,
      atcEvents: p.atcEvents,
      atcQty: p.atcQty,
      atcVisitors: p.atcV.size,
      checkoutVisitors: p.coV.size,
      colors: Array.from(p.colors.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 5),
    }));

    // ── location / device / source breakdowns ──────────────────────────
    const stateName = (v: V) => {
      if (!v.country) return 'Unknown';
      if (v.country === 'IN' && v.region) return INDIA_STATES[v.region.toUpperCase()] ?? v.region;
      return v.region || 'Unknown';
    };
    const group = (label: (v: V) => string) => {
      const m = new Map<string, { name: string; visitors: number; carted: number; checkout: number; purchased: number; atcEvents: number }>();
      for (const v of Array.from(visitors.values())) {
        const name = label(v);
        let r = m.get(name);
        if (!r) { r = { name, visitors: 0, carted: 0, checkout: 0, purchased: 0, atcEvents: 0 }; m.set(name, r); }
        r.visitors += 1;
        if (v.atcEvents > 0) r.carted += 1;
        if (v.checkoutSessions.size > 0) r.checkout += 1;
        if (v.purchased) r.purchased += 1;
        r.atcEvents += v.atcEvents;
      }
      return Array.from(m.values())
        .sort((a, b) => b.checkout - a.checkout || b.carted - a.carted || b.visitors - a.visitors)
        .slice(0, 60);
    };

    // ── repeat visitors ────────────────────────────────────────────────
    const all = Array.from(visitors.values());
    const carters = all.filter((v) => v.atcEvents > 0);
    const repeatVisitors = all.filter((v) => v.sessions.size >= 2).length;
    const repeatNotBought = all.filter((v) => v.sessions.size >= 2 && (v.atcEvents > 0 || v.checkoutSessions.size > 0) && !v.purchased).length;
    const abandoned = all.filter((v) => v.checkoutSessions.size > 0 && !v.purchased);

    const visitorRows = all
      .filter((v) => v.atcEvents > 0 || v.checkoutSessions.size > 0 || v.purchased)
      .sort((a, b) =>
        Number(b.checkoutSessions.size > 0 && !b.purchased) - Number(a.checkoutSessions.size > 0 && !a.purchased) ||
        b.sessions.size - a.sessions.size || b.atcEvents - a.atcEvents)
      .slice(0, 150)
      .map((v) => ({
        id: v.key.slice(0, 8),
        label: v.email ?? `Guest #${v.key.slice(0, 4)}`,
        visits: v.sessions.size,
        days: v.days.size,
        atcEvents: v.atcEvents,
        checkoutStarted: v.checkoutSessions.size > 0,
        purchased: v.purchased,
        cartValue: Math.round(v.cartValue),
        revenue: Math.round(v.revenue),
        city: v.city || 'Unknown',
        state: stateName(v),
        country: v.country || 'Unknown',
        device: v.device || 'Unknown',
        source: v.source || 'Unknown',
        firstSeen: v.firstSeen,
        lastSeen: v.lastSeen,
        products: Array.from(v.products.keys()).slice(0, 4).map((id) => pmap.get(id)?.name ?? 'Product'),
      }));

    const dailyRows = Array.from(daily.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, r]) => ({ day, ...r }));

    const body = {
      range: { from: f, to: t },
      generatedAt: new Date().toISOString(),
      truncated,
      needsMigration,
      hasGeoData: all.some((v) => !!v.country),
      totals: {
        atcEvents: atcEventsTotal,
        atcQty: atcQtyTotal,
        atcVisitors: carters.length,
        checkoutVisitors: all.filter((v) => v.checkoutSessions.size > 0).length,
        purchaseVisitors: all.filter((v) => v.purchased).length,
        orders: ordersTotal,
        revenue: Math.round(revenueTotal),
        abandonedVisitors: abandoned.length,
        abandonedValue: Math.round(abandoned.reduce((s, v) => s + v.cartValue, 0)),
        productViewVisitors: all.filter((v) => v.viewed).length,
      },
      funnel: [
        { name: 'Product dekha', value: sessionsViewed.size },
        { name: 'Add to cart', value: sessionsAtc.size },
        { name: 'Begin checkout', value: sessionsCo.size },
        { name: 'Order kiya', value: sessionsBuy.size },
      ],
      products: productRows,
      locations: { state: group(stateName), city: group((v) => v.city || 'Unknown'), country: group((v) => v.country || 'Unknown') },
      repeat: {
        newVisitors: all.length - repeatVisitors,
        repeatVisitors,
        repeatRate: all.length ? Math.round((repeatVisitors / all.length) * 1000) / 10 : 0,
        repeatNotBought,
        avgVisitsOfCarters: carters.length
          ? Math.round((carters.reduce((s, v) => s + v.sessions.size, 0) / carters.length) * 10) / 10
          : 0,
      },
      visitors: visitorRows,
      hourly,
      daily: dailyRows,
      devices: group((v) => v.device || 'Unknown'),
      sources: group((v) => v.source || 'Unknown'),
    };

    cache.set(cacheKey, { at: Date.now(), body });
    if (cache.size > 20) cache.delete(cache.keys().next().value as string);
    return NextResponse.json(body);
  } catch (err) {
    console.error('[admin/shopper-insights] failed:', err);
    return NextResponse.json({ error: 'Failed to load shopper insights' }, { status: 500 });
  }
}
