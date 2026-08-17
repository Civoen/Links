import { useEffect, useState } from "react";
import ConnectPage from "./pages/ConnectPage";
import LinksPage from "./pages/LinksPage";
import CreateLinkPage from "./pages/CreateLinkPage";

type Screen = "loading" | "connect" | "links" | "create";

export default function App() {
  const [screen, setScreen] = useState<Screen>("loading");

  useEffect(() => {
    window.linksAPI.isConnected().then((connected) => {
      setScreen(connected ? "links" : "connect");
    });

    // Fires once the OAuth redirect has been handled in the main process.
    const unsubscribe = window.linksAPI.onAuthUpdated(() => setScreen("links"));
    return unsubscribe;
  }, []);

  if (screen === "loading") return null;

  if (screen === "connect") {
    return <ConnectPage onConnected={() => setScreen("links")} />;
  }

  if (screen === "create") {
    return (
      <CreateLinkPage
        onSaved={() => setScreen("links")}
        onCancel={() => setScreen("links")}
      />
    );
  }

  return <LinksPage onCreateLink={() => setScreen("create")} />;
}
