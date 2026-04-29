import { Navigate, useLocation } from "react-router-dom";
import { resolveNextPath } from "../auth/redirect";

export default function Login() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const nextRaw = params.get("next");

  if (!nextRaw) {
    return <Navigate to="/" replace />;
  }

  const safeNext = resolveNextPath(nextRaw, "/hub");
  return <Navigate to={`/?next=${encodeURIComponent(safeNext)}`} replace />;
}
