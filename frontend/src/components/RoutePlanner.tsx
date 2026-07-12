// Route planner panel: lets the user click origin then destination on the
// map and see the safest current route computed by the A* engine.
import { motion, AnimatePresence } from "motion/react";
import { useAppStore } from "../store/useAppStore";

function getRiskLevel(risk: number): { label: string; color: string; bg: string } {
  if (risk <= 20) return { label: "LOW RISK", color: "text-eoc-safe", bg: "bg-eoc-safe/20" };
  if (risk <= 50) return { label: "MODERATE", color: "text-eoc-risky", bg: "bg-eoc-risky/20" };
  return { label: "HIGH RISK", color: "text-eoc-blocked", bg: "bg-eoc-blocked/20" };
}

export function RoutePlanner() {
  const mode = useAppStore((s) => s.routePlannerMode);
  const origin = useAppStore((s) => s.routePlannerOrigin);
  const result = useAppStore((s) => s.routePlannerResult);
  const setMode = useAppStore((s) => s.setRoutePlannerMode);
  const setOrigin = useAppStore((s) => s.setRoutePlannerOrigin);
  const setDest = useAppStore((s) => s.setRoutePlannerDest);
  const setResult = useAppStore((s) => s.setRoutePlannerResult);

  const cancel = () => {
    setMode("idle");
    setOrigin(null);
    setDest(null);
    setResult(null);
  };

  const startPlanning = () => {
    cancel();
    setMode("picking_origin");
  };

  if (mode === "idle") {
    return (
      <motion.button
        whileTap={{ scale: 0.96 }}
        whileHover={{ scale: 1.02 }}
        onClick={startPlanning}
        className="pointer-events-auto flex items-center gap-2 rounded-full border-2 border-eoc-safe/50 bg-eoc-panel/90 px-4 py-2 font-mono text-sm font-semibold uppercase tracking-wide text-eoc-safe shadow-lg shadow-eoc-safe/20 backdrop-blur-md hover:bg-eoc-safe/10"
      >
        <span className="text-lg">🗺️</span>
        <span>Plan Safe Route</span>
      </motion.button>
    );
  }

  const riskInfo = result ? getRiskLevel(result.risk_score) : null;

  return (
    <AnimatePresence>
      <motion.div
        key="route-planner-active"
        initial={{ opacity: 0, y: 12, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.95 }}
        transition={{ type: "spring", stiffness: 300, damping: 25 }}
        className="pointer-events-auto rounded-2xl border border-white/15 bg-[#0d1117]/95 px-4 py-3 shadow-2xl backdrop-blur-xl"
      >
        {mode === "picking_origin" && (
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-eoc-route/20 text-eoc-route">
              <span className="text-sm">📍</span>
            </div>
            <div>
              <p className="font-mono text-sm font-semibold text-eoc-route animate-pulse">Click origin on map</p>
              <p className="text-[10px] text-eoc-text/50">Select starting point</p>
            </div>
          </div>
        )}
        {mode === "picking_dest" && origin && (
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-eoc-safe/20 text-eoc-safe">
              <span className="text-sm">🎯</span>
            </div>
            <div>
              <p className="font-mono text-sm font-semibold text-eoc-safe animate-pulse">Click destination on map</p>
              <p className="text-[10px] text-eoc-text/50">Select target location</p>
            </div>
          </div>
        )}
        {mode === "showing" && result && (
          <div className="min-w-[320px]">
            {result.reachable ? (
              <>
                <div className="mb-3 flex items-center justify-between">
                  <div className={`rounded-lg px-3 py-1 ${riskInfo?.bg}`}>
                    <span className={`font-mono text-xs font-bold ${riskInfo?.color}`}>{riskInfo?.label}</span>
                  </div>
                  <div className="font-mono text-xs text-eoc-text/60">{result.computed_in_ms}ms</div>
                </div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-lg bg-white/5 p-2">
                    <p className="font-mono text-lg font-bold text-eoc-text">{(result.distance_m / 1000).toFixed(1)}</p>
                    <p className="text-[9px] uppercase text-eoc-text/50">km</p>
                  </div>
                  <div className="rounded-lg bg-white/5 p-2">
                    <p className="font-mono text-lg font-bold text-eoc-text">{result.eta_s.toFixed(0)}</p>
                    <p className="text-[9px] uppercase text-eoc-text/50">seconds</p>
                  </div>
                  <div className="rounded-lg bg-white/5 p-2">
                    <p className="font-mono text-lg font-bold text-eoc-text">{result.risk_score.toFixed(0)}</p>
                    <p className="text-[9px] uppercase text-eoc-text/50">risk score</p>
                  </div>
                </div>
                {result.avoided_edges.length > 0 && (
                  <div className="mt-2 rounded-lg bg-eoc-risky/10 border border-eoc-risky/30 px-2 py-1.5">
                    <p className="text-[10px] text-eoc-risky">⚠️ Avoided {result.avoided_edges.length} flooded road{result.avoided_edges.length > 1 ? 's' : ''}</p>
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-center gap-3 rounded-lg bg-eoc-blocked/20 border border-eoc-blocked/40 px-3 py-2">
                <span className="text-2xl">🚫</span>
                <div>
                  <p className="font-mono text-xs font-semibold text-eoc-blocked">No passable route</p>
                  <p className="text-[10px] text-eoc-text/60">All paths blocked by flooding</p>
                </div>
              </div>
            )}
          </div>
        )}
        <div className="mt-3 flex gap-2">
          <button
            onClick={cancel}
            className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-eoc-text/70 transition-colors hover:bg-white/10 hover:text-eoc-text"
          >
            Cancel
          </button>
          {mode === "showing" && result && result.reachable && (
            <button
              onClick={() => {
                setMode("picking_origin");
                setResult(null);
              }}
              className="flex-1 rounded-lg border border-eoc-safe/30 bg-eoc-safe/20 px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-eoc-safe transition-colors hover:bg-eoc-safe/30"
            >
              New Route
            </button>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}


