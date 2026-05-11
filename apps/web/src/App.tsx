import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { DocumentHead } from "./DocumentHead";
import Home from "./pages/Home";
import Game from "./pages/Game";
import Welcome from "./pages/Welcome";
import Auth from "./pages/Auth";
import Guest from "./pages/Guest";
import Hub from "./pages/Hub";
import History from "./pages/History";
import Review from "./pages/Review";
import SetupExplorer from "./pages/SetupExplorer";
import Settings from "./pages/Settings";
import Login from "./pages/Login";
import VerifyEmail from "./pages/VerifyEmail";
import Datenschutz from "./pages/Datenschutz";
import Disclaimer from "./pages/Disclaimer";
import Impressum from "./pages/Impressum";
import { getStoredIdentity } from "./auth/identityStore";
import type { ReactNode } from "react";

function RequireIdentity({ children }: { children: ReactNode }) {
  const location = useLocation();
  const identity = getStoredIdentity();
  if (!identity) {
    const next = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={`/?next=${encodeURIComponent(next)}`} replace />;
  }
  return <>{children}</>;
}

function RedirectIfIdentity({ children }: { children: ReactNode }) {
  const identity = getStoredIdentity();
  if (identity) {
    return <Navigate to="/hub" replace />;
  }
  return <>{children}</>;
}

function RequireNonGuest({ children }: { children: ReactNode }) {
  const location = useLocation();
  const identity = getStoredIdentity();
  if (!identity) {
    const next = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={`/?next=${encodeURIComponent(next)}`} replace />;
  }
  if (identity.mode === "guest") {
    const next = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={`/guest?reason=restricted&next=${encodeURIComponent(next)}`} replace />;
  }
  return <>{children}</>;
}

function App() {
  return (
    <BrowserRouter>
      <DocumentHead />
      <Routes>
        <Route
          path="/"
          element={
            <RedirectIfIdentity>
              <Welcome />
            </RedirectIfIdentity>
          }
        />
        <Route path="/login" element={<Login />} />
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/auth" element={<Auth />} />
        <Route path="/guest" element={<Guest />} />
        <Route
          path="/hub"
          element={
            <RequireIdentity>
              <Hub />
            </RequireIdentity>
          }
        />
        <Route
          path="/play"
          element={
            <RequireIdentity>
              <Home />
            </RequireIdentity>
          }
        />
        <Route
          path="/history"
          element={
            <RequireNonGuest>
              <History />
            </RequireNonGuest>
          }
        />
        <Route
          path="/review/:gameId"
          element={
            <RequireNonGuest>
              <Review />
            </RequireNonGuest>
          }
        />
        <Route
          path="/setup-explorer"
          element={
            <RequireIdentity>
              <SetupExplorer />
            </RequireIdentity>
          }
        />
        <Route
          path="/settings"
          element={
            <RequireIdentity>
              <Settings />
            </RequireIdentity>
          }
        />
        <Route path="/game/:code" element={<Game />} />
        <Route path="/datenschutz" element={<Datenschutz />} />
        <Route path="/disclaimer" element={<Disclaimer />} />
        <Route path="/impressum" element={<Impressum />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
