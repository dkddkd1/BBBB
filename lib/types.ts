import type { Geometry } from "geojson";

export type RegionStatus = "pending" | "collecting" | "done" | "error";
export type Bplpay = "yes" | "no" | null;

export interface Region {
  id: string;
  name: string;
  display_name: string | null;
  polygon: Geometry | null;
  center_lat: number | null;
  center_lng: number | null;
  status: RegionStatus;
  error: string | null;
}

export interface Restaurant {
  id: string;
  region_id: string;
  store_id: string;
  name: string;
  category: string | null;
  address: string | null;
  lat: number;
  lng: number;
  bplpay: Bplpay;
  bplpay_updated_at: string | null;
}

/** /api/search 응답 */
export interface SearchIntent {
  region: string;
  /** 업종 필터에 쓸 단어. 비어 있으면 전체 식당 */
  keywords: string[];
  /** 사용자에게 보여줄 해석 결과 */
  summary: string;
}
