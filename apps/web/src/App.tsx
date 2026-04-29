import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import Home from "./pages/Home";
import Game from "./pages/Game";
import Landing from "./pages/Landing";
import Hub from "./pages/Hub";
import SetupExplorer from "./pages/SetupExplorer";
import Login from "./pages/Login";
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

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            <RedirectIfIdentity>
              <Landing />
            </RedirectIfIdentity>
          }
        />
        <Route path="/login" element={<Login />} />
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
          path="/setup-explorer"
          element={
            <RequireIdentity>
              <SetupExplorer />
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
