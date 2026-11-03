// 공공데이터포털 "소상공인시장진흥공단_상가(상권)정보" API로 폴리곤 안의 음식점을 가져온다.
// https://www.data.go.kr/data/15012005/openapi.do
import simplify from "@turf/simplify";

const ENDPOINT = "https://apis.data.go.kr/B553077/api/open/sdsc2/storeListInPolygon";
const PAGE_SIZE = 1000;
const MAX_POINTS = 150; // WKT가 URL에 들어가므로 꼭짓점 수를 줄인다

// 대분류 I2(음식) 중 식당이 아닌 중분류: I211 주점, I212 비알코올(카페)
const EXCLUDED_MCLS = new Set(["I211", "I212"]);

function serviceKey() {
  const key = process.env.DATA_GO_KR_KEY;
  if (!key) throw new Error(".env.local에 DATA_GO_KR_KEY(공공데이터포털 인증키)를 넣어주세요");
  // "Encoding" 키를 붙여 넣어도 이중 인코딩되지 않도록
  return key.includes("%") ? decodeURIComponent(key) : key;
}

/** 링 하나를 WKT용으로 줄인다 (조회 범위가 조금 넓어지는 쪽이 안전하므로, 정확한 판정은 원본 폴리곤으로 다시 한다) */
function toWkt(ring) {
  let coords = ring;
  for (let tol = 0.00002; coords.length > MAX_POINTS && tol < 0.01; tol *= 2) {
    coords = simplify({ type: "Polygon", coordinates: [ring] }, { tolerance: tol, highQuality: true }).coordinates[0];
  }
  return `POLYGON((${coords.map(([x, y]) => `${x.toFixed(6)} ${y.toFixed(6)}`).join(", ")}))`;
}

async function fetchPage(wkt, pageNo) {
  const q = new URLSearchParams({
    serviceKey: serviceKey(),
    pageNo: String(pageNo),
    numOfRows: String(PAGE_SIZE),
    key: wkt,
    indsLclsCd: "I2",
    type: "json",
  });
  const res = await fetch(`${ENDPOINT}?${q}`);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    // 인증키 오류 등은 XML로 온다
    const msg = text.match(/<returnAuthMsg>([^<]+)/)?.[1] ?? text.match(/<resultMsg>([^<]+)/)?.[1] ?? text.slice(0, 200);
    throw new Error(`상가정보 API 오류 (HTTP ${res.status}): ${msg}`);
  }
  const authErr = data.OpenAPI_ServiceResponse?.cmmMsgHeader;
  if (authErr) throw new Error(`공공데이터포털 인증 오류: ${authErr.returnAuthMsg ?? authErr.errMsg}`);
  const code = data.header?.resultCode;
  if (code === "03") return { items: [], total: 0 }; // 데이터 없음
  if (code !== "00") throw new Error(`상가정보 API 오류 ${code}: ${data.header?.resultMsg}`);
  return { items: data.body?.items ?? [], total: Number(data.body?.totalCount ?? 0) };
}

/** GeoJSON Polygon | MultiPolygon 안의 식당 목록 */
export async function fetchRestaurants(polygon) {
  const rings = polygon.type === "MultiPolygon" ? polygon.coordinates.map((p) => p[0]) : [polygon.coordinates[0]];
  const byId = new Map();
  for (const ring of rings) {
    const wkt = toWkt(ring);
    for (let page = 1; ; page++) {
      const { items, total } = await fetchPage(wkt, page);
      for (const it of items) {
        if (EXCLUDED_MCLS.has(it.indsMclsCd)) continue;
        const lat = Number(it.lat);
        const lng = Number(it.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        byId.set(it.bizesId, {
          id: it.bizesId,
          name: [it.bizesNm, it.brchNm].filter(Boolean).join(" "),
          category: [it.indsMclsNm, it.indsSclsNm].filter(Boolean).join(" > "),
          address: it.rdnmAdr || it.lnoAdr || null,
          lat,
          lng,
        });
      }
      if (items.length < PAGE_SIZE || page * PAGE_SIZE >= total) break;
    }
  }
  return [...byId.values()];
}
