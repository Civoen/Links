import { useEffect, useRef, useState } from "react";
import ConnectPage from "./pages/ConnectPage";
import LinksPage from "./pages/LinksPage";
import CreateLinkPage from "./pages/CreateLinkPage";
import SettingsPage from "./pages/SettingsPage";
import HealthPage from "./pages/HealthPage";
import AboutPage from "./pages/AboutPage";
import NotificationsPage from "./pages/NotificationsPage";
import HowItWorksPage from "./pages/HowItWorksPage";
import Sidebar, { type SidebarSection } from "./components/Sidebar";
import Toast from "./components/Toast";
import type { Link } from "../electron/linkStore";
import type { EngineNotification } from "../electron/preload";

type Screen = "loading" | "connect" | "shell";

export default function App() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [activeSection, setActiveSection] = useState<SidebarSection>("links");
  const [editingLink, setEditingLink] = useState<Link | null>(null);
  const [engineNotification, setEngineNotification] = useState<EngineNotification | null>(null);
  const [hasUnseenUpdate, setHasUnseenUpdate] = useState(false);

  // Read inside the update-status listener below, which is set up once on
  // mount — a plain closure over activeSection would go stale the moment
  // the user navigates, since this effect never re-runs.
  const activeSectionRef = useRef(activeSection);
  useEffect(() => {
    activeSectionRef.current = activeSection;
  }, [activeSection]);

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
    // so the Notifications and Health tabs have the full history even
    // when this toast is muted.
    const unsubscribeEngine = window.linksAPI.onEngineAction((notification) => {
      setEngineNotification(notification);
    });

    // An update finishing its download is the moment worth flagging with
    // the sidebar dot — "available" alone isn't actionable yet (it's still
    // downloading), but "downloaded" means there's genuinely something to
    // go look at. Skipped entirely if the user is already on Settings,
    // since they'd see it directly there anyway.
    const unsubscribeUpdate = window.linksAPI.onUpdateStatus((status) => {
      if (status.status === "downloaded" && activeSectionRef.current !== "settings") {
        setHasUnseenUpdate(true);
      }
    });

    return () => {
      unsubscribeAuth();
      unsubscribeEngine();
      unsubscribeUpdate();
    };
  }, []);

  /** Entered via the sidebar or the Links page's own "Create link" button — always starts fresh. */
  function goToFreshCreate() {
    setEditingLink(null);
    setActiveSection("create");
  }

  function goToEdit(link: Link) {
    setEditingLink(link);
    setActiveSection("create");
  }

  function returnToLinksAfterEditor() {
    setEditingLink(null);
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
        hasUnseenUpdate={hasUnseenUpdate}
        onNavigate={(section) => {
          // Navigating to Create directly from the sidebar (rather than via
          // "Edit" on a specific link) should always start a fresh, empty
          // chain — not resume whatever was left over from a previous visit.
          if (section === "create") {
            goToFreshCreate();
          } else {
            setActiveSection(section);
          }
          if (section === "settings") setHasUnseenUpdate(false);
        }}
      />
      <div className="app-shell-content">
        {activeSection === "create" && (
          <CreateLinkPage
            editingLink={editingLink ?? undefined}
            onSaved={returnToLinksAfterEditor}
            onCancel={returnToLinksAfterEditor}
          />
        )}

        {activeSection === "links" && (
          <LinksPage onCreateLink={goToFreshCreate} onEditLink={goToEdit} />
        )}

        {activeSection === "health" && <HealthPage />}

        {activeSection === "notifications" && <NotificationsPage />}

        {activeSection === "settings" && (
          <SettingsPage onDisconnected={() => setScreen("connect")} />
        )}

        {activeSection === "about" && <AboutPage />}

        {activeSection === "howItWorks" && <HowItWorksPage onCreateLink={goToFreshCreate} />}
      </div>
      {engineToast}
    </div>
  );
}
