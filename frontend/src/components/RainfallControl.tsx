// Live rainfall intensity slider: drives the backend's elevation-aware
// flood engine (POST /api/rainfall). Low-lying roads near the Nethravathi
// flood first; drag right and watch the network drown in real time.
import { useRef, useState } from "react";
import { motion } from "motion/react";
import { postRainfall } from "../lib/api";

export function RainfallControl() {
  const [rainfallMm, setRainfallMm] = useState(0);
  const debounceRef = useRef<number | null>(null);

  // Debounce the POST so dragging the slider doesn't flood (ha) the API —
  // the last value within 150ms wins.
  const handleChange = (mm: number) => {
    setRainfallMm(mm);
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      postRainfall(mm).catch((err) => console.error("rainfall failed", err));
    }, 150);
  };

  const level =
    rainfallMm === 0 ? { label: "DRY", color: "text-eoc-text/40" } :
    rainfallMm < 30 ? { label: "LIGHT", color: "text-eoc-safe" } :
    rainfallMm < 80 ? { label: "HEAVY", color: "text-eoc-risky" } :
    rainfallMm < 150 ? { label: "EXTREME", color: "text-eoc-blocked" } :
    { label: "CATASTROPHIC", color: "text-eoc-blocked" };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="pointer-events-auto flex items-center gap-2.5 rounded-full border-2 border-sky-400/40 bg-eoc-panel/90 px-4 py-2 backdrop-blur-md"
    >
      <span className="font-mono text-sm font-semibold uppercase tracking-wide text-sky-400">🌧 Rain</span>
      <input
        type="range"
        min={0}
        max={200}
        step={5}
        value={rainfallMm}
        onChange={(e) => handleChange(Number(e.target.value))}
        className="h-1.5 w-32 cursor-pointer accent-sky-400"
        aria-label="Rainfall intensity in millimetres"
      />
      <span className={`min-w-[4rem] text-right font-mono text-xs tabular-nums ${level.color}`}>
        {rainfallMm} mm
      </span>
      <span className={`font-mono text-[10px] font-bold ${level.color}`}>{level.label}</span>
    </motion.div>
  );
}
