"use client";

// Supabase 없이 지도·마커 표시를 확인하는 데모 화면 (응답은 이 브라우저에서만 바뀐다)
import dynamic from "next/dynamic";
import { useState } from "react";
import type { Region, Restaurant } from "@/lib/types";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

const region: Region = {
  id: "demo",
  name: "데모구획",
  display_name: "데모 구획",
  polygon: {
    type: "Polygon",
    coordinates: [[[126.9205, 37.5595], [126.9285, 37.5595], [126.9285, 37.5655], [126.9205, 37.5655], [126.9205, 37.5595]]],
  },
  center_lat: 37.5625,
  center_lng: 126.9245,
  status: "done",
  error: null,
};

const seed: Restaurant[] = [
  ["가능 예시 식당", "한식", 37.5615, 126.9225, "yes"],
  ["불가능 예시 식당", "중식", 37.5635, 126.9255, "no"],
  ["미확인 예시 식당", "분식", 37.5605, 126.9265, null],
  ["미확인 예시 식당 2", "일식", 37.5645, 126.9215, null],
].map(([name, category, lat, lng, bplpay], i) => ({
  id: String(i),
  region_id: "demo",
  store_id: String(i),
  name: name as string,
  category: category as string,
  address: null,
  lat: lat as number,
  lng: lng as number,
  bplpay: bplpay as Restaurant["bplpay"],
  bplpay_updated_at: null,
}));

export default function Demo() {
  const [list, setList] = useState(seed);
  return (
    <main className="app">
      <header className="topbar">
        <div className="status">데모: 실제 데이터 없이 마커 표시만 확인합니다</div>
      </header>
      <MapView region={region} restaurants={list} onVote={(id, s) => setList((l) => l.map((r) => (r.id === id ? { ...r, bplpay: s } : r)))} />
    </main>
  );
}
