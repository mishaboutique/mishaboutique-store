import { NextResponse } from 'next/server';
import { loadItems, unavailable, get, getAll, stockText, SITE_URL, FEED_HEADERS } from '@/lib/feed-derive';

export const dynamic = 'force-dynamic';

// Purana URL: /wp-content/uploads/woo-feed/facebook/xml/facebook-feed.xml
const UTM = 'utm_source=Facebook+Catalog+%2F+Instagram&amp;utm_medium=cpc&amp;utm_campaign=Facebook+Feed';

export async function GET() {
  const items = await loadItems();
  if (!items) return unavailable();

  const parts: string[] = [];
  for (const it of items) {
    const L: string[] = [];
    const t = (n: string, v: string) => { if (v) L.push('<g:' + n + '>' + v + '</g:' + n + '>'); };
    const link = get(it, 'link');
    t('id', get(it, 'id'));
    t('title', get(it, 'title'));
    t('description', get(it, 'description'));
    t('item_group_id', get(it, 'item_group_id'));
    t('link', link + (link.includes('?') ? '&amp;' : '?') + UTM);
    t('product_type', get(it, 'product_type'));
    t('google_product_category', get(it, 'google_product_category'));
    t('image_link', get(it, 'image_link'));
    for (const x of getAll(it, 'additional_image_link').slice(0, 10)) t('additional_image_link', x);
    t('condition', get(it, 'condition'));
    t('availability', stockText(get(it, 'availability')));
    t('price', get(it, 'price'));
    t('sale_price', get(it, 'sale_price'));
    t('brand', get(it, 'brand'));
    t('mpn', get(it, 'mpn'));
    t('gtin', get(it, 'gtin'));
    t('color', get(it, 'color'));
    t('age_group', get(it, 'age_group'));
    t('gender', get(it, 'gender'));
    t('size', get(it, 'size'));
    t('pattern', get(it, 'pattern'));
    t('material', get(it, 'material'));
    t('identifier_exists', get(it, 'identifier_exists'));
    parts.push('<item>\n' + L.join('\n') + '\n</item>');
  }

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">\n<channel>\n' +
    '<title>MISHABOUTIQUE</title>\n<link>' + SITE_URL + '</link>\n' +
    '<description>Misha Boutique Facebook / Instagram catalog feed</description>\n' +
    parts.join('\n') + '\n</channel>\n</rss>';

  return new NextResponse(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', ...FEED_HEADERS },
  });
}
