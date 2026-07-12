import { useEffect } from "react";
import { MapView } from "./map/MapView";
import { Header } from "./components/Header";
import { LatencyBadge } from "./components/LatencyBadge";
import { ImpactAlert } from "./components/ImpactAlert";
import { MissionPanel } from "./components/MissionPanel";
import { WhatIfToggle } from "./components/WhatIfToggle";
import { ScenarioBar } from "./components/ScenarioBar";
import { DecisionLog } from "./components/DecisionLog";
import { RoadInspector } from "./components/RoadInspector";
import { RoutePlanner } from "./components/RoutePlanner";
import { FleetAdvisor } from "./components/FleetAdvisor";
import { getGraph } from "./lib/api";
import { connectWebSocket } from "./lib/ws";
import { useAppStore } from "./store/useAppStore";

function App() {
  useEffect(() => {
    getGraph()
      .then((data) => useAppStore.getState().setFromGraphResponse(data))
      .catch((err) => console.error("initial /api/graph fetch failed", err));

    connectWebSocket();
  }, []);

  return (
    <div className="relative flex h-dvh w-dvw flex-col overflow-hidden bg-eoc-bg text-eoc-text">
      <Header />

      <div className="relative flex-1">
        <MapView />

        {/* Right-side stack: latency badge, road inspector, impact alert, mission panel */}
        <div className="pointer-events-none absolute top-4 right-4 z-10 flex flex-col items-end gap-3">
          <LatencyBadge />
          <RoadInspector />
          <FleetAdvisor />
          <ImpactAlert />
          <MissionPanel />
        </div>

        {/* Bottom-center: scenario controls + what-if toggle + route planner */}
        <div className="pointer-events-none absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-2">
          <div className="flex items-center gap-3">
            <WhatIfToggle />
            <RoutePlanner />
          </div>
          <ScenarioBar />
        </div>

        {/* Bottom-left: decision log ticker */}
        <div className="pointer-events-none absolute bottom-6 left-4 z-10 hidden xl:block">
          <DecisionLog />
        </div>
      </div>
    </div>
  );
}

export default App;


