// Visual vehicle-suitability guide for the selected road. This complements
// the live fleet assignment engine: it explains which vehicle profile is safe
// for the water depth, while MissionPanel shows the actual dispatched unit.
import { motion } from "motion/react";
import { useAppStore } from "../store/useAppStore";

type Profile = {
  label: string;
  subtitle: string;
  clearance: string;
  colour: string;
  note: string;
  icon: "sedan" | "suv" | "van" | "truck";
  emoji: string;
};

function VehicleArt({ kind, colour }: { kind: Profile["icon"]; colour: string }) {
  const cabin = kind === "sedan" ? "M7 10h10l3 4H4l3-4Z" : kind === "suv" ? "M6 9h12l3 5H3l3-5Z" : kind === "van" ? "M5 7h12l4 7H3l2-7Z" : "M3 9h12l3-3h3v10H3V9Z";
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-16 w-20 shrink-0">
      <path d={cabin} fill={colour} fillOpacity=".25" stroke={colour} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M8 11h3M14 11h3" stroke={colour} strokeWidth="1.4" strokeLinecap="round" opacity=".8" />
      <circle cx="7" cy="16" r="2.2" fill="#0B0F14" stroke={colour} strokeWidth="1.5" />
      <circle cx="17" cy="16" r="2.2" fill="#0B0F14" stroke={colour} strokeWidth="1.5" />
      {kind === "van" && <path d="M11 9v5M8 11h6" stroke={colour} strokeWidth="1.3" strokeLinecap="round" />}
      {kind === "truck" && <path d="M5 9h3M16 9h3" stroke={colour} strokeWidth="1.3" strokeLinecap="round" />}
    </svg>
  );
}

function chooseProfile(depth: number): Profile {
  if (depth <= 8) return { label: "Medical Sedan", subtitle: "Fast Response Unit", clearance: "Safe up to 8 cm", colour: "#38BDF8", icon: "sedan", emoji: "🚗", note: "Ideal for dry-to-shallow conditions. Best choice for fast, low-risk emergency dispatch." };
  if (depth <= 18) return { label: "Rescue SUV", subtitle: "Raised Clearance", clearance: "Safe up to 18 cm", colour: "#22C55E", icon: "suv", emoji: "🚙", note: "Recommended for shallow surface flooding and uneven terrain approaches." };
  if (depth < 30) return { label: "Medical Van", subtitle: "Cautious Approach", clearance: "Safe up to 28 cm", colour: "#F59E0B", icon: "van", emoji: "🚐", note: "Use only with a verified passable route. The routing engine will penalize this road." };
  return { label: "Rescue Truck Only", subtitle: "Road is Closed", clearance: "Do not enter", colour: "#EF4444", icon: "truck", emoji: "🚚", note: "At 30 cm+ this road is blocked. Dispatch via an alternate safe route instead." };
}

export function FleetAdvisor() {
  const road = useAppStore((s) => s.roadInspector);
  if (!road) return null;
  const profile = chooseProfile(road.flood_depth_cm);

  return (
    <motion.section 
      initial={{ opacity: 0, y: -12, scale: 0.95 }} 
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 280, damping: 24 }}
      className="pointer-events-auto w-[360px] rounded-2xl border border-white/12 bg-[#0d1117]/96 p-4 shadow-2xl backdrop-blur-xl"
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">🚨</span>
          <p className="font-mono text-[11px] uppercase tracking-[.18em] text-eoc-text/50">Fleet Advisor</p>
        </div>
        <div className={`rounded-lg px-2.5 py-1 font-mono text-[10px] font-bold uppercase`} style={{ backgroundColor: `${profile.colour}20`, color: profile.colour }}>
          {road.flood_depth_cm.toFixed(0)} cm water
        </div>
      </div>
      
      <div className={`flex items-center gap-4 rounded-xl border-2 p-4 transition-all`} style={{ borderColor: `${profile.colour}30`, backgroundColor: `${profile.colour}08` }}>
        <div className="flex h-20 w-24 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${profile.colour}15` }}>
          <VehicleArt kind={profile.icon} colour={profile.colour} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-2xl">{profile.emoji}</span>
            <p className="text-base font-bold" style={{ color: profile.colour }}>{profile.label}</p>
          </div>
          <p className="mt-1 text-xs font-semibold text-eoc-text/70">{profile.subtitle}</p>
          <div className={`mt-2 inline-block rounded-md px-2 py-0.5 text-[10px] font-mono font-semibold uppercase`} style={{ backgroundColor: `${profile.colour}20`, color: profile.colour }}>
            {profile.clearance}
          </div>
        </div>
      </div>
      
      <div className="mt-3 rounded-lg border border-white/8 bg-white/4 px-3 py-2.5">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 text-sm">💡</span>
          <p className="text-[11px] leading-relaxed text-eoc-text/75">{profile.note}</p>
        </div>
      </div>
      
      {road.flood_depth_cm >= 30 && (
        <div className="mt-2 flex items-center gap-2 rounded-lg bg-eoc-blocked/20 border border-eoc-blocked/40 px-3 py-2">
          <span className="text-lg">⚠️</span>
          <p className="text-[10px] font-semibold text-eoc-blocked">This road is impassable - find alternate route</p>
        </div>
      )}
    </motion.section>
  );
}
