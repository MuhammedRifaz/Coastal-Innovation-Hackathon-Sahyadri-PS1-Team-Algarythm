// Floating panel showing full attributes for the last-clicked road edge.
// Also shows what would happen if it were closed and nearby zones/POIs.
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useAppStore } from "../store/useAppStore";
import { postFlood, postFloodClear } from "../lib/api";

const STATUS_COLOR: Record<string, string> = {
  safe: "text-eoc-safe",
  risky: "text-eoc-risky",
  blocked: "text-eoc-blocked",
};

const STATUS_BG: Record<string, string> = {
  safe: "bg-eoc-safe/10 border-eoc-safe/30",
  risky: "bg-eoc-risky/10 border-eoc-risky/30",
  blocked: "bg-eoc-blocked/10 border-eoc-blocked/30",
};

function ScoreBar({ value, max = 100 }: { value: number; max?: number }) {
  const pct = (value / max) * 100;
  const color = value >= 70 ? "#22C55E" : value >= 40 ? "#F59E0B" : "#EF4444";
  return (
    <div className="mt-1 h-2 w-full rounded-full bg-white/10">
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  );
}

function ElevationIndicator({ elevation, floodDepth }: { elevation: number; floodDepth: number }) {
  const floodLevel = elevation - (floodDepth / 100);
  const isFlooded = floodDepth > 0;
  
  return (
    <div className="relative h-16 w-full rounded-lg bg-gradient-to-b from-sky-500/20 to-blue-900/30 border border-white/10 overflow-hidden">
      <div className="absolute inset-0 flex flex-col justify-between p-2">
        <div className="flex justify-between items-center">
          <span className="text-[9px] font-mono text-eoc-text/60">Sea Level</span>
          <span className="text-[9px] font-mono text-eoc-text/60">0m</span>
        </div>
        
        <div 
          className="absolute left-0 right-0 border-t-2 border-dashed border-eoc-text/40"
          style={{ bottom: `${Math.min(100, Math.max(0, (elevation / 15) * 100))}%` }}
        >
          <div className="absolute -right-1 -top-3 bg-[#0d1117] px-1.5 py-0.5 rounded text-[9px] font-mono text-eoc-text/80">
            {elevation.toFixed(1)}m
          </div>
        </div>
        
        {isFlooded && (
          <div 
            className="absolute left-0 right-0 bg-blue-500/30 border-t border-blue-400/50"
            style={{ bottom: `${Math.min(100, Math.max(0, (floodLevel / 15) * 100))}%`, height: `${Math.min(100, (floodDepth / 100) / 15 * 100)}%` }}
          >
            <div className="absolute -right-1 top-1 bg-blue-500/80 px-1.5 py-0.5 rounded text-[9px] font-mono text-white">
              💧 {floodDepth.toFixed(0)}cm
            </div>
          </div>
        )}
        
        <div className="flex justify-between items-center">
          <span className="text-[9px] font-mono text-eoc-text/60">Ground</span>
          <span className="text-[9px] font-mono text-eoc-text/60">15m</span>
        </div>
      </div>
    </div>
  );
}

export function RoadInspector() {
  const data = useAppStore((s) => s.roadInspector);
  const setRoadInspector = useAppStore((s) => s.setRoadInspector);
  const [confidence, setConfidence] = useState(100);

  return (
    <AnimatePresence>
      {data && (
        <motion.div
          key="road-inspector"
          initial={{ opacity: 0, x: 28, scale: 0.95 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 28, scale: 0.95 }}
          transition={{ type: "spring", stiffness: 300, damping: 26 }}
          className="pointer-events-auto w-[340px] rounded-2xl border border-white/12 bg-[#0d1117]/96 p-4 text-eoc-text shadow-2xl backdrop-blur-xl"
        >
          {/* Header */}
          <div className="mb-3 flex items-start justify-between gap-2">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-lg">🛣️</span>
                <span className="font-mono text-[11px] uppercase tracking-[.16em] text-eoc-text/50">Road Inspector</span>
                {data.critical && (
                  <span className="rounded-lg bg-eoc-risky/20 border border-eoc-risky/40 px-2 py-0.5 font-mono text-[9px] uppercase font-bold text-eoc-risky">
                    Critical
                  </span>
                )}
              </div>
              <div className="mt-1 font-mono text-[10px] text-eoc-text/40 break-all">{data.edge_id}</div>
            </div>
            <button
              onClick={() => setRoadInspector(null)}
              className="mt-0.5 shrink-0 rounded-lg bg-white/5 px-2 py-1 text-eoc-text/40 hover:bg-white/10 hover:text-eoc-text transition-colors"
            >
              ✕
            </button>
          </div>

          {/* Status + depth */}
          <div className={`mb-3 rounded-xl border-2 px-4 py-2.5 ${STATUS_BG[data.status] ?? ""}`} style={{ borderColor: data.status === 'safe' ? 'rgba(34, 197, 94, 0.3)' : data.status === 'risky' ? 'rgba(245, 158, 11, 0.3)' : 'rgba(239, 68, 68, 0.3)' }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`text-lg`}>{data.status === 'safe' ? '✅' : data.status === 'risky' ? '⚠️' : '🚫'}</span>
                <span className={`font-mono text-sm font-bold uppercase ${STATUS_COLOR[data.status] ?? ""}`}>
                  {data.status}
                </span>
              </div>
              {data.flood_depth_cm > 0 && (
                <div className="rounded-lg bg-blue-500/20 px-2.5 py-1">
                  <span className="font-mono text-xs font-semibold text-blue-400">{data.flood_depth_cm.toFixed(1)} cm water</span>
                </div>
              )}
            </div>
          </div>

          {/* Elevation & Flood Depth Visualization */}
          <div className="mb-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wide text-eoc-text/50">Elevation & Flood Depth</span>
              <span className="text-[9px] font-mono text-eoc-text/40">Sea Level Reference</span>
            </div>
            <ElevationIndicator elevation={data.elevation_m} floodDepth={data.flood_depth_cm} />
          </div>

          {/* Attributes grid */}
          <div className="mb-3 grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-lg bg-white/5 p-2.5">
              <div className="text-[10px] uppercase text-eoc-text/50">Elevation</div>
              <div className="font-mono text-base font-bold">{data.elevation_m.toFixed(1)} m</div>
            </div>
            <div className="rounded-lg bg-white/5 p-2.5">
              <div className="text-[10px] uppercase text-eoc-text/50">Length</div>
              <div className="font-mono text-base font-bold">{data.length_m >= 1000 ? `${(data.length_m / 1000).toFixed(1)} km` : `${data.length_m.toFixed(0)} m`}</div>
            </div>
            <div className="rounded-lg bg-white/5 p-2.5">
              <div className="text-[10px] uppercase text-eoc-text/50">Road type</div>
              <div className="font-mono text-sm font-semibold capitalize">{data.highway_class}</div>
            </div>
            <div className="rounded-lg bg-white/5 p-2.5">
              <div className="text-[10px] uppercase text-eoc-text/50">Safety score</div>
              <div className="font-mono text-base font-bold">{data.safety_score}/100</div>
              <ScoreBar value={data.safety_score} />
            </div>
          </div>

          {/* Confidence slider (for flood reports) */}
          {data.status === "safe" && (
            <div className="mb-3 rounded-xl bg-white/5 p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm">📡</span>
                  <span className="text-[10px] uppercase tracking-wide text-eoc-text/50 font-semibold">Report Confidence</span>
                </div>
                <span className="font-mono text-xs font-bold text-eoc-text/80">{confidence}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={confidence}
                onChange={(e) => setConfidence(parseInt(e.target.value))}
                className="w-full h-2 rounded-lg appearance-none cursor-pointer bg-white/10 accent-eoc-safe"
              />
              <div className="mt-1 flex justify-between text-[9px] font-mono text-eoc-text/40">
                <span>Uncertain</span>
                <span>Confirmed</span>
              </div>
            </div>
          )}

          {/* If closed - Impact Analysis */}
          {(data.if_closed_zones.length > 0 || data.if_closed_population > 0) ? (
            <div className="mb-3 rounded-xl border border-eoc-blocked/30 bg-eoc-blocked/10 px-3 py-2.5">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-lg">🔗</span>
                <span className="font-mono text-[10px] font-bold uppercase text-eoc-blocked">Impact if closed</span>
              </div>
              <div className="text-eoc-text/80 text-xs">
                {data.if_closed_zones.length > 0
                  ? (
                    <div>
                      <div className="mb-1 font-semibold">{data.if_closed_zones.join(", ")}</div>
                      <div className="flex items-center gap-2">
                        <span className="text-eoc-text/60">({data.if_closed_population.toLocaleString()} residents)</span>
                        <span className="rounded bg-eoc-blocked/30 px-1.5 py-0.5 text-[9px] font-bold text-eoc-blocked">LOSE HOSPITAL ACCESS</span>
                      </div>
                    </div>
                  )
                  : "No zone loses hospital access"}
              </div>
              {data.if_closed_recommendation && (
                <div className="mt-2 rounded-lg bg-white/5 px-2 py-1.5 text-[10px] text-eoc-text/70 italic">
                  💡 {data.if_closed_recommendation}
                </div>
              )}
            </div>
          ) : (
            <div className="mb-3 rounded-xl border border-eoc-safe/20 bg-eoc-safe/5 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="text-lg">✅</span>
                <span className="text-xs text-eoc-text/70">Closing this road won't isolate any zone from hospital access.</span>
              </div>
            </div>
          )}

          {/* Connections - What this road connects */}
          <div className="mb-3 rounded-xl bg-white/5 p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-sm">🔀</span>
              <span className="text-[10px] uppercase tracking-wide text-eoc-text/50 font-semibold">Connections</span>
            </div>
            <div className="space-y-2">
              {data.nearby_zones.length > 0 && (
                <div>
                  <div className="text-[9px] uppercase text-eoc-text/40 mb-1">Nearby Zones</div>
                  {data.nearby_zones.slice(0, 3).map((z) => (
                    <div key={z.id} className="flex items-center justify-between text-xs">
                      <span className="text-eoc-text/80">📍 {z.name}</span>
                      <span className="font-mono text-[10px] text-eoc-text/50 bg-white/10 px-1.5 py-0.5 rounded">{z.distance_m < 1000 ? `${z.distance_m}m` : `${(z.distance_m / 1000).toFixed(1)}km`}</span>
                    </div>
                  ))}
                </div>
              )}
              {data.nearby_pois.length > 0 && (
                <div>
                  <div className="text-[9px] uppercase text-eoc-text/40 mb-1">Nearby Facilities</div>
                  {data.nearby_pois.slice(0, 3).map((p) => (
                    <div key={p.id} className="flex items-center justify-between text-xs">
                      <span className="text-eoc-text/80">
                        {p.kind === "hospital" ? "🏥" : "🛖"} {p.name}
                      </span>
                      <span className="font-mono text-[10px] text-eoc-text/50 bg-white/10 px-1.5 py-0.5 rounded">{p.distance_m < 1000 ? `${p.distance_m}m` : `${(p.distance_m / 1000).toFixed(1)}km`}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Flood/clear action */}
          <div className="flex gap-2">
            <button
              onClick={() => {
                if (data.status === "safe") {
                  postFlood(data.edge_id, 45, confidence).catch(console.error);
                } else {
                  postFloodClear(data.edge_id).catch(console.error);
                }
              }}
              className={`flex-1 rounded-xl border-2 py-2 text-[11px] font-bold uppercase tracking-wide transition-all ${
                data.status === "safe"
                  ? "border-eoc-risky/50 text-eoc-risky hover:bg-eoc-risky/20 hover:shadow-lg hover:shadow-eoc-risky/20"
                  : "border-eoc-safe/50 text-eoc-safe hover:bg-eoc-safe/20 hover:shadow-lg hover:shadow-eoc-safe/20"
              }`}
            >
              {data.status === "safe" ? "💧 Simulate Flood" : "✨ Clear Flood"}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
