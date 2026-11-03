"use client";

import { useEffect, useMemo } from "react";
import L from "leaflet";
import { GeoJSON, MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import type { Bplpay, Region, Restaurant } from "@/lib/types";

const SEOUL: [number, number] = [37.5665, 126.978];

const icons: Record<"yes" | "no" | "none", L.DivIcon> = {
  yes: L.divIcon({ className: "pin-wrap", html: '<div class="pin yes"></div>', iconSize: [28, 28], iconAnchor: [14, 14] }),
  no: L.divIcon({ className: "pin-wrap", html: '<div class="pin no"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }),
  none: L.divIcon({ className: "pin-wrap", html: '<div class="pin"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }),
};

function FitToRegion({ region, restaurants }: { region: Region | null; restaurants: Restaurant[] }) {
  const map = useMap();
  useEffect(() => {
    if (!region) return;
    if (region.polygon) {
      map.fitBounds(L.geoJSON(region.polygon).getBounds(), { padding: [20, 20] });
    } else if (restaurants.length) {
      map.fitBounds(L.latLngBounds(restaurants.map((r) => [r.lat, r.lng])), { padding: [20, 20] });
    } else if (region.center_lat != null && region.center_lng != null) {
      map.setView([region.center_lat, region.center_lng], 16);
    }
    // 구획이 바뀔 때만 화면을 옮긴다 (응답할 때마다 튀지 않도록)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, region?.id, region?.polygon, restaurants.length > 0]);
  return null;
}

export default function MapView({
  region,
  restaurants,
  onVote,
}: {
  region: Region | null;
  restaurants: Restaurant[];
  onVote: (id: string, status: Exclude<Bplpay, null>) => void;
}) {
  const polygonKey = useMemo(() => (region?.polygon ? `${region.id}-${JSON.stringify(region.polygon).length}` : ""), [region]);

  return (
    <MapContainer center={SEOUL} zoom={13} className="map" scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {region?.polygon && (
        <GeoJSON
          key={polygonKey}
          data={region.polygon}
          style={{ color: "#2b6cff", weight: 2, fillColor: "#2b6cff", fillOpacity: 0.06 }}
        />
      )}
      {restaurants.map((r) => (
        <Marker key={r.id} position={[r.lat, r.lng]} icon={icons[r.bplpay ?? "none"]}>
          <Popup>
            <div className="popup">
              <h3>{r.name}</h3>
              {r.category && <p>{r.category}</p>}
              {r.address && <p>{r.address}</p>}
              <div className="state">
                {r.bplpay === "yes" ? "✅ 비플페이 가능" : r.bplpay === "no" ? "⛔ 비플페이 불가능" : "아직 확인되지 않음"}
              </div>
              <div className="buttons">
                <button className={`yes ${r.bplpay === "yes" ? "active" : ""}`} onClick={() => onVote(r.id, "yes")}>
                  비플페이 가능
                </button>
                <button className={`no ${r.bplpay === "no" ? "active" : ""}`} onClick={() => onVote(r.id, "no")}>
                  불가능
                </button>
              </div>
            </div>
          </Popup>
        </Marker>
      ))}
      <FitToRegion region={region} restaurants={restaurants} />
    </MapContainer>
  );
}
