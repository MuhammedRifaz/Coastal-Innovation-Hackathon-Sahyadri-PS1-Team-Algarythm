// ImpactAlert — sits at the top of the right sidebar as an inline card.
// Real alerts (from flooding) and hypothetical What-If previews share the same card.
// No longer absolutely positioned — parent sidebar controls placement.
import { useEffect, useState } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useTransform } from "motion/react";
import { useAppStore } from "../store/useAppStore";
import type { ImpactReport } from "../lib/types";

function CountUp({ value }: { value: number }) {
  const count = useMotionValue(0);
  const rounded = useTransform(count, (v) => Math.round(v).toLocaleString());
  useEffect(() => {
    const c = animate(count, value, { duration: 0.9, ease: "easeOut" });
    return () => c.stop();
  }, [value, count]);
  return <motion.span>{rounded}</motion.span>;
}

interface ImpactCardProps {
  report: ImpactReport;
  hypothetical: boolean;
  onDismiss: () => void;
}

function ImpactCard({ report, hypothetical, onDismiss }: ImpactCardProps) {
  const pois = useAppStore((s) => s.pois);
  const hospitalName = (id: string) => pois.find((p) => p.id === id)?.name ?? id;
  const dropped = report.resilience_after < report.resilience_before;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="rounded-lg border border-eoc-alert/40 bg-eoc-panel p-3.5
                 shadow-[0_0_24px_rgba(248,113,113,0.2)] backdrop-blur"
    >
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-full bg-eoc-alert animate-pulse" />
          <span className="text-[10px] font-semibold uppercase tracking-widest text-eoc-alert">
            {hypothetical ? "Hypothetical Alert" : "Critical Alert"}
          </span>
        </div>
        <button onClick={onDismiss} className="text-eoc-text/30 hover:text-eoc-text transition-colors text-sm leading-none">✕</button>
      </div>

      {/* Road name */}
      <p className="mt-1.5 truncate font-mono text-[10px] text-eoc-text/40" title={report.closed_edge}>
        {report.closed_edge}
      </p>

      {/* Population impact */}
      <div className="mt-3 rounded bg-eoc-alert/10 border border-eoc-alert/20 px-3 py-2">
        <p className="text-2xl font-mono font-bold tabular-nums text-eoc-text leading-none">
          <CountUp value={report.affected_population} />
        </p>
        <p className="mt-0.5 text-[10px] text-eoc-text/50">
          residents affected · {report.isolated_zones.length} zone{report.isolated_zones.length !== 1 ? "s" : ""}
        </p>
        {report.isolated_zones.length > 0 && (
          <p className="mt-1 text-[10px] text-eoc-text/40 truncate">
            {report.isolated_zones.map((z) => z.name).join(" · ")}
          </p>
        )}
      </div>

      {/* Hospitals */}
      {report.unreachable_pois.length > 0 && (
        <div className="mt-2.5">
          <p className="text-[9px] uppercase tracking-widest text-eoc-text/30 mb-1">Unreachable hospitals</p>
          <p className="text-xs text-eoc-alert/80">{report.unreachable_pois.map(hospitalName).join(", ")}</p>
        </div>
      )}

      {/* Missions */}
      {report.affected_missions.length > 0 && (
        <div className="mt-2.5">
          <p className="text-[9px] uppercase tracking-widest text-eoc-text/30 mb-1">Mission impacts</p>
          {report.affected_missions.map((m) => (
            <p key={m.mission_id} className="font-mono text-[10px] text-eoc-text/60">
              {m.mission_id}: {m.action}{m.delta_eta_s > 0 ? ` +${m.delta_eta_s.toFixed(0)}s` : ""}
            </p>
          ))}
        </div>
      )}

      {/* Resilience bar */}
      <div className="mt-3 flex items-center gap-2 border-t border-white/8 pt-2.5">
        <span className="text-[10px] uppercase tracking-widest text-eoc-text/30">Resilience</span>
        <span className="font-mono text-xs text-eoc-text/50 tabular-nums">{Math.round(report.resilience_before * 100)}%</span>
        <span className="text-eoc-text/20">→</span>
        <span className={`font-mono text-xs font-bold tabular-nums ${dropped ? "text-eoc-alert" : "text-eoc-safe"}`}>
          {Math.round(report.resilience_after * 100)}%
        </span>
        <div className="flex-1 h-1 rounded-full bg-white/5 overflow-hidden">
          <motion.div
            className={`h-full rounded-full ${dropped ? "bg-eoc-alert" : "bg-eoc-safe"}`}
            initial={{ width: `${report.resilience_before * 100}%` }}
            animate={{ width: `${report.resilience_after * 100}%` }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          />
        </div>
      </div>

      {/* Recommendation */}
      <p className="mt-2.5 text-[11px] leading-snug text-eoc-text/80 border-t border-white/8 pt-2.5">
        {report.recommendation}
      </p>
    </motion.div>
  );
}

export function ImpactAlert() {
  const latestImpact = useAppStore((s) => s.latestImpact);
  const hypotheticalImpact = useAppStore((s) => s.hypotheticalImpact);
  const setHypotheticalImpact = useAppStore((s) => s.setHypotheticalImpact);
  const [dismissedEdge, setDismissedEdge] = useState<string | null>(null);

  const real = latestImpact && latestImpact.closed_edge !== dismissedEdge ? latestImpact : null;
  const active = hypotheticalImpact ?? real;
  const isHypothetical = hypotheticalImpact != null;

  return (
    <AnimatePresence mode="wait">
      {active && (
        <ImpactCard
          key={`${active.closed_edge}:${isHypothetical ? "hyp" : "real"}`}
          report={active}
          hypothetical={isHypothetical}
          onDismiss={() => {
            if (isHypothetical) setHypotheticalImpact(null);
            else setDismissedEdge(active.closed_edge);
          }}
        />
      )}
    </AnimatePresence>
  );
}
