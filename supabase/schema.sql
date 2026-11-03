-- 비플페이 지도 스키마. Supabase SQL Editor에 그대로 붙여 넣어 실행합니다.

create extension if not exists pgcrypto;

-- 구획(동·지명). 사용자가 입력한 이름 하나가 한 행이다.
create table if not exists regions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,              -- 정규화된 입력값 (공백 제거)
  display_name text,                      -- 네이버지도에서 확인된 정식 명칭
  polygon jsonb,                          -- GeoJSON Polygon | MultiPolygon ([lng, lat] 순서)
  center_lat double precision,
  center_lng double precision,
  status text not null default 'pending'
    check (status in ('pending', 'collecting', 'done', 'error')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists restaurants (
  id uuid primary key default gen_random_uuid(),
  region_id uuid not null references regions(id) on delete cascade,
  store_id text not null,                 -- 소상공인 상가정보 상가업소번호(bizesId)
  name text not null,
  category text,
  address text,
  lat double precision not null,
  lng double precision not null,
  bplpay text check (bplpay in ('yes', 'no')),   -- null = 아직 아무도 응답하지 않음
  bplpay_updated_at timestamptz,
  created_at timestamptz not null default now(),
  unique (region_id, store_id)
);

create index if not exists restaurants_region_idx on restaurants(region_id);

-- 응답 이력 (화면 표시는 restaurants.bplpay = 최신 응답만 사용)
create table if not exists bplpay_votes (
  id bigint generated always as identity primary key,
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  status text not null check (status in ('yes', 'no')),
  created_at timestamptz not null default now()
);

-- RLS: 익명 사용자는 읽기만 하고, 쓰기는 아래 함수 두 개로만 한다.
alter table regions enable row level security;
alter table restaurants enable row level security;
alter table bplpay_votes enable row level security;

drop policy if exists "read regions" on regions;
create policy "read regions" on regions for select using (true);
drop policy if exists "read restaurants" on restaurants;
create policy "read restaurants" on restaurants for select using (true);

-- 새 구획 수집 요청. 이미 있으면 그 행을 돌려준다. 실패한 구획은 다시 대기열에 올린다.
create or replace function request_region(p_name text)
returns regions
language plpgsql security definer set search_path = public
as $$
declare
  v_name text := regexp_replace(trim(p_name), '\s+', '', 'g');
  v_row regions;
begin
  if v_name = '' or length(v_name) > 40 then
    raise exception 'invalid region name';
  end if;
  insert into regions(name) values (v_name)
  on conflict (name) do update
    set status = case when regions.status = 'error' then 'pending' else regions.status end,
        error = case when regions.status = 'error' then null else regions.error end,
        updated_at = now()
  returning * into v_row;
  return v_row;
end $$;

-- 비플페이 가능/불가능 응답. 최신 응답이 화면 표시를 덮어쓴다.
create or replace function set_bplpay(p_restaurant_id uuid, p_status text)
returns restaurants
language plpgsql security definer set search_path = public
as $$
declare
  v_row restaurants;
begin
  if p_status not in ('yes', 'no') then
    raise exception 'invalid status';
  end if;
  update restaurants
     set bplpay = p_status, bplpay_updated_at = now()
   where id = p_restaurant_id
  returning * into v_row;
  if v_row.id is null then
    raise exception 'restaurant not found';
  end if;
  insert into bplpay_votes(restaurant_id, status) values (p_restaurant_id, p_status);
  return v_row;
end $$;

grant execute on function request_region(text) to anon, authenticated;
grant execute on function set_bplpay(uuid, text) to anon, authenticated;

-- 모든 접속자 화면에 실시간 반영
do $$
begin
  alter publication supabase_realtime add table restaurants;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table regions;
exception when duplicate_object then null;
end $$;
