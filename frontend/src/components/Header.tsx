// Top header bar: ResQOS wordmark · live clock · WS connection dot · What-If toggle
import { useEffect, useState } from "react";
import { useAppStore } from "../store/useAppStore";

function Clock() {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="font-mono text-sm tabular-nums text-eoc-text/60">
      {time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
    </span>
  );
}

export function Header() {
  const wsConnected = useAppStore((s) => s.wsConnected);
  const computedInMs = useAppStore((s) => s.computedInMs);
  const seq = useAppStore((s) => s.seq);
  const whatIfMode = useAppStore((s) => s.whatIfMode);
  const setWhatIfMode = useAppStore((s) => s.setWhatIfMode);

  return (
    <div className="absolute top-0 left-0 right-0 z-20 flex items-center gap-4 px-4 py-2.5
                    border-b border-white/[0.06] bg-eoc-bg/80 backdrop-blur">
      {/* Wordmark */}
      <div className="flex items-center gap-2.5 shrink-0">
        <div className="flex items-center justify-center w-7 h-7 rounded-md bg-eoc-alert/20 border border-eoc-alert/30">
          <svg className="w-4 h-4 text-eoc-alert" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <span className="font-mono text-sm font-bold tracking-widest text-eoc-text">
          RES<span className="text-eoc-route">QOS</span>
        </span>
        <span className="hidden sm:block text-[10px] uppercase tracking-widest text-eoc-text/30 border-l border-white/10 pl-2.5">
          Emergency Response Engine
        </span>
      </div>

      <div className="flex-1" />

      {/* Latency badge */}
      <div key={seq}
        className="hidden sm:flex items-center gap-1.5 rounded border border-white/10 bg-eoc-panel px-2.5 py-1 font-mono text-[11px] tabular-nums text-eoc-text/60">
        <span className="h-1.5 w-1.5 rounded-full bg-eoc-safe animate-pulse" />
        {computedInMs.toFixed(0)} ms
      </div>

      {/* Clock */}
      <Clock />

      {/* WS status */}
      <div className="flex items-center gap-1.5">
        <span className={`h-2 w-2 rounded-full ${wsConnected ? "bg-eoc-safe" : "bg-eoc-risky animate-pulse"}`} />
        <span className="hidden sm:block font-mono text-[10px] uppercase tracking-wider text-eoc-text/40">
          {wsConnected ? "Live" : "Connecting…"}
        </span>
      </div>

      {/* What-If toggle — compact in header */}
      <button
        type="button"
        onClick={() => setWhatIfMode(!whatIfMode)}
        title="Toggle What-If mode: click roads to preview impact without committing"
        className={`flex items-center gap-1.5 rounded border px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest transition-colors ${
          whatIfMode
            ? "border-eoc-route bg-eoc-route/15 text-eoc-route"
            : "border-white/10 bg-transparent text-eoc-text/50 hover:text-eoc-text hover:border-white/20"
        }`}
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 16 16">
          <path d="M8 1v14M1 8h14" strokeLinecap="round"/>
        </svg>
        What-If
      </button>
    </div>
  );
}
