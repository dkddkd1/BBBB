"use client";

import dynamic from "next/dynamic";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Bplpay, Region, Restaurant, SearchIntent } from "@/lib/types";

// Leaflet은 브라우저에서만 동작한다
const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

const STATUS_TEXT: Record<Region["status"], string> = {
  pending: "수집 대기 중입니다. 수집 PC가 켜져 있으면 곧 시작됩니다…",
  collecting: "네이버지도에서 구획과 식당을 수집하고 있습니다…",
  done: "",
  error: "수집에 실패했습니다.",
};

export default function Home() {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean }>({ text: "" });
  const [intent, setIntent] = useState<SearchIntent | null>(null);
  const [region, setRegion] = useState<Region | null>(null);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);

  const loadRestaurants = useCallback(async (regionId: string) => {
    const { data, error } = await supabase.from("restaurants").select("*").eq("region_id", regionId).limit(5000);
    if (error) return setMessage({ text: `식당 정보를 불러오지 못했습니다: ${error.message}`, error: true });
    setRestaurants(data as Restaurant[]);
  }, []);

  const search = useCallback(
    async (q: string) => {
      if (!q.trim()) return;
      setBusy(true);
      setMessage({ text: "검색어를 해석하는 중…" });
      try {
        const res = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ q }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "검색 실패");
        const next = body as SearchIntent;
        setIntent(next);

        const { data, error } = await supabase.rpc("request_region", { p_name: next.region });
        if (error) throw new Error(error.message);
        const r = data as Region;
        setRestaurants([]);
        setRegion(r);
        if (r.status === "done") await loadRestaurants(r.id);
        window.history.replaceState(null, "", `?q=${encodeURIComponent(q)}`);
      } catch (e) {
        setMessage({ text: (e as Error).message, error: true });
      } finally {
        setBusy(false);
      }
    },
    [loadRestaurants],
  );

  // 공유 링크(?q=)로 들어오면 바로 검색
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) {
      setQuery(q);
      search(q);
    }
  }, [search]);

  // 구획 상태와 다른 사용자의 응답을 실시간으로 받는다
  useEffect(() => {
    if (!region?.id) return;
    const regionId = region.id;
    const channel = supabase
      .channel(`region-${regionId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "regions", filter: `id=eq.${regionId}` }, (p) => {
        const r = p.new as Region;
        setRegion(r);
        if (r.status === "done") loadRestaurants(regionId);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "restaurants", filter: `region_id=eq.${regionId}` }, (p) => {
        const r = p.new as Restaurant;
        if (!r?.id) return;
        setRestaurants((list) => {
          const i = list.findIndex((x) => x.id === r.id);
          if (i === -1) return [...list, r];
          const copy = list.slice();
          copy[i] = r;
          return copy;
        });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [region?.id, loadRestaurants]);

  // Realtime이 꺼져 있어도 수집 완료를 알아채도록 폴링
  useEffect(() => {
    if (!region || region.status === "done" || region.status === "error") return;
    const t = setInterval(async () => {
      const { data } = await supabase.from("regions").select("*").eq("id", region.id).single();
      if (data && data.status !== region.status) {
        setRegion(data as Region);
        if (data.status === "done") loadRestaurants(region.id);
      }
    }, 4000);
    return () => clearInterval(t);
  }, [region, loadRestaurants]);

  const visible = useMemo(() => {
    const kws = intent?.keywords ?? [];
    if (!kws.length) return restaurants;
    return restaurants.filter((r) => {
      const text = `${r.category ?? ""} ${r.name}`;
      return kws.some((k) => text.includes(k));
    });
  }, [restaurants, intent]);

  useEffect(() => {
    if (!region || busy) return;
    if (region.status !== "done") {
      setMessage({
        text: region.status === "error" ? `${STATUS_TEXT.error} ${region.error ?? ""}` : STATUS_TEXT[region.status],
        error: region.status === "error",
      });
      return;
    }
    const name = region.display_name ?? region.name;
    const yes = visible.filter((r) => r.bplpay === "yes").length;
    const filter = intent?.keywords.length ? ` · ${intent.summary}` : "";
    setMessage({ text: `${name}: 식당 ${visible.length}곳 · 비플페이 가능 ${yes}곳${filter}` });
  }, [region, visible, intent, busy]);

  const onVote = useCallback(async (id: string, status: Exclude<Bplpay, null>) => {
    let before: Restaurant | undefined;
    setRestaurants((list) =>
      list.map((r) => {
        if (r.id !== id) return r;
        before = r;
        return { ...r, bplpay: status };
      }),
    );
    const { error } = await supabase.rpc("set_bplpay", { p_restaurant_id: id, p_status: status });
    if (error) {
      setMessage({ text: `저장하지 못했습니다: ${error.message}`, error: true });
      if (before) setRestaurants((list) => list.map((r) => (r.id === id ? before! : r)));
    }
  }, []);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    search(query);
  };

  return (
    <main className="app">
      <header className="topbar">
        <form className="search" onSubmit={onSubmit}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="예: 을지로, 연남동, 을지로 근처 한식집"
            aria-label="지역 또는 검색어"
          />
          <button disabled={busy || !query.trim()}>검색</button>
        </form>
        <div className={`status ${message.error ? "error" : ""}`}>{message.text}</div>
        <div className="legend">
          <span><i className="pin yes" />비플페이 가능</span>
          <span><i className="pin no" />불가능</span>
          <span><i className="pin" />미확인</span>
        </div>
      </header>
      <MapView region={region} restaurants={visible} onVote={onVote} />
    </main>
  );
}
