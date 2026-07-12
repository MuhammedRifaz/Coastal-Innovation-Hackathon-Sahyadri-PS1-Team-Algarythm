// Right sidebar: fixed 320px panel that owns all overlay content.
// Top to bottom: Impact Alert (when active) → Active Missions header → Mission cards.
// Scrollable so many missions never overflow off screen.
// Usage tip shown at bottom as a hint strip.
import { useAppStore } from "../store/useAppStore";
import { ImpactAlert } from "./ImpactAlert";
import { MissionPanel } from "./MissionPanel";

export function Sidebar() {
  const missions = useAppStore((s) => s.missions);
  const latestImpact = useAppStore((s) => s.latestImpact);
  const hypotheticalImpact = useAppStore((s) => s.hypotheticalImpact);
  const whatIfMode = useAppStore((s) => s.whatIfMode);

  const activeMissions = missions.filter(
    (m) => m.status === "active" || m.status === "rerouted" || m.status === "reassigned"
  );
  const hasAlert = latestImpact !== null || hypotheticalImpact !== null;

  return (
    <div
      className="absolute top-[48px] right-0 bottom-0 z-10 flex w-[320px] flex-col"
      style={{ pointerEvents: "none" }}
    >
      {/* Scrollable content column */}
      <div
        className="flex-1 overflow-y-auto px-3 py-3 space-y-3"
        style={{ pointerEvents: "auto", scrollbarWidth: "none" }}
      >
        {/* ── Impact Alert ── */}
        {hasAlert && (
          <div>
            <ImpactAlert />
          </div>
        )}

        {/* ── Missions section ── */}
        <div>
          {/* Section header */}
          <div className="flex items-center gap-2 mb-2 px-0.5">
            <span className="font-mono text-[9px] uppercase tracking-widest text-eoc-text/35">
              Active Missions
            </span>
            {activeMissions.length > 0 && (
              <span className="rounded bg-eoc-route/20 px-1.5 font-mono text-[9px] font-semibold text-eoc-route">
                {activeMissions.length}
              </span>
            )}
          </div>
          <MissionPanel />
        </div>
      </div>

      {/* ── Bottom hint strip ── */}
      <div
        className="shrink-0 border-t border-white/[0.05] bg-eoc-bg/60 px-3 py-2 backdrop-blur"
        style={{ pointerEvents: "auto" }}
      >
        {whatIfMode ? (
          <p className="font-mono text-[9px] uppercase tracking-widest text-eoc-route/70 text-center">
            What-If active — click any road to preview impact
          </p>
        ) : (
          <p className="font-mono text-[9px] uppercase tracking-widest text-eoc-text/20 text-center">
            Click road → flood · Click map → incident
          </p>
        )}
      </div>
    </div>
  );
}
