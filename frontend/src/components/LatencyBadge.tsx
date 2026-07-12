// Snapshot computed_in_ms latency badge, top-right. Pulses green on
// every new snapshot (seq change) via a Motion key-remount flash.
import { motion } from "motion/react";
import { useAppStore } from "../store/useAppStore";

export function LatencyBadge() {
  const computedInMs = useAppStore((s) => s.computedInMs);
  const seq = useAppStore((s) => s.seq);
  const wsConnected = useAppStore((s) => s.wsConnected);

  const getPerformanceColor = (ms: number) => {
    if (ms < 50) return "text-eoc-safe";
    if (ms < 150) return "text-eoc-risky";
    return "text-eoc-blocked";
  };

  const getPerformanceLabel = (ms: number) => {
    if (ms < 50) return "Excellent";
    if (ms < 150) return "Good";
    return "Slow";
  };

  return (
    <div className="pointer-events-auto self-end">
      <motion.div
        key={seq}
        initial={{ backgroundColor: "rgba(34,197,94,0.3)", borderColor: "rgba(34,197,94,0.6)" }}
        animate={{ backgroundColor: "rgba(13,17,23,0.95)", borderColor: "rgba(255,255,255,0.1)" }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className={`rounded-xl border-2 px-4 py-2 font-mono text-xs backdrop-blur-xl ${
          wsConnected ? 'border-white/10' : 'border-eoc-blocked/50'
        }`}
      >
        <div className="flex items-center gap-3">
          <div className={`flex h-6 w-6 items-center justify-center rounded-lg ${
            wsConnected ? 'bg-eoc-safe/20' : 'bg-eoc-blocked/20'
          }`}>
            <span className="text-sm">{wsConnected ? '🟢' : '🔴'}</span>
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-[9px] uppercase text-eoc-text/50">Routing</span>
              <span className={`font-bold tabular-nums ${getPerformanceColor(computedInMs)}`}>
                {computedInMs.toFixed(0)}ms
              </span>
            </div>
            <div className={`text-[9px] font-semibold ${getPerformanceColor(computedInMs)}`}>
              {getPerformanceLabel(computedInMs)}
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
