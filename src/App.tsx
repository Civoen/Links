import { useEffect, useState } from "react";
import ConnectPage from "./pages/ConnectPage";
import LinksPage from "./pages/LinksPage";
import CreateLinkPage from "./pages/CreateLinkPage";
import SettingsPage from "./pages/SettingsPage";
import DiscoverPage from "./pages/DiscoverPage";
import AboutPage from "./pages/AboutPage";
import NotificationsPage from "./pages/NotificationsPage";
import Sidebar, { type SidebarSection } from "./components/Sidebar";
import Toast from "./components/Toast";
import type { Link } from "../electron/linkStore";
import type { TrackSummary } from "../electron/spotifyApi";
import type { EngineNotification } from "../electron/preload";

type Screen = "loading" | "connect" | "shell";

export default function App() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [activeSection, setActiveSection] = useState<SidebarSection>("links");
  const [editingLink, setEditingLink] = useState<Link | null>(null);
  const [prefillTracks, setPrefillTracks] = useState<TrackSummary[] | null>(null);
  const [engineNotification, setEngineNotification] = useState<EngineNotification | null>(null);

  useEffect(() => {
    window.linksAPI.isConnected().then((connected) => {
      setScreen(connected ? "shell" : "connect");
    });

    const unsubscribeAuth = window.linksAPI.onAuthUpdated(() => setScreen("shell"));

    // Fires whenever the link engine actually queues something (or hits a
    // warning worth surfacing) — shown as a brief toast regardless of
    // which section is currently open. The main process already checks
    // the "show notifications" setting before sending this at all, so
    // nothing extra to gate here — but it's always persisted separately,
    // so the Notifications tab has the full history even when this toast
    // is muted.
    const unsubscribeEngine = window.linksAPI.onEngineAction((notification) => {
      setEngineNotification(notification);
    });

    return () => {
      unsubscribeAuth();
      unsubscribeEngine();
    };
  }, []);

  /** Entered via the sidebar or the Links page's own "Create link" button — always starts fresh. */
  function goToFreshCreate() {
    setEditingLink(null);
    setPrefillTracks(null);
    setActiveSection("create");
  }

  function goToEdit(link: Link) {
    setPrefillTracks(null);
    setEditingLink(link);
    setActiveSection("create");
  }

  function goToCreateFromSuggestion(tracks: TrackSummary[]) {
    setEditingLink(null);
    setPrefillTracks(tracks);
    setActiveSection("create");
  }

  function returnToLinksAfterEditor() {
    setEditingLink(null);
    setPrefillTracks(null);
    setActiveSection("links");
  }

  if (screen === "loading") return null;

  const engineToast = engineNotification && (
    <Toast
      message={engineNotification.message}
      level={engineNotification.level}
      onDismiss={() => setEngineNotification(null)}
    />
  );

  if (screen === "connect") {
    return <ConnectPage onConnected={() => setScreen("shell")} />;
  }

  return (
    <div className="app-shell">
      <Sidebar
        active={activeSection}
        onNavigate={(section) => {
          // Navigating to Create directly from the sidebar (rather than via
          // "Edit" on a specific link, or "Create" on a suggestion) should
          // always start a fresh, empty chain — not resume whatever was
          // left over from a previous visit.
          if (section === "create") {
            goToFreshCreate();
          } else {
            setActiveSection(section);
          }
        }}
      />
      <div className="app-shell-content">
        {activeSection === "create" && (
          <CreateLinkPage
            editingLink={editingLink ?? undefined}
            initialTracks={prefillTracks ?? undefined}
            onSaved={returnToLinksAfterEditor}
            onCancel={returnToLinksAfterEditor}
          />
        )}

        {activeSection === "links" && (
          <LinksPage
            onCreateLink={goToFreshCreate}
            onEditLink={goToEdit}
            onOpenDiscover={() => setActiveSection("discover")}
          />
        )}

        {activeSection === "discover" && (
          <DiscoverPage onCreateFromSuggestion={goToCreateFromSuggestion} />
        )}

        {activeSection === "notifications" && <NotificationsPage />}

        {activeSection === "settings" && (
          <SettingsPage onDisconnected={() => setScreen("connect")} />
        )}

        {activeSection === "about" && <AboutPage />}
      </div>
      {engineToast}
    </div>
  );
}
