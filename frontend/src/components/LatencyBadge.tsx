// Snapshot computed_in_ms latency badge, top-right. Pulses green on
// every new snapshot (seq change) via a Motion key-remount flash.
import { motion } from "motion/react";
import { useAppStore } from "../store/useAppStore";

export function LatencyBadge() {
  const computedInMs = useAppStore((s) => s.computedInMs);
  const seq = useAppStore((s) => s.seq);

  return (
    <div className="absolute top-4 right-4 z-10">
      <motion.div
        key={seq}
        initial={{ backgroundColor: "rgba(34,197,94,0.45)", borderColor: "rgba(34,197,94,0.8)" }}
        animate={{ backgroundColor: "rgba(17,24,32,0.88)", borderColor: "rgba(255,255,255,0.1)" }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="rounded-md border px-3 py-1.5 font-mono text-xs tabular-nums text-eoc-text backdrop-blur"
      >
        routing {computedInMs.toFixed(0)} ms
      </motion.div>
    </div>
  );
}
