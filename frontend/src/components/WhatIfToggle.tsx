// What-If dry-run toggle, bottom-center. When on, clicking a road on the
// map shows a hypothetical impact report instead of actually flooding it.
import { motion } from "motion/react";
import { useAppStore } from "../store/useAppStore";

export function WhatIfToggle() {
  const whatIfMode = useAppStore((s) => s.whatIfMode);
  const setWhatIfMode = useAppStore((s) => s.setWhatIfMode);

  return (
    <motion.button
      type="button"
      onClick={() => setWhatIfMode(!whatIfMode)}
      whileTap={{ scale: 0.96 }}
      whileHover={{ scale: 1.02 }}
      className={`pointer-events-auto flex items-center gap-3 rounded-xl border-2 px-4 py-2.5 font-mono text-xs font-bold uppercase tracking-wide backdrop-blur-xl transition-all ${
        whatIfMode
          ? "border-eoc-route/60 bg-eoc-route/20 text-eoc-route shadow-lg shadow-eoc-route/20"
          : "border-white/10 bg-[#0d1117]/95 text-eoc-text/70 hover:border-white/20 hover:bg-white/5 hover:text-eoc-text"
      }`}
    >
      <div className={`flex h-5 w-5 items-center justify-center rounded-lg ${
        whatIfMode ? "bg-eoc-route" : "bg-white/10"
      }`}>
        <span className="text-sm">{whatIfMode ? "🔮" : "🎯"}</span>
      </div>
      <div className="flex flex-col items-start">
        <span className="text-[10px]">What-If Mode</span>
        <span className={`text-[9px] font-semibold ${whatIfMode ? "text-eoc-route" : "text-eoc-text/50"}`}>
          {whatIfMode ? "SIMULATION ACTIVE" : "Click to simulate"}
        </span>
      </div>
    </motion.button>
  );
}
