'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ShoppingCart, CreditCard, CheckCircle2, Users, Repeat, MapPin, Lightbulb, RefreshCw,
  AlertTriangle, Download, IndianRupee, PackageSearch,
} from 'lucide-react';
import { startOfDay, endOfDay, subDays, format } from 'date-fns';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { DateRangePicker, SimpleRange } from '@/components/admin/date-range-picker';
import { formatINR } from '@/lib/format';
import {
  fetchShopperInsights, ShopperInsights, LocationRow, VisitorRow,
} from '@/lib/shopper-insights-api';

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

function Card({ icon, label, value, hint, tone }: {
  icon: React.ReactNode; label: string; value: string | number; hint?: string; tone?: 'warn' | 'good';
}) {
  const cls = tone === 'warn' ? 'border-amber-300 bg-amber-50' : tone === 'good' ? 'border-emerald-300 bg-emerald-50' : 'border-border/60 bg-card';
  return (
    <div className={`min-w-0 rounded-xl border p-3 shadow-sm sm:p-4 ${cls}`}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon}<span className="truncate">{label}</span></div>
      <p className="mt-2 truncate text-lg font-semibold sm:text-xl">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-serif text-lg font-bold text-primary">{title}</h3>
        {right}
      </div>
      {children}
    </div>
  );
}

function Pills<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-lg border border-border/60 bg-muted/40 p-0.5">
      {options.map((o) => (
        <button key={o.id} type="button" onClick={() => onChange(o.id)}
          className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium ${value === o.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function LocationTable({ rows }: { rows: LocationRow[] }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">Is period me data nahi hai.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-2 pr-3">Naam</th><th className="px-2 text-right">Visitors</th><th className="px-2 text-right">Cart</th>
            <th className="px-2 text-right">Checkout</th><th className="px-2 text-right">Order</th><th className="pl-2 text-right">Cart→Order</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-b border-border/40">
              <td className="py-2 pr-3 font-medium">{r.name}</td>
              <td className="px-2 text-right">{r.visitors}</td>
              <td className="px-2 text-right">{r.carted}</td>
              <td className="px-2 text-right">{r.checkout}</td>
              <td className="px-2 text-right">{r.purchased}</td>
              <td className="pl-2 text-right text-muted-foreground">{pct(r.purchased, r.carted)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function buildSuggestions(d: ShopperInsights): string[] {
  const out: string[] = [];
  const t = d.totals;
  const atcToCo = pct(t.checkoutVisitors, t.atcVisitors);
  const coToBuy = pct(t.purchaseVisitors, t.checkoutVisitors);

  if (t.atcVisitors >= 10 && atcToCo < 40)
    out.push(`Cart me daalne wale sirf ${atcToCo}% log checkout tak ja rahe hain. Cart page pe shipping charge / delivery time / COD available clearly dikhao, aur "free shipping above ₹X" bar lagao.`);
  if (t.checkoutVisitors >= 5 && coToBuy < 50)
    out.push(`${t.abandonedVisitors} log checkout tak aaye par order nahi kiya (≈ ${formatINR(t.abandonedValue)} ka cart). Checkout me form chhota rakho, COD/UPI option upar dikhao, aur Abandoned Carts se WhatsApp/email recovery bhejo.`);

  const leaky = d.products.filter((p) => p.atcVisitors >= 3 && pct(p.checkoutVisitors, p.atcVisitors) < 30).slice(0, 3);
  if (leaky.length)
    out.push(`Ye products cart me jaate hain par checkout tak nahi pahunchte: ${leaky.map((p) => p.name).join(', ')}. Inki price, shipping ya size info check karo.`);

  const lowAtc = d.products.filter((p) => p.views >= 20 && pct(p.atcVisitors, p.views) < 3).slice(0, 3);
  if (lowAtc.length)
    out.push(`Ye products bahut dekhe gaye par cart me kam gaye: ${lowAtc.map((p) => p.name).join(', ')}. Photos/video, price, size chart ya reviews improve karo.`);

  const hot = d.products.filter((p) => p.atcVisitors >= 3).sort((a, b) => b.atcVisitors - a.atcVisitors).slice(0, 3);
  if (hot.length)
    out.push(`Sabse jyada cart me gaye: ${hot.map((p) => `${p.name} (${p.atcVisitors})`).join(', ')}. Inka stock ready rakho aur ads/Instagram posts me push karo.`);

  const cities = d.locations.city.filter((c) => c.name !== 'Unknown');
  const cityStuck = cities.filter((c) => c.carted >= 3 && c.purchased === 0).slice(0, 3);
  if (cityStuck.length)
    out.push(`${cityStuck.map((c) => c.name).join(', ')} se log cart/checkout karte hain par order 0 hai. Wahan COD/delivery pincode ya shipping charge ki problem ho sakti hai.`);
  const bestState = d.locations.state.filter((s) => s.name !== 'Unknown' && s.purchased > 0).sort((a, b) => b.purchased - a.purchased)[0];
  if (bestState)
    out.push(`${bestState.name} se sabse jyada orders (${bestState.purchased}) aa rahe hain. Facebook/Google ads me is state ko alag campaign/budget do.`);

  if (d.repeat.repeatNotBought > 0)
    out.push(`${d.repeat.repeatNotBought} log 2+ baar wapas aaye, cart/checkout kiya par kharida nahi. Ye sabse garam leads hain. Visitors table se unhe WhatsApp pe chhota coupon ya "stock kam hai" message bhejo.`);
  if (t.atcVisitors >= 10 && d.repeat.avgVisitsOfCarters >= 1.5)
    out.push(`Cart karne wale log average ${d.repeat.avgVisitsOfCarters} baar aate hain, matlab sochke kharidte hain. Retargeting ads aur abandoned-cart reminder 1-2 ghante baad bhejna kaam karega.`);

  const peak = [...d.hourly].sort((a, b) => b.atc - a.atc)[0];
  if (peak && peak.atc >= 3)
    out.push(`Cart sabse jyada ${peak.hour}:00-${peak.hour + 1}:00 (IST) ke beech hota hai. Ads aur WhatsApp/email broadcast usse 30-60 minute pehle bhejo.`);

  const src = d.sources.filter((s) => s.name !== 'Unknown' && s.carted >= 3).sort((a, b) => pct(b.purchased, b.carted) - pct(a.purchased, a.carted))[0];
  if (src)
    out.push(`Best converting source: "${src.name}" (cart se order ${pct(src.purchased, src.carted)}%). Isi source pe marketing budget badhao.`);

  const mob = d.devices.find((x) => x.name === 'mobile');
  const desk = d.devices.find((x) => x.name === 'desktop');
  if (mob && desk && mob.carted >= 10 && desk.carted >= 5 && pct(mob.purchased, mob.carted) + 10 < pct(desk.purchased, desk.carted))
    out.push(`Mobile pe cart→order (${pct(mob.purchased, mob.carted)}%) desktop (${pct(desk.purchased, desk.carted)}%) se kam hai. Mobile checkout page speed aur buttons check karo.`);

  if (!out.length) out.push('Abhi suggestion ke liye kaafi data nahi hai. Thoda aur data aane do ya date range badhao.');
  return out;
}

function downloadCsv(rows: VisitorRow[]) {
  const head = ['Visitor', 'Visits', 'Days', 'Add to cart', 'Checkout', 'Purchased', 'Cart value', 'City', 'State', 'Country', 'Device', 'Source', 'Last seen', 'Products'];
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = rows.map((r) => [r.label, r.visits, r.days, r.atcEvents, r.checkoutStarted ? 'Yes' : 'No', r.purchased ? 'Yes' : 'No', r.cartValue, r.city, r.state, r.country, r.device, r.source, r.lastSeen, r.products.join(' | ')].map(esc).join(','));
  const blob = new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `shopper-insights-${format(new Date(), 'yyyy-MM-dd')}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

type View = 'products' | 'location' | 'visitors' | 'time';

/**
 * Admin > Analytics > Shopper Insights. Answers:
 *  - kitna product add to cart hua, kitna begin checkout hua, kitna order
 *  - kahan (state/city) se hua
 *  - same banda kitni baar wapas aaya
 * Data: activity_events table only (free-tier friendly). API: /api/admin/shopper-insights
 */
export default function ShopperInsightsPanel() {
  const [range, setRange] = useState<SimpleRange>(() => ({ from: startOfDay(subDays(new Date(), 6)), to: endOfDay(new Date()) }));
  const [data, setData] = useState<ShopperInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('products');
  const [locBy, setLocBy] = useState<'state' | 'city' | 'country'>('state');
  const [vFilter, setVFilter] = useState<'all' | 'repeat' | 'hot'>('all');

  const load = useCallback(() => {
    setLoading(true);
    fetchShopperInsights(range.from, range.to)
      .then(setData)
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [range]);

  useEffect(() => { load(); }, [load]);

  const suggestions = useMemo(() => (data ? buildSuggestions(data) : []), [data]);
  const visitors = useMemo(() => {
    if (!data) return [];
    if (vFilter === 'repeat') return data.visitors.filter((v) => v.visits >= 2);
    if (vFilter === 'hot') return data.visitors.filter((v) => v.checkoutStarted && !v.purchased);
    return data.visitors;
  }, [data, vFilter]);

  const header = (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">Cart, checkout, location aur repeat visitors, date ke hisaab se.</p>
      <div className="flex items-center gap-2">
        <DateRangePicker value={range} onChange={setRange} />
        <button type="button" onClick={load} disabled={loading}
          className="flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-sm hover:bg-muted disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>
    </div>
  );

  if (loading && !data) {
    return (
      <div>
        {header}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-lg" />)}</div>
        <Skeleton className="mt-4 h-72 rounded-lg" />
      </div>
    );
  }
  if (!data) return <div>{header}<p className="text-sm text-muted-foreground">Data load nahi ho paya.</p></div>;

  const t = data.totals;
  const funnelMax = Math.max(1, ...data.funnel.map((f) => f.value));
  const hourMax = Math.max(1, ...data.hourly.map((h) => h.atc));

  return (
    <div className={`grid grid-cols-1 gap-4 [&>*]:min-w-0 ${loading ? 'opacity-60' : ''}`}>
      {header}

      {data.needsMigration && (
        <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Location / repeat visitor / device data ke liye Supabase me migration <b>20261115000000_shopper_insights_tracking.sql</b> run karo. Tab tak cart/checkout ginti dikhegi, par location aur repeat data nahi.</span>
        </div>
      )}
      {!data.needsMigration && !data.hasGeoData && (
        <div className="flex gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Location data naye visitors se aana shuru hoga (Vercel pe deploy ke baad). Purane events me location nahi hoti.</span>
        </div>
      )}
      {data.truncated && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Data bahut zyada tha, isliye sirf shuruaati events gine gaye. Chhota date range chuno.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card icon={<ShoppingCart className="h-3.5 w-3.5" />} label="Add to cart (clicks)" value={t.atcEvents} hint={`${t.atcVisitors} alag log, ${t.atcQty} pieces`} />
        <Card icon={<CreditCard className="h-3.5 w-3.5" />} label="Begin checkout (log)" value={t.checkoutVisitors} hint={`Cart→Checkout ${pct(t.checkoutVisitors, t.atcVisitors)}%`} />
        <Card icon={<CheckCircle2 className="h-3.5 w-3.5" />} label="Order kiya (log)" value={t.purchaseVisitors} hint={`Checkout→Order ${pct(t.purchaseVisitors, t.checkoutVisitors)}% · ${formatINR(t.revenue)}`} tone="good" />
        <Card icon={<IndianRupee className="h-3.5 w-3.5" />} label="Checkout chhoda (abandoned)" value={t.abandonedVisitors} hint={`≈ ${formatINR(t.abandonedValue)} ka cart`} tone={t.abandonedVisitors ? 'warn' : undefined} />
        <Card icon={<Users className="h-3.5 w-3.5" />} label="Product dekhne wale" value={t.productViewVisitors} />
        <Card icon={<Repeat className="h-3.5 w-3.5" />} label="Wapas aane wale" value={data.repeat.repeatVisitors} hint={`${data.repeat.repeatRate}% visitors · naye ${data.repeat.newVisitors}`} />
        <Card icon={<Repeat className="h-3.5 w-3.5" />} label="Repeat par bhi nahi kharida" value={data.repeat.repeatNotBought} hint="Sabse garam leads" tone={data.repeat.repeatNotBought ? 'warn' : undefined} />
        <Card icon={<Users className="h-3.5 w-3.5" />} label="Cart walon ke avg visits" value={data.repeat.avgVisitsOfCarters} />
      </div>

      <Section title="Funnel (sessions)">
        <div className="grid gap-2">
          {data.funnel.map((f, i) => (
            <div key={f.name}>
              <div className="mb-0.5 flex justify-between text-xs">
                <span className="font-medium">{f.name}</span>
                <span className="text-muted-foreground">{f.value}{i > 0 && ` · pichle step se ${pct(f.value, data.funnel[i - 1].value)}%`}</span>
              </div>
              <div className="h-5 rounded bg-muted">
                <div className="h-5 rounded bg-primary/80" style={{ width: `${Math.max(2, (f.value / funnelMax) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Kya karein? (marketing suggestions)" right={<Lightbulb className="h-4 w-4 text-amber-500" />}>
        <ul className="grid gap-2 text-sm">
          {suggestions.map((s, i) => (
            <li key={i} className="rounded-lg bg-muted/50 p-2.5">{s}</li>
          ))}
        </ul>
      </Section>

      <Pills value={view} onChange={setView} options={[
        { id: 'products', label: 'Products' }, { id: 'location', label: 'Location' },
        { id: 'visitors', label: 'Visitors / Repeat' }, { id: 'time', label: 'Time, Device, Source' },
      ]} />

      {view === 'products' && (
        <Section title="Product wise: kitna cart / checkout" right={<PackageSearch className="h-4 w-4 text-muted-foreground" />}>
          {data.products.length === 0 ? <p className="text-sm text-muted-foreground">Is period me koi product cart me nahi gaya.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3">Product</th><th className="px-2 text-right">Views</th><th className="px-2 text-right">Cart (clicks)</th>
                    <th className="px-2 text-right">Cart (log)</th><th className="px-2 text-right">Checkout (log)</th>
                    <th className="px-2 text-right">View→Cart</th><th className="pl-2 text-right">Cart→Checkout</th>
                  </tr>
                </thead>
                <tbody>
                  {data.products.map((p) => (
                    <tr key={p.productId} className="border-b border-border/40 align-top">
                      <td className="py-2 pr-3">
                        <p className="font-medium">{p.name}</p>
                        {p.colors.length > 0 && <p className="text-[11px] text-muted-foreground">{p.colors.map((c) => `${c.name} ${c.value}`).join(' · ')}</p>}
                      </td>
                      <td className="px-2 text-right">{p.views}</td>
                      <td className="px-2 text-right">{p.atcEvents}</td>
                      <td className="px-2 text-right">{p.atcVisitors}</td>
                      <td className="px-2 text-right">{p.checkoutVisitors}</td>
                      <td className="px-2 text-right text-muted-foreground">{pct(p.atcVisitors, p.views)}%</td>
                      <td className="pl-2 text-right text-muted-foreground">{pct(p.checkoutVisitors, p.atcVisitors)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}

      {view === 'location' && (
        <Section title="Kahan se aaye" right={<Pills value={locBy} onChange={setLocBy} options={[{ id: 'state', label: 'State' }, { id: 'city', label: 'City' }, { id: 'country', label: 'Country' }]} />}>
          <LocationTable rows={data.locations[locBy]} />
        </Section>
      )}

      {view === 'visitors' && (
        <Section
          title="Kaun kitni baar aaya"
          right={
            <div className="flex items-center gap-2">
              <Pills value={vFilter} onChange={setVFilter} options={[{ id: 'all', label: 'Sab' }, { id: 'repeat', label: '2+ baar aaye' }, { id: 'hot', label: 'Checkout chhoda' }]} />
              <button type="button" onClick={() => downloadCsv(visitors)} className="flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-xs hover:bg-muted">
                <Download className="h-3 w-3" /> CSV
              </button>
            </div>
          }
        >
          {visitors.length === 0 ? <p className="text-sm text-muted-foreground">Is filter me koi visitor nahi.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3">Visitor</th><th className="px-2 text-right">Visits</th><th className="px-2 text-right">Din</th>
                    <th className="px-2 text-right">Cart</th><th className="px-2">Status</th><th className="px-2">Location</th>
                    <th className="px-2">Device · Source</th><th className="px-2">Last seen</th><th className="pl-2">Products</th>
                  </tr>
                </thead>
                <tbody>
                  {visitors.map((v) => (
                    <tr key={v.id + v.firstSeen} className="border-b border-border/40 align-top">
                      <td className="py-2 pr-3 font-medium">{v.label}</td>
                      <td className="px-2 text-right">{v.visits}</td>
                      <td className="px-2 text-right">{v.days}</td>
                      <td className="px-2 text-right">{v.atcEvents}</td>
                      <td className="px-2 whitespace-nowrap">
                        {v.purchased ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">Order kiya</span>
                          : v.checkoutStarted ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Checkout chhoda {v.cartValue ? `· ${formatINR(v.cartValue)}` : ''}</span>
                          : <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Sirf cart</span>}
                      </td>
                      <td className="px-2 whitespace-nowrap">{[v.city, v.state].filter((x) => x !== 'Unknown').join(', ') || 'Unknown'}</td>
                      <td className="px-2 whitespace-nowrap text-muted-foreground">{v.device} · {v.source}</td>
                      <td className="px-2 whitespace-nowrap text-muted-foreground">{format(new Date(v.lastSeen), 'dd MMM, hh:mm a')}</td>
                      <td className="pl-2 text-xs text-muted-foreground">{v.products.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">Visitor ek browser hota hai. Agar koi alag phone/browser use kare to alag gina jayega. Email sirf tab dikhta hai jab usne order kiya ho.</p>
        </Section>
      )}

      {view === 'time' && (
        <>
          <Section title="Din ke kaunse ghante me cart hota hai (IST)">
            <div className="flex h-32 items-end gap-0.5">
              {data.hourly.map((h) => (
                <div key={h.hour} className="flex flex-1 flex-col items-center justify-end" title={`${h.hour}:00 · cart ${h.atc} · checkout ${h.checkout}`}>
                  <div className="w-full rounded-t bg-primary/80" style={{ height: `${(h.atc / hourMax) * 100}%`, minHeight: h.atc ? 2 : 0 }} />
                  <span className="mt-1 text-[9px] text-muted-foreground">{h.hour % 3 === 0 ? h.hour : ''}</span>
                </div>
              ))}
            </div>
          </Section>
          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Device"><LocationTable rows={data.devices} /></Section>
            <Section title="Source (kahan se aaye)"><LocationTable rows={data.sources} /></Section>
          </div>
          <Section title="Roz ka trend">
            {data.daily.length === 0 ? <p className="text-sm text-muted-foreground">Data nahi.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2">Din</th><th className="text-right">Cart</th><th className="text-right">Checkout</th><th className="text-right">Order</th></tr></thead>
                  <tbody>
                    {[...data.daily].reverse().map((d) => (
                      <tr key={d.day} className="border-b border-border/40"><td className="py-1.5">{d.day}</td><td className="text-right">{d.atc}</td><td className="text-right">{d.checkout}</td><td className="text-right">{d.purchase}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
