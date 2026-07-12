// ResQOS App layout:
//  ┌─────────────────────────────────────────┐
//  │ Header (48px, full width, z-20)         │
//  ├────────────────────────────┬────────────┤
//  │                            │  Sidebar   │
//  │   MapView (full-bleed)     │  (320px)   │
//  │                            │            │
//  └────────────────────────────┴────────────┘
//
// MapView fills the entire viewport (behind everything).
// Header sits on top at z-20.
// Sidebar sits on top at z-10, right-aligned, below the header.
// No more overlapping absolute panels.

import { useEffect } from "react";
import { MapView } from "./map/MapView";
import { Header } from "./components/Header";
import { Sidebar } from "./components/Sidebar";
import { DecisionLog } from "./components/DecisionLog";
import { ScenarioBar } from "./components/ScenarioBar";
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
    <div className="relative h-dvh w-dvw overflow-hidden bg-eoc-bg text-eoc-text">
      {/* Full-bleed map — renders under everything */}
      <MapView />

      {/* Header bar — top, full width, above map */}
      <Header />

      {/* Right sidebar — below header, right edge */}
      <Sidebar />

      {/* Bottom decision ticker */}
      <DecisionLog />

      {/* Bottom center scenario control bar */}
      <ScenarioBar />
    </div>
  );
}

export default App;

