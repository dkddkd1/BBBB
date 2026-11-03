// 내 PC에서 실행하는 수집 워커.
// Supabase의 수집 대기열(regions.status = 'pending')을 확인하고,
// 구획 경계는 aside(네이버지도)로, 식당 목록은 공공데이터포털 소상공인 상가정보로 가져와 저장한다.
//   npm run worker            → 계속 대기하며 처리
//   npm run worker -- 연남동   → 그 구획 하나만 바로 수집
import { createClient } from "@supabase/supabase-js";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { fetchBoundaryWithAside } from "./aside.mjs";
import { fetchRestaurants } from "./stores.mjs";

const POLL_MS = 5000;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error(".env.local에 NEXT_PUBLIC_SUPABASE_URL과 SUPABASE_SECRET_KEY를 넣어주세요.");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

// aside가 폴리곤을 못 찾았을 때만 쓰는 대체 경계 (OpenStreetMap)
async function osmPolygon(name) {
  const q = new URLSearchParams({ q: name, countrycodes: "kr", polygon_geojson: "1", format: "jsonv2", limit: "5" });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${q}`, {
    headers: { "User-Agent": "bplpay-map-worker/1.0", "Accept-Language": "ko" },
  });
  if (!res.ok) return null;
  const hit = (await res.json()).find((h) => ["Polygon", "MultiPolygon"].includes(h.geojson?.type));
  return hit ? { polygon: hit.geojson, center: { lat: Number(hit.lat), lng: Number(hit.lon) } } : null;
}

async function processRegion(region) {
  const name = region.name;
  console.log(`\n[worker] ▶ ${name} 수집 시작`);
  const boundary = await fetchBoundaryWithAside(name).catch((e) => {
    console.warn(`[worker] aside 경계 수집 실패: ${e.message}`);
    return { displayName: null, polygon: null, center: null };
  });
  console.log(`[worker] aside: 폴리곤 ${boundary.polygon ? "있음" : "없음"}`);

  let { polygon, center } = boundary;
  if (!polygon) {
    const osm = await osmPolygon(name);
    if (!osm) throw new Error("구획 경계를 찾지 못했습니다 (네이버지도·OpenStreetMap 모두 실패)");
    console.log("[worker] 네이버 폴리곤이 없어 OpenStreetMap 경계로 대체합니다");
    ({ polygon } = osm);
    center ??= osm.center;
  }

  let places = await fetchRestaurants(polygon);
  console.log(`[worker] 상가정보 식당: ${places.length}곳`);
  // API 조회는 단순화한 폴리곤으로 하므로 원본 경계로 다시 거른다
  places = places.filter((p) => booleanPointInPolygon([p.lng, p.lat], polygon));
  console.log(`[worker] 구획 안: ${places.length}곳`);

  if (!center && places.length) {
    center = {
      lat: places.reduce((s, p) => s + p.lat, 0) / places.length,
      lng: places.reduce((s, p) => s + p.lng, 0) / places.length,
    };
  }

  // bplpay 컬럼은 건드리지 않으므로 재수집해도 사용자 응답이 유지된다
  const rows = places.map((p) => ({
    region_id: region.id,
    store_id: p.id,
    name: p.name,
    category: p.category,
    address: p.address,
    lat: p.lat,
    lng: p.lng,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from("restaurants").upsert(rows.slice(i, i + 500), { onConflict: "region_id,store_id" });
    if (error) throw new Error(`식당 저장 실패: ${error.message}`);
  }

  const { error } = await db
    .from("regions")
    .update({
      status: "done",
      error: null,
      display_name: boundary.displayName,
      polygon,
      center_lat: center?.lat ?? null,
      center_lng: center?.lng ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", region.id);
  if (error) throw new Error(`구획 저장 실패: ${error.message}`);
  console.log(`[worker] ✔ ${name} 완료`);
}

// 대기 중인 구획 하나를 'collecting'으로 바꾸며 가져온다 (여러 워커가 동시에 잡지 않도록)
async function claimNext() {
  const { data: next } = await db.from("regions").select("id").eq("status", "pending").order("created_at").limit(1);
  if (!next?.length) return null;
  const { data } = await db
    .from("regions")
    .update({ status: "collecting", updated_at: new Date().toISOString() })
    .eq("id", next[0].id)
    .eq("status", "pending")
    .select()
    .maybeSingle();
  return data;
}

async function handle(region) {
  try {
    await processRegion(region);
  } catch (e) {
    console.error(`[worker] ✖ ${region.name}: ${e.message}`);
    await db.from("regions").update({ status: "error", error: e.message.slice(0, 500), updated_at: new Date().toISOString() }).eq("id", region.id);
  }
}

const once = process.argv[2];
if (once) {
  const { data, error } = await db.rpc("request_region", { p_name: once });
  if (error) throw error;
  await db.from("regions").update({ status: "collecting" }).eq("id", data.id);
  await handle(data);
} else {
  // 이전 실행이 중간에 꺼져서 'collecting'에 멈춘 구획은 다시 대기열로
  await db.from("regions").update({ status: "pending" }).eq("status", "collecting");
  console.log("[worker] 수집 대기열을 확인하는 중입니다 (Ctrl+C로 종료)");
  for (;;) {
    const region = await claimNext().catch((e) => (console.error(e.message), null));
    if (region) await handle(region);
    else await new Promise((r) => setTimeout(r, POLL_MS));
  }
}
