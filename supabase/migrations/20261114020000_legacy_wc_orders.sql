-- Legacy WooCommerce orders: read-only archive imported from the old store dump.
-- Service role only. No triggers, no webhooks; nothing here sends any notification.

create table if not exists public.legacy_wc_orders (
  id bigint primary key,
  status text,
  currency text,
  type text,
  tax_amount numeric(26,8),
  total_amount numeric(26,8),
  customer_id bigint,
  billing_email text,
  date_created_gmt timestamptz,
  date_updated_gmt timestamptz,
  parent_order_id bigint,
  payment_method text,
  payment_method_title text,
  transaction_id text,
  customer_note text
);

create table if not exists public.legacy_wc_order_operational_data (
  order_id bigint primary key,
  date_paid_gmt timestamptz,
  date_completed_gmt timestamptz,
  shipping_total_amount numeric(26,8),
  shipping_tax_amount numeric(26,8),
  discount_total_amount numeric(26,8)
);

create table if not exists public.legacy_wc_order_items (
  order_item_id bigint primary key,
  order_id bigint not null,
  order_item_name text,
  order_item_type text
);

create table if not exists public.legacy_wc_order_itemmeta (
  meta_id bigint primary key,
  order_item_id bigint not null,
  meta_key text,
  meta_value text
);

create table if not exists public.legacy_wc_order_addresses (
  id bigint primary key,
  order_id bigint not null,
  address_type text,
  first_name text,
  last_name text,
  company text,
  address_1 text,
  address_2 text,
  city text,
  state text,
  postcode text,
  country text,
  email text,
  phone text
);

create index if not exists legacy_wc_orders_status_idx on public.legacy_wc_orders (status);
create index if not exists legacy_wc_orders_type_idx on public.legacy_wc_orders (type);
create index if not exists legacy_wc_orders_created_idx on public.legacy_wc_orders (date_created_gmt desc);
create index if not exists legacy_wc_orders_email_idx on public.legacy_wc_orders (lower(billing_email));
create index if not exists legacy_wc_orders_parent_idx on public.legacy_wc_orders (parent_order_id);
create index if not exists legacy_wc_order_items_order_idx on public.legacy_wc_order_items (order_id, order_item_type);
create index if not exists legacy_wc_order_itemmeta_item_idx on public.legacy_wc_order_itemmeta (order_item_id, meta_key);
create index if not exists legacy_wc_order_addresses_order_idx on public.legacy_wc_order_addresses (order_id);
create index if not exists legacy_wc_order_addresses_email_idx on public.legacy_wc_order_addresses (lower(email));

do $$
declare t text;
begin
  foreach t in array array[
    'legacy_wc_orders',
    'legacy_wc_order_operational_data',
    'legacy_wc_order_items',
    'legacy_wc_order_itemmeta',
    'legacy_wc_order_addresses'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "service_role only" on public.%I', t);
    execute format('create policy "service_role only" on public.%I for all to service_role using (true) with check (true)', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

create or replace function public.legacy_wc_admin_status_stats()
returns table(status text, orders bigint, total_value numeric)
language sql
stable
set search_path = public
as $$
  select coalesce(o.status, '') as status,
         count(*)::bigint as orders,
         coalesce(sum(o.total_amount), 0)::numeric as total_value
  from public.legacy_wc_orders o
  where o.type = 'shop_order'
  group by coalesce(o.status, '')
  order by count(*) desc;
$$;

create or replace function public.legacy_wc_admin_search_orders(
  p_q text default '',
  p_status text default '',
  p_limit int default 20,
  p_offset int default 0
)
returns table(order_id bigint, total_count bigint)
language sql
stable
set search_path = public
as $$
  with prm as (
    select nullif(trim(coalesce(p_q, '')), '') as q,
           nullif(trim(coalesce(p_status, '')), '') as st
  ), pat as (
    select q, st,
           '%' || replace(replace(replace(coalesce(q, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%' as p
    from prm
  )
  select o.id as order_id,
         (count(*) over ())::bigint as total_count
  from public.legacy_wc_orders o, pat
  where o.type = 'shop_order'
    and (pat.st is null or pat.st = 'all' or o.status = pat.st or o.status = 'wc-' || pat.st)
    and (
      pat.q is null
      or o.id::text = pat.q
      or o.billing_email ilike pat.p
      or o.transaction_id ilike pat.p
      or exists (
        select 1 from public.legacy_wc_order_addresses a
        where a.order_id = o.id
          and (
            a.email ilike pat.p
            or a.phone ilike pat.p
            or (coalesce(a.first_name, '') || ' ' || coalesce(a.last_name, '')) ilike pat.p
          )
      )
    )
  order by o.date_created_gmt desc nulls last, o.id desc
  limit greatest(1, least(coalesce(p_limit, 20), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke execute on function public.legacy_wc_admin_status_stats() from public, anon, authenticated;
revoke execute on function public.legacy_wc_admin_search_orders(text, text, int, int) from public, anon, authenticated;
grant execute on function public.legacy_wc_admin_status_stats() to service_role;
grant execute on function public.legacy_wc_admin_search_orders(text, text, int, int) to service_role;