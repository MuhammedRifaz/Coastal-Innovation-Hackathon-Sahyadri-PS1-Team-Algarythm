import { useAppStore } from "../store/useAppStore";
import { motion, AnimatePresence } from "motion/react";

const KIND_COLORS = {
  assignment: "border-l-eoc-route text-eoc-route/90",
  reroute: "border-l-eoc-risky text-eoc-risky/90",
  impact: "border-l-eoc-alert text-eoc-alert/90",
  whatif: "border-l-eoc-route/50 text-eoc-text/70",
};

export function DecisionLog() {
  const decisions = useAppStore((s) => s.decisions);

  // Newest first (left-most)
  const list = [...decisions].reverse().slice(0, 10);

  if (list.length === 0) return null;

  return (
    <div className="absolute bottom-4 left-4 right-[336px] z-10 pointer-events-none flex flex-col gap-1.5">
      {/* Ticker label */}
      <div className="flex items-center gap-1.5 pl-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-eoc-text/30 animate-pulse" />
        <span className="font-mono text-[9px] uppercase tracking-widest text-eoc-text/40">
          Decision Log Ticker · Real-time Operational Audit
        </span>
      </div>

      {/* Horizontal scrolling track */}
      <div
        className="pointer-events-auto flex gap-2.5 overflow-x-auto pb-1"
        style={{ scrollbarWidth: "none" }}
      >
        <AnimatePresence initial={false}>
          {list.map((d) => {
            const timeStr = new Date(d.ts).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              hour12: false,
            });
            const colorClass = KIND_COLORS[d.kind] || "border-l-white/20 text-eoc-text/70";

            return (
              <motion.div
                key={d.id}
                layout
                initial={{ opacity: 0, x: -30, scale: 0.95 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9, x: 20 }}
                transition={{ type: "spring", stiffness: 350, damping: 30 }}
                className={`flex shrink-0 items-start gap-2 border-l-2 bg-eoc-panel border-t border-r border-b border-white/[0.04] px-3 py-2 rounded shadow-lg backdrop-blur-md max-w-[280px]`}
              >
                {/* Time & Kind indicator */}
                <div className="flex flex-col items-start gap-0.5 shrink-0">
                  <span className="font-mono text-[9px] font-medium tabular-nums text-eoc-text/40">
                    {timeStr}
                  </span>
                  <span className={`font-mono text-[8px] uppercase tracking-wider ${colorClass.split(" ")[1]}`}>
                    {d.kind}
                  </span>
                </div>

                {/* Divider */}
                <div className="h-6 w-px bg-white/[0.06] shrink-0 self-center" />

                {/* Headline & reasons */}
                <div className="min-w-0">
                  <p className="font-mono text-[10px] font-medium leading-snug text-eoc-text/80 truncate" title={d.headline}>
                    {d.headline}
                  </p>
                  {d.reasons && d.reasons.length > 0 && (
                    <p className="mt-0.5 font-sans text-[9px] leading-tight text-eoc-text/45 truncate" title={d.reasons[0]}>
                      {d.reasons[0]}
                    </p>
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
