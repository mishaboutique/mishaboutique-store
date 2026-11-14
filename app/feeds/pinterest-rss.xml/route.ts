import { NextResponse } from 'next/server';
import { fetchProductsServer } from '@/lib/products-api-server';
import { loadItems, unavailable, get, unesc, SITE_URL, FEED_HEADERS } from '@/lib/feed-derive';

export const dynamic = 'force-dynamic';

// Purana URL: /wp-content/uploads/woo-feed/pinterest_rss/xml/pinterestrssboard.xml
// Purane RSS mein per item: title, description, link, image, pubDate, guid (koi product id nahi).
function cdata(s: string): string {
  return '<![CDATA[' + unesc(s).replace(/\]\]>/g, ']]]]><![CDATA[>') + ']]>';
}

function rfc822(d: Date): string {
  return d.toUTCString().replace('GMT', '+0000');
}

export async function GET() {
  const items = await loadItems();
  if (!items) return unavailable();

  // pubDate: product ki created_at (slug se). Na mile to ek fixed purani date.
  const dates = new Map<string, string>();
  try {
    const products: any[] = (await fetchProductsServer()) as any[];
    for (const p of products) if (p.slug && p.created_at) dates.set(String(p.slug), String(p.created_at));
  } catch {
    /* dates khali rahengi, fallback chalega */
  }
  const fallback = new Date('2021-04-27T00:00:00Z');

  const parts: string[] = [];
  for (const it of items) {
    const link = unesc(get(it, 'link'));
    const m = link.match(/\/product\/([^/?#]+)/);
    const created = m ? dates.get(decodeURIComponent(m[1])) : undefined;
    const d = created && !isNaN(new Date(created).getTime()) ? new Date(created) : fallback;
    parts.push(
      '<item>\n' +
        '<title>' + cdata(get(it, 'title')) + '</title>\n' +
        '<description>' + cdata(get(it, 'description')) + '</description>\n' +
        '<link>' + cdata(link) + '</link>\n' +
        '<image>' + cdata(get(it, 'image_link')) + '</image>\n' +
        '<pubDate>' + cdata(rfc822(d)) + '</pubDate>\n' +
        '<guid>' + cdata(link) + '</guid>\n' +
        '</item>'
    );
  }

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" >\n<channel>\n' +
    '<title><![CDATA[ MISHABOUTIQUE ]]></title>\n' +
    '<link><![CDATA[ ' + SITE_URL + ' ]]></link>\n' +
    '<description>Pinterest RSS</description>\n' +
    '<lastBuildDate>' + new Date().toISOString().slice(0, 19).replace('T', ' ') + '</lastBuildDate>\n' +
    parts.join('\n') + '\n</channel>\n</rss>';

  return new NextResponse(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', ...FEED_HEADERS },
  });
}
