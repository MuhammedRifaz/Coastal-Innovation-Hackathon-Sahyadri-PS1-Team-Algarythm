import { useEffect } from "react";
import { MapView } from "./map/MapView";
import { LatencyBadge } from "./components/LatencyBadge";
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
      <MapView />
      <LatencyBadge />
    </div>
  );
}

export default App;
