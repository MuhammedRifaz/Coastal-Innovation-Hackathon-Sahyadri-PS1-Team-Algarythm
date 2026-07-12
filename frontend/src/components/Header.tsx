// Top nav bar: wordmark, live clock, network-resilience gauge, map legend,
// and the dashboard action buttons that make the whole demo clickable without
// ever needing to zoom/pan the map — clear every flood, resolve every
// incident, all from here.
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { useAppStore } from "../store/useAppStore";
import { postFloodClear, postResolveIncident, postPropagation } from "../lib/api";

function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now.toLocaleTimeString("en-IN", { hour12: false, timeZone: "Asia/Kolkata" });
}

function ResilienceGauge({ value }: { value: number }) {
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(1, value));
  const color = pct >= 0.8 ? "#22C55E" : pct >= 0.5 ? "#F59E0B" : "#EF4444";

  return (
    <div className="flex items-center gap-3">
      <div className="relative">
        <svg width="48" height="48" viewBox="0 0 48 48" className="-rotate-90">
          <circle cx="24" cy="24" r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="5" />
          <motion.circle
            cx="24"
            cy="24"
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={false}
            animate={{ strokeDashoffset: circumference * (1 - pct) }}
            transition={{ duration: 1, ease: "easeOut" }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-mono text-sm font-bold tabular-nums" style={{ color }}>{Math.round(pct * 100)}%</span>
        </div>
      </div>
      <div className="leading-tight">
        <p className="font-mono text-xs font-semibold uppercase tracking-wide text-eoc-text/70">Network</p>
        <p className="text-[10px] uppercase tracking-wide text-eoc-text/40">Resilience</p>
      </div>
    </div>
  );
}

function MapLegend() {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl bg-white/5 p-3">
      <p className="font-mono text-[9px] font-semibold uppercase tracking-wide text-eoc-text/50">Road Status</p>
      
      <div className="flex items-center gap-2">
        <div className="h-1 w-6 rounded bg-[#22C55E]/30" />
        <span className="text-[10px] text-eoc-text/70">Safe</span>
      </div>
      
      <div className="flex items-center gap-2">
        <div className="h-1 w-6 rounded bg-[#F59E0B]/30" />
        <span className="text-[10px] text-eoc-text/70">Risky</span>
      </div>
      
      <div className="flex items-center gap-2">
        <div className="h-1 w-6 rounded bg-[#EF4444]/30" />
        <span className="text-[10px] text-eoc-text/70">Blocked</span>
      </div>
      
      <div className="flex items-center gap-2">
        <div className="h-1 w-6 rounded border-t-2 border-dashed border-[#38BDF8]/80" />
        <span className="text-[10px] text-eoc-text/70">Flooded</span>
      </div>
      
      <div className="flex items-center gap-2">
        <div className="h-1 w-6 rounded border-t-2 border-dashed border-[#F97316]/80" />
        <span className="text-[10px] text-eoc-text/70">Uncertain</span>
      </div>
      
      <div className="flex items-center gap-2">
        <div className="h-1 w-6 rounded border-t-2 border-dotted border-[#FBBF24]/80" />
        <span className="text-[10px] text-eoc-text/70">At Risk</span>
      </div>
    </div>
  );
}

export function Header() {
  const clock = useClock();
  const latestImpact = useAppStore((s) => s.latestImpact);
  const roads = useAppStore((s) => s.roads);
  const incidents = useAppStore((s) => s.incidents);
  const resilience = latestImpact ? latestImpact.resilience_after : 1.0;

  const handleClearAllFloods = () => {
    const floodedIds = new Set<string>();
    for (const feature of roads?.features ?? []) {
      const status = feature.properties?.status;
      const edgeId = feature.properties?.edge_id;
      if (edgeId && (status === "risky" || status === "blocked")) floodedIds.add(edgeId);
    }
    for (const edgeId of floodedIds) {
      postFloodClear(edgeId).catch((err) => console.error("clear flood failed", err));
    }
  };

  const handleResolveAllIncidents = () => {
    for (const incident of incidents) {
      if (incident.status !== "resolved") {
        postResolveIncident(incident.id).catch((err) => console.error("resolve failed", err));
      }
    }
  };

  const handlePropagationAnalysis = () => {
    postPropagation(50.0).catch((err) => console.error("propagation analysis failed", err));
  };

  const openIncidentCount = incidents.filter((i) => i.status !== "resolved").length;

  return (
    <header className="pointer-events-auto flex h-18 items-center justify-between gap-4 border-b border-white/10 bg-[#0d1117]/95 px-6 backdrop-blur-xl">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🚨</span>
          <div>
            <span className="font-mono text-lg font-bold tracking-wide text-eoc-text">
              RESQ<span className="text-eoc-alert">OS</span>
            </span>
            <p className="text-[9px] uppercase tracking-widest text-eoc-text/40">Emergency Response System</p>
          </div>
        </div>
        <div className="h-10 w-px bg-white/10" />
        <div className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-1.5">
          <span className="text-lg">🕐</span>
          <div>
            <p className="font-mono text-sm font-semibold tabular-nums text-eoc-text">{clock}</p>
            <p className="text-[9px] uppercase tracking-wide text-eoc-text/50">IST</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <ResilienceGauge value={resilience} />

        <div className="h-10 w-px bg-white/10" />

        <MapLegend />

        <div className="h-10 w-px bg-white/10" />

        <button
          onClick={handleResolveAllIncidents}
          disabled={openIncidentCount === 0}
          className="group relative flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 font-mono text-xs font-semibold uppercase tracking-wide text-eoc-text/70 transition-all hover:border-eoc-safe/50 hover:bg-eoc-safe/10 hover:text-eoc-safe disabled:opacity-30 disabled:hover:border-white/10 disabled:hover:bg-white/5 disabled:hover:text-eoc-text/70"
        >
          <span className="text-base">✅</span>
          <span>Resolve All</span>
          {openIncidentCount > 0 && (
            <span className="ml-1 rounded-full bg-eoc-alert/80 px-1.5 py-0.5 text-[9px] font-bold text-white">
              {openIncidentCount}
            </span>
          )}
        </button>
        <button
          onClick={handleClearAllFloods}
          className="group flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 font-mono text-xs font-semibold uppercase tracking-wide text-eoc-text/70 transition-all hover:border-eoc-route/50 hover:bg-eoc-route/10 hover:text-eoc-route"
        >
          <span className="text-base">💧</span>
          <span>Clear Floods</span>
        </button>
        <button
          onClick={handlePropagationAnalysis}
          className="group flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 font-mono text-xs font-semibold uppercase tracking-wide text-eoc-text/70 transition-all hover:border-eoc-risky/50 hover:bg-eoc-risky/10 hover:text-eoc-risky"
        >
          <span className="text-base">🔮</span>
          <span>Predict Spread</span>
        </button>
      </div>
    </header>
  );
}
