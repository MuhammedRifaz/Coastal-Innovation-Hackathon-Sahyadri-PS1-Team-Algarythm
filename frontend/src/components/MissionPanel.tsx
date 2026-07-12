// MissionPanel — inline sidebar section showing active mission cards.
// No absolute positioning — parent sidebar controls placement.
// Cards: callsign · kind badge · status chip · ETA (large mono) · risk chip
// Expand "Why?" → reasons list + backup route indicator.
// Hover → store notifies MapView to highlight/dim routes.

import { useCallback } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useAppStore } from "../store/useAppStore";
import { postResolveIncident } from "../lib/api";
import type { Mission, Vehicle, Incident } from "../lib/types";

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtEta(eta_s: number): string {
  if (eta_s <= 0) return "—";
  const m = Math.floor(eta_s / 60);
  const s = Math.round(eta_s % 60);
  return m > 0 ? `${m}m ${s.toString().padStart(2, "0")}s` : `${s}s`;
}

const RISK_LEVELS = [
  { max: 15, label: "LOW", bg: "bg-eoc-safe/15", text: "text-eoc-safe", border: "border-eoc-safe/30" },
  { max: 45, label: "MED", bg: "bg-eoc-risky/15", text: "text-eoc-risky", border: "border-eoc-risky/30" },
  { max: 101, label: "HIGH", bg: "bg-eoc-alert/15", text: "text-eoc-alert", border: "border-eoc-alert/30" },
];

function riskChip(score: number) {
  return RISK_LEVELS.find((r) => score < r.max) ?? RISK_LEVELS[2];
}

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  active:     { label: "Active",      cls: "bg-eoc-safe/15 text-eoc-safe" },
  rerouted:   { label: "Rerouted",    cls: "bg-eoc-risky/15 text-eoc-risky" },
  reassigned: { label: "Reassigned",  cls: "bg-eoc-route/15 text-eoc-route" },
  complete:   { label: "Complete",    cls: "bg-white/5 text-eoc-text/40" },
};

// ── MissionCard ───────────────────────────────────────────────────────────────

interface CardProps {
  mission: Mission;
  vehicle: Vehicle | undefined;
  incident: Incident | undefined;
  isHovered: boolean;
  isExpanded: boolean;
  backupVehicle: Vehicle | undefined;
  onHoverEnter: () => void;
  onHoverLeave: () => void;
  onToggleExpand: () => void;
}

function MissionCard({
  mission, vehicle, incident, isHovered, isExpanded,
  backupVehicle, onHoverEnter, onHoverLeave, onToggleExpand,
}: CardProps) {
  const risk = riskChip(mission.route.risk_score);
  const status = STATUS_MAP[mission.status] ?? { label: mission.status, cls: "bg-white/5 text-eoc-text/40" };
  const reachable = mission.route.reachable;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ type: "spring", stiffness: 320, damping: 32 }}
      onMouseEnter={onHoverEnter}
      onMouseLeave={onHoverLeave}
      className={[
        "rounded-lg border p-3 transition-all duration-200 cursor-default select-none",
        "bg-[rgba(17,24,32,0.7)] backdrop-blur",
        isHovered
          ? "border-eoc-route/50 shadow-[0_0_16px_rgba(56,189,248,0.15)]"
          : "border-white/[0.07] hover:border-white/15",
      ].join(" ")}
    >
      {/* ── top row: callsign + status ── */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-sm font-bold text-eoc-route truncate">
            {vehicle?.callsign ?? mission.vehicle_id}
          </span>
          {vehicle && (
            <span className="shrink-0 rounded border border-white/10 px-1 font-mono text-[9px] uppercase tracking-wider text-eoc-text/35">
              {vehicle.kind === "ambulance" ? "AMB" : "RSC"}
            </span>
          )}
        </div>
        <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider ${status.cls}`}>
          {status.label}
        </span>
      </div>

      {/* ── ETA + risk ── */}
      <div className="mt-2 flex items-end gap-2">
        <span className={`font-mono text-2xl font-bold tabular-nums leading-none ${reachable ? "text-eoc-text" : "text-eoc-alert"}`}>
          {reachable ? fmtEta(mission.eta_s) : "BLOCKED"}
        </span>
        <div className="flex-1" />
        <span className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase ${risk.bg} ${risk.text} ${risk.border}`}>
          {risk.label} risk
        </span>
      </div>

      {/* ── incident ref ── */}
      {incident && (
        <div className="mt-1 flex items-center justify-between gap-2 border-t border-white/[0.04] pt-1.5">
          <p className="font-mono text-[10px] text-eoc-text/35 truncate">
            Incident {incident.id} · severity {incident.severity}
          </p>
          {incident.status !== "resolved" && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                postResolveIncident(incident.id).catch((err) =>
                  console.error("resolve incident failed", err),
                );
              }}
              className="text-[9px] font-mono uppercase tracking-widest text-eoc-safe hover:text-white transition-colors px-1.5 py-0.5 rounded border border-eoc-safe/30 hover:bg-eoc-safe hover:border-eoc-safe cursor-pointer"
            >
              Resolve
            </button>
          )}
        </div>
      )}

      {/* ── Why toggle ── */}
      {(mission.reasons ?? []).length > 0 && (
        <button
          id={`why-${mission.id}`}
          onClick={onToggleExpand}
          className="mt-2.5 flex w-full items-center gap-1 border-t border-white/[0.06] pt-2 text-left
                     font-mono text-[10px] uppercase tracking-widest text-eoc-text/35
                     transition-colors hover:text-eoc-route"
        >
          <svg
            className={`h-2.5 w-2.5 shrink-0 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}
            fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 12 12"
          >
            <path d="M4 2l4 4-4 4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Why this unit?
        </button>
      )}

      {/* ── Reasons ── */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            key="reasons"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <ul className="mt-2 space-y-1">
              {(mission.reasons ?? []).map((r, i) => (
                <li key={i} className="flex gap-1.5 text-[10px] leading-relaxed text-eoc-text/60">
                  <span className="mt-px shrink-0 text-eoc-route/50">›</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>

            {mission.backup_route?.reachable && (
              <div className="mt-2 flex items-center gap-1.5 rounded border border-eoc-route/20 bg-eoc-route/5 px-2 py-1.5">
                <svg className="h-2.5 w-2.5 shrink-0 text-eoc-route/60" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 12 12">
                  <path d="M2 6h8M7 3l3 3-3 3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span className="font-mono text-[10px] text-eoc-route/70">
                  Backup{backupVehicle ? ` · ${backupVehicle.callsign}` : ""} · ETA {fmtEta(mission.backup_route.eta_s)}
                </span>
                <span className="ml-auto font-mono text-[9px] uppercase tracking-wider text-eoc-route/35">dashed on map</span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── MissionPanel ──────────────────────────────────────────────────────────────

export function MissionPanel() {
  const missions = useAppStore((s) => s.missions);
  const vehicles = useAppStore((s) => s.vehicles);
  const incidents = useAppStore((s) => s.incidents);
  const hoveredMissionId = useAppStore((s) => s.hoveredMissionId);
  const expandedMissionId = useAppStore((s) => s.expandedMissionId);
  const setHoveredMissionId = useAppStore((s) => s.setHoveredMissionId);
  const setExpandedMissionId = useAppStore((s) => s.setExpandedMissionId);

  const active = missions.filter((m) =>
    m.status === "active" || m.status === "rerouted" || m.status === "reassigned"
  );

  const byId = <T extends { id: string }>(arr: T[], id: string) => arr.find((x) => x.id === id);

  const backupVehicleFor = useCallback(
    (m: Mission) =>
      m.backup_route
        ? vehicles.find((v) => v.status === "available" && v.id !== m.vehicle_id)
        : undefined,
    [vehicles]
  );

  if (active.length === 0) {
    return (
      <div className="rounded-lg border border-white/[0.06] bg-[rgba(17,24,32,0.5)] p-3 text-center">
        <p className="font-mono text-[10px] uppercase tracking-widest text-eoc-text/25">No active missions</p>
        <p className="mt-1 text-[10px] text-eoc-text/20">Click the map to create an incident</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <AnimatePresence mode="popLayout">
        {active.map((m) => (
          <MissionCard
            key={m.id}
            mission={m}
            vehicle={byId(vehicles, m.vehicle_id)}
            incident={byId(incidents, m.incident_id)}
            isHovered={hoveredMissionId === m.id}
            isExpanded={expandedMissionId === m.id}
            backupVehicle={backupVehicleFor(m)}
            onHoverEnter={() => setHoveredMissionId(m.id)}
            onHoverLeave={() => setHoveredMissionId(null)}
            onToggleExpand={() => setExpandedMissionId(m.id)}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}
