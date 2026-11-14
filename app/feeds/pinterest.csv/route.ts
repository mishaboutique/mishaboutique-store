import { NextResponse } from 'next/server';
import { loadItems, unavailable, get, getAll, stockText, unesc, FEED_HEADERS } from '@/lib/feed-derive';

export const dynamic = 'force-dynamic';

// Purana URL: /wp-content/uploads/woo-feed/pinterest/csv/pinterestcsvvfeed.csv
// Purane CSV ke 21 columns, wahi order (additional_image_link 5 baar).
const HEAD = [
  'id', 'title', 'description', 'item_group_id', 'link', 'product_type', 'google_product_category',
  'image_link', 'condition', 'availability', 'price', 'sale_price', 'mpn', 'brand', 'canonical_link',
  'additional_image_link', 'additional_image_link', 'additional_image_link', 'additional_image_link',
  'additional_image_link', 'identifier_exists',
];

function q(v: string): string {
  return '"' + unesc(v).replace(/\s*[\r\n]+\s*/g, ' ').replace(/"/g, '""') + '"';
}

export async function GET() {
  const items = await loadItems();
  if (!items) return unavailable();

  const lines: string[] = [HEAD.map((h) => '"' + h + '"').join(',')];
  for (const it of items) {
    const extra = getAll(it, 'additional_image_link');
    const row = [
      get(it, 'id'), get(it, 'title'), get(it, 'description'), get(it, 'item_group_id'),
      get(it, 'link'), get(it, 'product_type'), get(it, 'google_product_category'),
      get(it, 'image_link'), get(it, 'condition'), stockText(get(it, 'availability')),
      get(it, 'price'), get(it, 'sale_price'), get(it, 'mpn'), get(it, 'brand'),
      get(it, 'canonical_link'),
      extra[0] || '', extra[1] || '', extra[2] || '', extra[3] || '', extra[4] || '',
      get(it, 'identifier_exists'),
    ];
    lines.push(row.map(q).join(','));
  }

  return new NextResponse(lines.join('\n') + '\n', {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', ...FEED_HEADERS },
  });
}
