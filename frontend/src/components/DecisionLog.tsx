// Bottom decision-log ticker: newest entries slide in, kind-colored dot,
// click to expand reasons. Reads straight from the snapshot's decisions
// list (backend already trims to the last 50).
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useAppStore } from "../store/useAppStore";
import type { DecisionKind } from "../lib/types";

const KIND_COLOR: Record<DecisionKind, string> = {
  assignment: "bg-eoc-route",
  reroute: "bg-eoc-risky",
  impact: "bg-eoc-alert",
  whatif: "bg-eoc-safe",
  safezone: "bg-eoc-safe",
};

const KIND_ICON: Record<DecisionKind, string> = {
  assignment: "🚀",
  reroute: "⚠️",
  impact: "🚨",
  whatif: "🔮",
  safezone: "🏠",
};

const KIND_LABEL: Record<DecisionKind, string> = {
  assignment: "Assignment",
  reroute: "Reroute",
  impact: "Impact",
  whatif: "What-If",
  safezone: "Safe Zone",
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-GB", { hour12: false });
}

export function DecisionLog() {
  const decisions = useAppStore((s) => s.decisions);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const recent = [...decisions].reverse().slice(0, 10);

  return (
    <div className="pointer-events-auto w-full max-w-2xl rounded-2xl border border-white/10 bg-[#0d1117]/95 px-4 py-3 backdrop-blur-xl">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">📋</span>
          <p className="font-mono text-[10px] font-bold uppercase tracking-wide text-eoc-text/70">Decision Log</p>
        </div>
        <span className="text-[9px] text-eoc-text/40">Last 10 decisions</span>
      </div>
      <div className="flex max-h-28 flex-col-reverse gap-2 overflow-y-auto">
        <AnimatePresence initial={false}>
          {recent.map((decision) => (
            <motion.div
              key={decision.id}
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              className={`cursor-pointer rounded-lg border p-2 transition-all ${
                expandedId === decision.id 
                  ? 'border-eoc-route/50 bg-eoc-route/10' 
                  : 'border-white/5 bg-white/5 hover:border-white/10'
              }`}
              onClick={() => setExpandedId(expandedId === decision.id ? null : decision.id)}
            >
              <div className="flex items-center gap-2">
                <span className={`flex h-6 w-6 items-center justify-center rounded-lg ${KIND_COLOR[decision.kind] ?? "bg-eoc-text/40"}`}>
                  <span className="text-xs">{KIND_ICON[decision.kind] ?? "•"}</span>
                </span>
                <span className="font-mono text-[10px] text-eoc-text/50">{formatTime(decision.ts)}</span>
                <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${
                  decision.kind === 'assignment' ? 'bg-eoc-route/30 text-eoc-route' :
                  decision.kind === 'reroute' ? 'bg-eoc-risky/30 text-eoc-risky' :
                  decision.kind === 'impact' ? 'bg-eoc-alert/30 text-eoc-alert' :
                  'bg-eoc-safe/30 text-eoc-safe'
                }`}>
                  {KIND_LABEL[decision.kind] ?? decision.kind}
                </span>
                <span className="truncate text-xs font-medium text-eoc-text/90">{decision.headline}</span>
              </div>
              {expandedId === decision.id && decision.reasons.length > 0 && (
                <motion.ul
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  className="mt-2 space-y-1 border-t border-white/10 pt-2"
                >
                  {decision.reasons.map((reason, i) => (
                    <li key={i} className="flex items-start gap-2 text-[10px] text-eoc-text/70">
                      <span className="mt-0.5 text-eoc-route">•</span>
                      <span>{reason}</span>
                    </li>
                  ))}
                </motion.ul>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
        {recent.length === 0 && (
          <div className="flex items-center justify-center gap-2 py-4 text-eoc-text/40">
            <span className="text-lg">📭</span>
            <p className="text-xs">No decisions yet</p>
          </div>
        )}
      </div>
    </div>
  );
}
