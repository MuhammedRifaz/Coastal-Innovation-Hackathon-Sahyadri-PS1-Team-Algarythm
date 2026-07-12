// What-If dry-run toggle, bottom-center. When on, clicking a road on the
// map shows a hypothetical impact report instead of actually flooding it.
import { motion } from "motion/react";
import { useAppStore } from "../store/useAppStore";

export function WhatIfToggle() {
  const whatIfMode = useAppStore((s) => s.whatIfMode);
  const setWhatIfMode = useAppStore((s) => s.setWhatIfMode);

  return (
    <div className="pointer-events-none absolute bottom-6 left-1/2 z-10 -translate-x-1/2">
      <motion.button
        type="button"
        onClick={() => setWhatIfMode(!whatIfMode)}
        whileTap={{ scale: 0.96 }}
        className={`pointer-events-auto flex items-center gap-2 rounded-full border px-4 py-2 font-mono text-xs uppercase tracking-wide backdrop-blur transition-colors ${
          whatIfMode
            ? "border-eoc-route bg-eoc-route/20 text-eoc-route"
            : "border-white/10 bg-eoc-panel text-eoc-text/70 hover:text-eoc-text"
        }`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${whatIfMode ? "bg-eoc-route" : "bg-eoc-text/30"}`} />
        What-If Mode {whatIfMode ? "On" : "Off"}
      </motion.button>
    </div>
  );
}
