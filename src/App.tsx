import { useEffect, useState } from "react";
import ConnectPage from "./pages/ConnectPage";
import LinksPage from "./pages/LinksPage";
import CreateLinkPage from "./pages/CreateLinkPage";
import SettingsPage from "./pages/SettingsPage";
import DiscoverPage from "./pages/DiscoverPage";
import AboutPage from "./pages/AboutPage";
import Sidebar, { type SidebarSection } from "./components/Sidebar";
import Toast from "./components/Toast";
import type { Link } from "../electron/linkStore";
import type { TrackSummary } from "../electron/spotifyApi";

type Screen = "loading" | "connect" | "shell" | "create" | "edit";

export default function App() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [activeSection, setActiveSection] = useState<SidebarSection>("links");
  const [editingLink, setEditingLink] = useState<Link | null>(null);
  const [prefillTracks, setPrefillTracks] = useState<TrackSummary[] | null>(null);
  const [engineMessage, setEngineMessage] = useState<string | null>(null);

  useEffect(() => {
    window.linksAPI.isConnected().then((connected) => {
      setScreen(connected ? "shell" : "connect");
    });

    const unsubscribeAuth = window.linksAPI.onAuthUpdated(() => setScreen("shell"));

    // Fires whenever the link engine actually queues something — shown as
    // a brief notification regardless of which section is currently open.
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
    return <ConnectPage onConnected={() => setScreen("shell")} />;
  }

  if (screen === "create") {
    return (
      <>
        <CreateLinkPage
          initialTracks={prefillTracks ?? undefined}
          onSaved={() => {
            setPrefillTracks(null);
            setActiveSection("links");
            setScreen("shell");
          }}
          onCancel={() => {
            setPrefillTracks(null);
            setScreen("shell");
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
            setActiveSection("links");
            setScreen("shell");
          }}
          onCancel={() => {
            setEditingLink(null);
            setScreen("shell");
          }}
        />
        {engineToast}
      </>
    );
  }

  return (
    <div className="app-shell">
      <Sidebar active={activeSection} onNavigate={setActiveSection} />
      <div className="app-shell-content">
        {activeSection === "links" && (
          <LinksPage
            onCreateLink={() => setScreen("create")}
            onEditLink={(link) => {
              setEditingLink(link);
              setScreen("edit");
            }}
            onOpenDiscover={() => setActiveSection("discover")}
          />
        )}

        {activeSection === "discover" && (
          <DiscoverPage
            onCreateFromSuggestion={(tracks) => {
              setPrefillTracks(tracks);
              setScreen("create");
            }}
          />
        )}

        {activeSection === "settings" && (
          <SettingsPage onDisconnected={() => setScreen("connect")} />
        )}

        {activeSection === "about" && <AboutPage />}
      </div>
      {engineToast}
    </div>
  );
}
