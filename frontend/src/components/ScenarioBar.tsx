import { useState } from "react";
import { postScenarioStart, postScenarioReset } from "../lib/api";
import { motion } from "motion/react";

export function ScenarioBar() {
  const [isRunning, setIsRunning] = useState(false);

  const handleStart = async () => {
    setIsRunning(true);
    try {
      await postScenarioStart();
    } catch (err) {
      console.error("Failed to start scenario:", err);
      setIsRunning(false);
    }
  };

  const handleReset = async () => {
    setIsRunning(false);
    try {
      await postScenarioReset();
    } catch (err) {
      console.error("Failed to reset scenario:", err);
    }
  };

  return (
    <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-white/[0.08] bg-eoc-panel/90 px-4 py-2 shadow-2xl backdrop-blur-md">
        {/* Play / Simulate Button */}
        <motion.button
          type="button"
          onClick={handleStart}
          disabled={isRunning}
          whileTap={{ scale: 0.96 }}
          className={`flex items-center gap-2 rounded-full px-4 py-1.5 font-mono text-[10px] uppercase tracking-widest transition-colors ${
            isRunning
              ? "bg-eoc-risky/10 text-eoc-risky border border-eoc-risky/30 pointer-events-none cursor-default"
              : "bg-eoc-safe/10 hover:bg-eoc-safe/25 text-eoc-safe border border-eoc-safe/30"
          }`}
        >
          {isRunning ? (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-eoc-risky animate-pulse" />
              Surge Active
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
              Simulate Monsoon Surge
            </>
          )}
        </motion.button>

        {/* Divider */}
        <div className="h-5 w-px bg-white/[0.08]" />

        {/* Reset Button */}
        <motion.button
          type="button"
          onClick={handleReset}
          whileTap={{ scale: 0.96 }}
          className="flex items-center gap-1.5 rounded-full border border-white/10 bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-eoc-text/50 hover:text-eoc-text hover:border-white/20 transition-colors"
        >
          <svg className="w-3.5 h-3.5 stroke-current fill-none" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
          </svg>
          Reset
        </motion.button>
      </div>
    </div>
  );
}
