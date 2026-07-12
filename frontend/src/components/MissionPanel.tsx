// Right-side stack of active mission cards: unit, incident, ETA, risk,
// status, and an expandable "Why" section. Hovering a card tells
// MapView (via the store) to highlight its route and dim the rest;
// expanding a card also reveals its backup route as a dashed 50%-opacity
// line on the map.
import { motion } from "motion/react";
import { useAppStore } from "../store/useAppStore";
import { postResolveIncident } from "../lib/api";
import type { VehicleKind } from "../lib/types";

function VehicleIcon({ kind }: { kind: VehicleKind }) {
  if (kind === "ambulance") {
    return (
      <svg width="32" height="32" viewBox="0 0 20 20" fill="none" className="shrink-0">
        <rect x="1" y="6" width="14" height="9" rx="1.5" fill="#38BDF8" fillOpacity="0.2" stroke="#38BDF8" strokeWidth="1.5"/>
        <rect x="15" y="9" width="4" height="6" rx="1" fill="#38BDF8" fillOpacity="0.2" stroke="#38BDF8" strokeWidth="1.5"/>
        <circle cx="4.5" cy="15.5" r="1.8" fill="#38BDF8"/>
        <circle cx="12.5" cy="15.5" r="1.8" fill="#38BDF8"/>
        <rect x="6" y="8.5" width="1.4" height="4.5" rx="0.7" fill="#38BDF8"/>
        <rect x="4.4" y="10.1" width="4" height="1.4" rx="0.7" fill="#38BDF8"/>
        <rect x="1.5" y="7.5" width="4" height="2" rx="0.5" fill="#38BDF8" fillOpacity="0.6"/>
        <circle cx="8" cy="10.5" r="1.5" fill="#38BDF8" fillOpacity="0.3"/>
      </svg>
    );
  }
  return (
    <svg width="32" height="32" viewBox="0 0 20 20" fill="none" className="shrink-0">
      <rect x="1" y="7" width="16" height="8" rx="1.5" fill="#22C55E" fillOpacity="0.2" stroke="#22C55E" strokeWidth="1.5"/>
      <rect x="12" y="5" width="5" height="5" rx="1" fill="#22C55E" fillOpacity="0.2" stroke="#22C55E" strokeWidth="1.5"/>
      <circle cx="4.5" cy="15.5" r="1.8" fill="#22C55E"/>
      <circle cx="13.5" cy="15.5" r="1.8" fill="#22C55E"/>
      <rect x="1" y="9" width="10" height="2" rx="0.5" fill="#22C55E" fillOpacity="0.3"/>
      <rect x="3" y="10" width="6" height="1" rx="0.3" fill="#22C55E" fillOpacity="0.4"/>
    </svg>
  );
}

const STATUS_LABEL: Record<string, string> = {
  active: "🚀 Active",
  rerouted: "⚠️ Rerouted",
  reassigned: "🔄 Reassigned",
  complete: "✅ Complete",
};

const STATUS_COLOR: Record<string, string> = {
  active: "text-eoc-safe",
  rerouted: "text-eoc-risky",
  reassigned: "text-eoc-route",
  complete: "text-eoc-text/40",
};

const STATUS_BG: Record<string, string> = {
  active: "bg-eoc-safe/20 border-eoc-safe/40",
  rerouted: "bg-eoc-risky/20 border-eoc-risky/40",
  reassigned: "bg-eoc-route/20 border-eoc-route/40",
  complete: "bg-white/10 border-white/20",
};

function riskChipColor(risk: number): string {
  if (risk >= 50) return "bg-eoc-blocked/20 text-eoc-blocked border-eoc-blocked/40";
  if (risk > 0) return "bg-eoc-risky/20 text-eoc-risky border-eoc-risky/40";
  return "bg-eoc-safe/20 text-eoc-safe border-eoc-safe/40";
}

export function MissionPanel() {
  const allMissions = useAppStore((s) => s.missions);
  const missions = allMissions.filter((m) => m.status !== "complete");
  const vehicles = useAppStore((s) => s.vehicles);
  const incidents = useAppStore((s) => s.incidents);
  const expandedMissionId = useAppStore((s) => s.expandedMissionId);
  const setHoveredMissionId = useAppStore((s) => s.setHoveredMissionId);
  const setExpandedMissionId = useAppStore((s) => s.setExpandedMissionId);

  if (missions.length === 0) {
    return (
      <div className="pointer-events-none w-[340px]">
        <div className="pointer-events-auto rounded-2xl border border-white/10 bg-[#0d1117]/95 p-5 text-center backdrop-blur-xl">
          <span className="text-3xl">🎯</span>
          <p className="mt-2 text-xs text-eoc-text/50">No active missions</p>
          <p className="mt-1 text-[10px] text-eoc-text/30">Click the map to report an incident</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-none flex max-h-[65vh] w-[340px] flex-col gap-3 overflow-y-auto">
      {missions.map((mission) => {
        const vehicle = vehicles.find((v) => v.id === mission.vehicle_id);
        const incident = incidents.find((i) => i.id === mission.incident_id);
        const isExpanded = expandedMissionId === mission.id;

        return (
          <motion.div
            key={mission.id}
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            onMouseEnter={() => setHoveredMissionId(mission.id)}
            onMouseLeave={() => setHoveredMissionId(null)}
            className={`pointer-events-auto rounded-2xl border p-4 text-eoc-text backdrop-blur-xl transition-all ${
              isExpanded ? 'border-eoc-route/50 bg-[#0d1117]/98' : 'border-white/10 bg-[#0d1117]/95 hover:border-eoc-route/30'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className={`rounded-xl p-2 ${vehicle?.kind === 'ambulance' ? 'bg-sky-500/20' : 'bg-green-500/20'}`}>
                  {vehicle && <VehicleIcon kind={vehicle.kind} />}
                </div>
                <div>
                  <div className="font-mono text-base font-bold">{vehicle?.callsign ?? "Unassigned"}</div>
                  <div className="text-[10px] font-semibold uppercase text-eoc-text/50">{vehicle?.kind.replace("_", " ") ?? ""}</div>
                </div>
              </div>
              <div className={`rounded-lg border px-2 py-1 font-mono text-[10px] font-bold uppercase ${STATUS_BG[mission.status] ?? ""} ${STATUS_COLOR[mission.status] ?? ""}`}>
                {STATUS_LABEL[mission.status] ?? mission.status}
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-white/5 p-2">
                <div className="text-[9px] uppercase text-eoc-text/40">Incident</div>
                <div className="font-mono text-xs font-semibold">{incident?.id ?? mission.incident_id}</div>
              </div>
              <div className="rounded-lg bg-white/5 p-2">
                <div className="text-[9px] uppercase text-eoc-text/40">ETA</div>
                <div className="font-mono text-xs font-bold">{mission.eta_s.toFixed(0)}s</div>
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between">
              <span className={`rounded-lg border px-2 py-1 font-mono text-[10px] font-bold ${riskChipColor(mission.route.risk_score)}`}>
                Risk: {mission.route.risk_score.toFixed(0)}
              </span>
              <span className="text-[10px] text-eoc-text/50">Distance: {(mission.route.distance_m / 1000).toFixed(1)}km</span>
            </div>

            {incident && (
              <button
                onClick={() => postResolveIncident(incident.id).catch((err) => console.error("resolve failed", err))}
                className="mt-3 w-full rounded-xl border border-white/10 bg-white/5 py-2 text-[10px] font-bold uppercase tracking-wide text-eoc-text/70 transition-all hover:border-eoc-safe/50 hover:bg-eoc-safe/10 hover:text-eoc-safe"
              >
                ✅ Mark Resolved
              </button>
            )}

            <button
              onClick={() => setExpandedMissionId(isExpanded ? null : mission.id)}
              className="mt-2 flex w-full items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-eoc-text/50 hover:text-eoc-text transition-colors"
            >
              <span>💡 Why this route?</span>
              <span className="text-lg">{isExpanded ? "▲" : "▼"}</span>
            </button>

            {isExpanded && (
              <motion.ul
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-2 space-y-2 overflow-hidden rounded-lg bg-white/5 p-3 text-xs"
              >
                {mission.reasons.length === 0 && <li className="text-eoc-text/40 italic">No reasons recorded.</li>}
                {mission.reasons.map((reason) => (
                  <li key={reason} className="flex items-start gap-2 text-eoc-text/80">
                    <span className="mt-0.5 text-eoc-route">•</span>
                    <span>{reason}</span>
                  </li>
                ))}
                {mission.backup_route && (
                  <li className="flex items-start gap-2 text-eoc-route font-semibold">
                    <span className="mt-0.5">🔄</span>
                    <span>Backup route available (shown dashed on map)</span>
                  </li>
                )}
              </motion.ul>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}
