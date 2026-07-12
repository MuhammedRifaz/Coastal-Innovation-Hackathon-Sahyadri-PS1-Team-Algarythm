// Critical Road Impact Analyzer alert panel. Slides in from the right
// with a red edge glow; shows the closed road, isolated zones (with a
// count-up population animation), unreachable hospitals, affected
// mission actions, resilience before -> after, and a one-line
// recommendation. What-If results render the same card with a
// "HYPOTHETICAL" tag and dismissing them changes nothing server-side.
import { useEffect, useState } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useTransform } from "motion/react";
import { useAppStore } from "../store/useAppStore";
import type { ImpactReport } from "../lib/types";

function CountUp({ value }: { value: number }) {
  const count = useMotionValue(0);
  const rounded = useTransform(count, (v) => Math.round(v).toLocaleString());

  useEffect(() => {
    const controls = animate(count, value, { duration: 1, ease: "easeOut" });
    return () => controls.stop();
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
  const resilienceDropped = report.resilience_after < report.resilience_before;

  return (
    <motion.div
      initial={{ x: 400, opacity: 0, scale: 0.95 }}
      animate={{ x: 0, opacity: 1, scale: 1 }}
      exit={{ x: 400, opacity: 0, scale: 0.95 }}
      transition={{ type: "spring", stiffness: 280, damping: 26 }}
      className={`pointer-events-auto w-[380px] rounded-2xl border-2 p-5 text-eoc-text shadow-2xl backdrop-blur-xl ${
        hypothetical 
          ? 'border-eoc-route/50 bg-[#0d1117]/98 shadow-eoc-route/20' 
          : 'border-eoc-alert/50 bg-[#0d1117]/98 shadow-[0_0_32px_rgba(248,113,113,0.4)]'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${
            hypothetical ? 'bg-eoc-route/20' : 'bg-eoc-alert/20'
          }`}>
            <span className="text-xl">{hypothetical ? '🔮' : '🚨'}</span>
          </div>
          <div>
            <h2 className={`font-mono text-sm font-bold uppercase tracking-wide ${
              hypothetical ? 'text-eoc-route' : 'text-eoc-alert'
            }`}>
              {hypothetical ? 'Hypothetical Impact' : 'Critical Infrastructure Alert'}
            </h2>
            <p className="text-[10px] text-eoc-text/50">
              {hypothetical ? 'Simulation — no changes applied' : 'Real-time impact analysis'}
            </p>
          </div>
        </div>
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="rounded-lg bg-white/5 px-2 py-1 text-eoc-text/50 transition-colors hover:bg-white/10 hover:text-eoc-text"
        >
          ✕
        </button>
      </div>

      <div className={`mt-4 rounded-xl border p-3 ${
        hypothetical ? 'border-eoc-route/30 bg-eoc-route/10' : 'border-eoc-alert/30 bg-eoc-alert/10'
      }`}>
        <p className="font-mono text-[10px] text-eoc-text/50 uppercase tracking-wide">Affected Road</p>
        <p className="mt-1 truncate font-mono text-xs font-semibold" title={report.closed_edge}>
          {report.closed_edge}
        </p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-white/5 p-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">🏘️</span>
            <p className="text-[10px] uppercase text-eoc-text/50">Zones Affected</p>
          </div>
          <p className="mt-2 font-mono text-2xl font-bold tabular-nums">
            <CountUp value={report.isolated_zones.length} />
          </p>
          <p className="text-[10px] text-eoc-text/50">
            {report.isolated_zones.length === 1 ? 'zone' : 'zones'}
          </p>
        </div>
        <div className="rounded-xl bg-white/5 p-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">👥</span>
            <p className="text-[10px] uppercase text-eoc-text/50">Residents</p>
          </div>
          <p className="mt-2 font-mono text-2xl font-bold tabular-nums">
            <CountUp value={report.affected_population} />
          </p>
          <p className="text-[10px] text-eoc-text/50">affected</p>
        </div>
      </div>

      {report.isolated_zones.length > 0 && (
        <div className="mt-3 rounded-lg bg-white/5 p-2">
          <p className="text-[10px] text-eoc-text/60">{report.isolated_zones.map((z) => z.name).join(", ")}</p>
        </div>
      )}

      {report.unreachable_pois.length > 0 && (
        <div className="mt-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">🏥</span>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-eoc-text/50">Unreachable Hospitals</p>
          </div>
          <div className="space-y-1">
            {report.unreachable_pois.map(hospitalName).map((name, i) => (
              <p key={i} className="rounded-lg bg-eoc-alert/10 border border-eoc-alert/30 px-2 py-1.5 text-xs font-semibold text-eoc-alert">
                {name}
              </p>
            ))}
          </div>
        </div>
      )}

      {report.affected_missions.length > 0 && (
        <div className="mt-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">🚀</span>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-eoc-text/50">Mission Actions</p>
          </div>
          <div className="space-y-1">
            {report.affected_missions.map((m) => (
              <div key={m.mission_id} className="flex items-center justify-between rounded-lg bg-white/5 px-2 py-1.5">
                <span className="font-mono text-xs">{m.mission_id}</span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-eoc-text/60">{m.action}</span>
                  {m.delta_eta_s > 0 && (
                    <span className="rounded bg-eoc-risky/30 px-1.5 py-0.5 font-mono text-[9px] font-bold text-eoc-risky">
                      +{m.delta_eta_s.toFixed(0)}s
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={`mt-4 flex items-center justify-between rounded-xl border-2 p-3 ${
        resilienceDropped 
          ? 'border-eoc-alert/50 bg-eoc-alert/10' 
          : 'border-eoc-safe/50 bg-eoc-safe/10'
      }`}>
        <div className="flex items-center gap-2">
          <span className="text-lg">📊</span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-eoc-text/70">Network Resilience</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm tabular-nums text-eoc-text/60">{Math.round(report.resilience_before * 100)}%</span>
          <span className={`text-lg ${resilienceDropped ? 'text-eoc-alert' : 'text-eoc-safe'}`}>
            {resilienceDropped ? '↓' : '→'}
          </span>
          <span className={`font-mono text-lg font-bold tabular-nums ${
            resilienceDropped ? 'text-eoc-alert' : 'text-eoc-safe'
          }`}>
            {Math.round(report.resilience_after * 100)}%
          </span>
        </div>
      </div>

      <div className={`mt-3 rounded-xl border p-3 ${
        hypothetical 
          ? 'border-eoc-route/30 bg-eoc-route/10' 
          : 'border-eoc-alert/30 bg-eoc-alert/10'
      }`}>
        <div className="flex items-start gap-2">
          <span className="mt-0.5 text-lg">💡</span>
          <div>
            <p className="text-[10px] font-semibold uppercase text-eoc-text/50">Recommendation</p>
            <p className="mt-1 text-xs text-eoc-text/90 leading-relaxed">{report.recommendation}</p>
          </div>
        </div>
      </div>
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
    <div className="pointer-events-none">
      <AnimatePresence>
        {active && (
          <ImpactCard
            key={`${active.closed_edge}:${isHypothetical ? "hypothetical" : "real"}`}
            report={active}
            hypothetical={isHypothetical}
            onDismiss={() => {
              if (isHypothetical) {
                setHypotheticalImpact(null);
              } else {
                setDismissedEdge(active.closed_edge);
              }
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
