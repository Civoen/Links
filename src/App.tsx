import { useEffect, useState } from "react";
import ConnectPage from "./pages/ConnectPage";
import LinksPage from "./pages/LinksPage";
import CreateLinkPage from "./pages/CreateLinkPage";
import SettingsPage from "./pages/SettingsPage";
import SuggestionsPage from "./pages/SuggestionsPage";
import Toast from "./components/Toast";
import type { Link } from "../electron/linkStore";
import type { TrackSummary } from "../electron/spotifyApi";

type Screen = "loading" | "connect" | "links" | "create" | "edit" | "settings" | "suggestions";

export default function App() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [editingLink, setEditingLink] = useState<Link | null>(null);
  const [prefillTracks, setPrefillTracks] = useState<TrackSummary[] | null>(null);
  const [engineMessage, setEngineMessage] = useState<string | null>(null);

  useEffect(() => {
    window.linksAPI.isConnected().then((connected) => {
      setScreen(connected ? "links" : "connect");
    });

    const unsubscribeAuth = window.linksAPI.onAuthUpdated(() => setScreen("links"));

    // Fires whenever the link engine actually queues something — shown as
    // a brief notification regardless of which screen is currently open.
    const unsubscribeEngine = window.linksAPI.onEngineAction((message) => {
      setEngineMessage(message);
    });

    return () => {
      unsubscribeAuth();
      unsubscribeEngine();
    };
  }, []);

  if (screen === "loading") return null;

  const engineToast = engineMessage && (
    <Toast message={engineMessage} onDismiss={() => setEngineMessage(null)} />
  );

  if (screen === "connect") {
    return <ConnectPage onConnected={() => setScreen("links")} />;
  }

  if (screen === "create") {
    return (
      <>
        <CreateLinkPage
          initialTracks={prefillTracks ?? undefined}
          onSaved={() => {
            setPrefillTracks(null);
            setScreen("links");
          }}
          onCancel={() => {
            setPrefillTracks(null);
            setScreen("links");
          }}
        />
        {engineToast}
      </>
    );
  }

  if (screen === "edit" && editingLink) {
    return (
      <>
        <CreateLinkPage
          editingLink={editingLink}
          onSaved={() => {
            setEditingLink(null);
            setScreen("links");
          }}
          onCancel={() => {
            setEditingLink(null);
            setScreen("links");
          }}
        />
        {engineToast}
      </>
    );
  }

  if (screen === "settings") {
    return (
      <>
        <SettingsPage
          onBack={() => setScreen("links")}
          onDisconnected={() => setScreen("connect")}
        />
        {engineToast}
      </>
    );
  }

  if (screen === "suggestions") {
    return (
      <>
        <SuggestionsPage
          onBack={() => setScreen("links")}
          onCreateFromSuggestion={(tracks) => {
            setPrefillTracks(tracks);
            setScreen("create");
          }}
        />
        {engineToast}
      </>
    );
  }

  return (
    <>
      <LinksPage
        onCreateLink={() => setScreen("create")}
        onEditLink={(link) => {
          setEditingLink(link);
          setScreen("edit");
        }}
        onOpenSettings={() => setScreen("settings")}
        onOpenSuggestions={() => setScreen("suggestions")}
      />
      {engineToast}
    </>
  );
}
