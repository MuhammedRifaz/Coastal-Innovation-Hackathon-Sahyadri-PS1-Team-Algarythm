// Scenario bar: Simulate Monsoon Surge button with progress indicator.
import { motion, AnimatePresence } from "motion/react";
import { useAppStore } from "../store/useAppStore";
import { postScenarioStart, postScenarioReset, postUserRoute } from "../lib/api";

export function ScenarioBar() {
  const scenarioRunning = useAppStore((s) => s.decisions.some((d) => d.headline.includes("Monsoon Surge")));
  
  const handleStart = async () => {
    try {
      // Frame the NH66 bridge crossing — the story's centrepiece — before
      // the first rainfall wave lands.
      useAppStore.getState().setCameraTarget({ center: [74.852, 12.835], zoom: 13.1 });
      await postScenarioStart();
    } catch (err) {
      console.error("Failed to start scenario:", err);
    }
  };

  const handleReset = async () => {
    try {
      await postScenarioReset();
      // Recalculate route if route planner is active after reset
      const state = useAppStore.getState();
      if (state.routePlannerOrigin && state.routePlannerDest) {
        postUserRoute(
          state.routePlannerOrigin[0], state.routePlannerOrigin[1],
          state.routePlannerDest[0], state.routePlannerDest[1]
        ).then((route) => {
          useAppStore.getState().setRoutePlannerResult(route);
        }).catch((err) => {
          console.error("Failed to recalculate route after reset:", err);
        });
      }
    } catch (err) {
      console.error("Failed to reset scenario:", err);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="pointer-events-auto flex items-center gap-2 rounded-full border-2 border-eoc-safe/50 bg-eoc-panel/90 px-4 py-2 backdrop-blur-md"
    >
      <AnimatePresence mode="wait">
        {!scenarioRunning ? (
          <motion.button
            key="start"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            whileTap={{ scale: 0.96 }}
            whileHover={{ scale: 1.02 }}
            onClick={handleStart}
            className="flex items-center gap-2 font-mono text-sm font-semibold uppercase tracking-wide text-eoc-safe"
          >
            <span className="text-lg">▶</span>
            <span>Simulate Monsoon Surge</span>
          </motion.button>
        ) : (
          <motion.button
            key="reset"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            whileTap={{ scale: 0.96 }}
            whileHover={{ scale: 1.02 }}
            onClick={handleReset}
            className="flex items-center gap-2 font-mono text-sm font-semibold uppercase tracking-wide text-eoc-risky"
          >
            <span className="text-lg">↺</span>
            <span>Reset</span>
          </motion.button>
        )}
      </AnimatePresence>
      {/* Always show reset button as secondary action */}
      <motion.button
        key="always-reset"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        whileTap={{ scale: 0.96 }}
        whileHover={{ scale: 1.02 }}
        onClick={handleReset}
        className="flex items-center gap-1 font-mono text-xs font-semibold uppercase tracking-wide text-eoc-text/50 hover:text-eoc-text"
        title="Reset to pristine state"
      >
        <span className="text-sm">↺</span>
      </motion.button>
    </motion.div>
  );
}
