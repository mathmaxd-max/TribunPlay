import { Link, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { BoardSfxControls } from "../audio/BoardSfxControls";
import { useBoardSfx } from "../audio/boardSfx";
import {
  ensureAccountPreferencesLoaded,
  getAccountPreferences,
  patchAccountPreferences,
  type PreferredSeatColor,
} from "../settings/accountSettings";
import { PageHeaderBrand } from "../ui/PageHeaderBrand";
import { API_BASE } from "../config";
import {
  clearStoredIdentity,
  getStoredIdentity,
  setIdentityFromAuthSuccess,
  setStoredIdentity,
  type AuthSuccessResponse,
  type StoredIdentity,
} from "../auth/identityStore";

type AccountStatusResponse = {
  name: string;
  email: string;
  provider: "email" | "google";
  canRenameNow: boolean;
  nextRenameAllowedAt: string | null;
  lastNameRenameAt: string | null;
};

const formatDateTime = (value: string | null): string => {
  if (!value) return "-";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Date(parsed).toLocaleString();
};

const refreshSessionOrThrow = async (
  current: Extract<StoredIdentity, { mode: "token" }>,
): Promise<Extract<StoredIdentity, { mode: "token" }>> => {
  if (current.mode !== "token") {
    throw new Error("Sign in required.");
  }
  const refreshResponse = await fetch(`${API_BASE}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: current.session.refreshToken }),
  });
  if (!refreshResponse.ok) {
    throw new Error("Session expired. Please log in again.");
  }
  const refreshed = (await refreshResponse.json()) as AuthSuccessResponse;
  return setIdentityFromAuthSuccess(refreshed) as Extract<StoredIdentity, { mode: "token" }>;
};

export default function Settings() {
  const navigate = useNavigate();
  const [accountSettings, setAccountSettings] = useState(() => getAccountPreferences());
  const { muted, volume, setVolume, setMuted, toggleMuted } = useBoardSfx();

  const [accountStatus, setAccountStatus] = useState<AccountStatusResponse | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountNotice, setAccountNotice] = useState<string | null>(null);
  const [accountLoading, setAccountLoading] = useState(false);

  const [renameInput, setRenameInput] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeatNewPassword, setRepeatNewPassword] = useState("");

  const identity = getStoredIdentity();
  const tokenIdentity = identity && identity.mode === "token" ? identity : null;
  const tokenIdentityAccountId = tokenIdentity?.accountId ?? null;

  useEffect(() => {
    let cancelled = false;
    if (tokenIdentity) {
      void ensureAccountPreferencesLoaded(tokenIdentity.session.accessToken).then((prefs) => {
        if (cancelled) return;
        setAccountSettings(prefs);
        setVolume(prefs.boardSfx.volume);
        setMuted(prefs.boardSfx.muted);
      });
      return () => {
        cancelled = true;
      };
    }
    setAccountSettings(getAccountPreferences());
    return undefined;
  }, [tokenIdentityAccountId]);

  const handleSingleClickReselectToggle = () => {
    void patchAccountPreferences({
      singleClickCancelReselect: !accountSettings.singleClickCancelReselect,
    }).then(setAccountSettings);
  };

  const handlePreferredSeatColorChange = (value: PreferredSeatColor) => {
    void patchAccountPreferences({ preferredSeatColor: value }).then(setAccountSettings);
  };

  const handleStreamerModeToggle = () => {
    void patchAccountPreferences({ streamerMode: !accountSettings.streamerMode }).then(setAccountSettings);
  };

  const withTokenRetry = async <T,>(fn: (accessToken: string) => Promise<T>): Promise<T> => {
    const currentIdentity = getStoredIdentity();
    if (!currentIdentity || currentIdentity.mode !== "token") {
      throw new Error("This action requires a signed-in account.");
    }

    try {
      return await fn(currentIdentity.session.accessToken);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith("HTTP 401")) {
        throw error;
      }
      const refreshed = await refreshSessionOrThrow(currentIdentity);
      return fn(refreshed.session.accessToken);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const loadStatus = async () => {
      if (!tokenIdentity) return;
      setAccountLoading(true);
      setAccountError(null);
      try {
        const result = await withTokenRetry(async (accessToken) => {
          const response = await fetch(`${API_BASE}/api/account`, {
            method: "GET",
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          return (await response.json()) as AccountStatusResponse;
        });

        if (!cancelled) {
          setAccountStatus(result);
          setRenameInput(result.name);
        }
      } catch (err) {
        if (!cancelled) {
          setAccountError(err instanceof Error ? err.message : "Failed to load account status.");
        }
      } finally {
        if (!cancelled) {
          setAccountLoading(false);
        }
      }
    };

    void loadStatus();

    return () => {
      cancelled = true;
    };
  }, [tokenIdentityAccountId]);

  const handleRename = async () => {
    if (!tokenIdentity) return;
    setAccountError(null);
    setAccountNotice(null);
    setAccountLoading(true);
    try {
      const result = await withTokenRetry(async (accessToken) => {
        const response = await fetch(`${API_BASE}/api/account/rename`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ name: renameInput }),
        });

        if (response.status === 401) {
          throw new Error("HTTP 401");
        }
        const data = await response.json().catch(() => ({} as any));
        if (!response.ok) {
          throw new Error(data.error || "Rename failed.");
        }
        return data as {
          success: boolean;
          name: string;
          canRenameNow: boolean;
          nextRenameAllowedAt: string | null;
          lastNameRenameAt: string | null;
        };
      });

      const current = getStoredIdentity();
      if (current && current.mode === "token") {
        const nextIdentity: StoredIdentity = { ...current, name: result.name };
        setStoredIdentity(nextIdentity);
      }

      setAccountStatus((prev) =>
        prev
          ? {
              ...prev,
              name: result.name,
              canRenameNow: result.canRenameNow,
              nextRenameAllowedAt: result.nextRenameAllowedAt,
              lastNameRenameAt: result.lastNameRenameAt,
            }
          : null,
      );
      setAccountNotice("Account name updated.");
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : "Rename failed.");
    } finally {
      setAccountLoading(false);
    }
  };

  const handleChangePassword = async () => {
    if (!tokenIdentity) return;
    if (newPassword !== repeatNewPassword) {
      setAccountError("Passwords do not match.");
      return;
    }
    setAccountError(null);
    setAccountNotice(null);
    setAccountLoading(true);
    try {
      await withTokenRetry(async (accessToken) => {
        const response = await fetch(`${API_BASE}/api/auth/change-password`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ currentPassword, newPassword }),
        });

        if (response.status === 401) {
          throw new Error("HTTP 401");
        }
        const data = await response.json().catch(() => ({} as any));
        if (!response.ok) {
          throw new Error(data.error || "Password change failed.");
        }
        return data;
      });

      setCurrentPassword("");
      setNewPassword("");
      setRepeatNewPassword("");
      setAccountNotice("Password updated. Please log in again on your other devices.");
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : "Password change failed.");
    } finally {
      setAccountLoading(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!tokenIdentity) return;
    const confirmed = window.confirm("Delete your account permanently? This removes your settings and hides your history.");
    if (!confirmed) return;

    setAccountError(null);
    setAccountNotice(null);
    setAccountLoading(true);
    try {
      await withTokenRetry(async (accessToken) => {
        const response = await fetch(`${API_BASE}/api/account`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        if (response.status === 401) {
          throw new Error("HTTP 401");
        }
        const data = await response.json().catch(() => ({} as any));
        if (!response.ok) {
          throw new Error(data.error || "Account deletion failed.");
        }
        return data;
      });

      clearStoredIdentity();
      navigate("/auth", { replace: true });
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : "Account deletion failed.");
      setAccountLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background:
          "radial-gradient(circle at top, rgba(255, 250, 240, 0.98), rgba(234, 219, 194, 0.98)), linear-gradient(135deg, #f7f0e5 0%, #e7d7ba 45%, #d9c29c 100%)",
        color: "#1d1a14",
        fontFamily: '"Space Grotesk", "Trebuchet MS", sans-serif',
      }}
    >
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&display=swap');`}</style>

      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "14px",
          flexWrap: "wrap",
          padding: "12px 20px",
          background: "rgba(26, 21, 15, 0.92)",
          color: "#f8f1e7",
          borderBottom: "2px solid #3a2f22",
        }}
      >
        <PageHeaderBrand title="Settings" />
        <Link
          to="/hub"
          style={{
            padding: "8px 14px",
            borderRadius: "999px",
            border: "2px solid #6f5a38",
            background: "#f2d9b2",
            color: "#2a2218",
            fontWeight: 700,
            textDecoration: "none",
            letterSpacing: "1px",
            textTransform: "uppercase",
            fontSize: "12px",
          }}
        >
          Back to Hub
        </Link>
      </header>

      <main style={{ width: "100%", maxWidth: "940px", margin: "0 auto", padding: "20px 14px 24px", display: "grid", gap: "16px" }}>
        {tokenIdentity && (
          <section
            style={{
              borderRadius: "18px",
              border: "2px solid #3c3226",
              background: "rgba(255, 250, 242, 0.84)",
              boxShadow: "0 18px 30px rgba(39, 30, 20, 0.15)",
              padding: "18px",
              display: "grid",
              gap: "12px",
            }}
          >
            <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "1.3px", textTransform: "uppercase", color: "#7a6543" }}>
              Account
            </div>

            {accountStatus && (
              <div style={{ color: "#5a4630", fontSize: "14px", display: "grid", gap: "4px" }}>
                {!accountSettings.streamerMode ? <div>Email: {accountStatus.email}</div> : null}
                <div>
                  Rename cooldown: {accountStatus.canRenameNow ? "Ready now" : `Available on ${formatDateTime(accountStatus.nextRenameAllowedAt)}`}
                </div>
              </div>
            )}

            <div style={{ display: "grid", gap: "8px" }}>
              <label htmlFor="rename-input" style={{ fontSize: "12px", fontWeight: 700, color: "#6f5a38", textTransform: "uppercase", letterSpacing: "1px" }}>
                Rename account
              </label>
              <input
                id="rename-input"
                type="text"
                value={renameInput}
                onChange={(event) => setRenameInput(event.target.value)}
                disabled={accountLoading}
                style={{ padding: "10px 12px", borderRadius: "10px", border: "1px solid #ccb89b", background: "#fff9ef" }}
              />
              <button
                type="button"
                onClick={handleRename}
                disabled={accountLoading || !renameInput.trim()}
                style={{
                  width: "fit-content",
                  padding: "9px 14px",
                  borderRadius: "999px",
                  border: "2px solid #6f5a38",
                  background: accountLoading || !renameInput.trim() ? "#d8c8ab" : "#f2d9b2",
                  color: "#2a2218",
                  fontWeight: 700,
                  cursor: accountLoading || !renameInput.trim() ? "not-allowed" : "pointer",
                }}
              >
                Save name
              </button>
            </div>

            {accountStatus?.provider === "email" ? (
              <div style={{ display: "grid", gap: "8px" }}>
                <label htmlFor="current-password" style={{ fontSize: "12px", fontWeight: 700, color: "#6f5a38", textTransform: "uppercase", letterSpacing: "1px" }}>
                  Current password
                </label>
                <input
                  id="current-password"
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  disabled={accountLoading}
                  style={{ padding: "10px 12px", borderRadius: "10px", border: "1px solid #ccb89b", background: "#fff9ef" }}
                />
                <label htmlFor="new-password" style={{ fontSize: "12px", fontWeight: 700, color: "#6f5a38", textTransform: "uppercase", letterSpacing: "1px" }}>
                  New password
                </label>
                <input
                  id="new-password"
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  disabled={accountLoading}
                  style={{ padding: "10px 12px", borderRadius: "10px", border: "1px solid #ccb89b", background: "#fff9ef" }}
                />
                <label htmlFor="repeat-new-password" style={{ fontSize: "12px", fontWeight: 700, color: "#6f5a38", textTransform: "uppercase", letterSpacing: "1px" }}>
                  Confirm new password
                </label>
                <input
                  id="repeat-new-password"
                  type="password"
                  value={repeatNewPassword}
                  onChange={(event) => setRepeatNewPassword(event.target.value)}
                  disabled={accountLoading}
                  style={{ padding: "10px 12px", borderRadius: "10px", border: "1px solid #ccb89b", background: "#fff9ef" }}
                />
                <button
                  type="button"
                  onClick={handleChangePassword}
                  disabled={accountLoading || !currentPassword || !newPassword || !repeatNewPassword || newPassword !== repeatNewPassword}
                  style={{
                    width: "fit-content",
                    padding: "9px 14px",
                    borderRadius: "999px",
                    border: "2px solid #6f5a38",
                    background:
                      accountLoading || !currentPassword || !newPassword || !repeatNewPassword || newPassword !== repeatNewPassword
                        ? "#d8c8ab"
                        : "#f2d9b2",
                    color: "#2a2218",
                    fontWeight: 700,
                    cursor:
                      accountLoading || !currentPassword || !newPassword || !repeatNewPassword || newPassword !== repeatNewPassword
                        ? "not-allowed"
                        : "pointer",
                  }}
                >
                  Change password
                </button>
              </div>
            ) : (
              <div style={{ color: "#5a4630", fontSize: "14px" }}>
                Password changes are managed through your Google account.
              </div>
            )}

            <div style={{ display: "grid", gap: "8px", paddingTop: "8px", borderTop: "1px solid #d8cbb8" }}>
              <div style={{ fontSize: "13px", color: "#5a4630" }}>
                Deleting your account hides your history from your profile and removes saved setups.
              </div>
              <button
                type="button"
                onClick={handleDeleteAccount}
                disabled={accountLoading}
                style={{
                  width: "fit-content",
                  padding: "9px 14px",
                  borderRadius: "999px",
                  border: "2px solid #8b3b3b",
                  background: accountLoading ? "#efc9c6" : "#f7d7d5",
                  color: "#5c1c16",
                  fontWeight: 700,
                  cursor: accountLoading ? "not-allowed" : "pointer",
                }}
              >
                Delete account
              </button>
            </div>

            {accountNotice && (
              <div style={{ borderRadius: "12px", border: "2px solid #5b7a41", background: "#e6f2da", color: "#22451a", padding: "10px 14px", fontWeight: 600 }}>
                {accountNotice}
              </div>
            )}

            {accountError && (
              <div style={{ borderRadius: "12px", border: "2px solid #8b3b3b", background: "#f7d7d5", color: "#5c1c16", padding: "10px 14px", fontWeight: 600 }}>
                {accountError}
              </div>
            )}
          </section>
        )}

        <section
          style={{
            borderRadius: "18px",
            border: "2px solid #3c3226",
            background: "rgba(255, 250, 242, 0.84)",
            boxShadow: "0 18px 30px rgba(39, 30, 20, 0.15)",
            padding: "18px",
            display: "grid",
            gap: "12px",
          }}
        >
          <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "1.3px", textTransform: "uppercase", color: "#7a6543" }}>
            Gameplay
          </div>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              color: "#2a2218",
              fontWeight: 600,
              lineHeight: 1.35,
            }}
          >
            <input
              type="checkbox"
              checked={accountSettings.singleClickCancelReselect}
              onChange={handleSingleClickReselectToggle}
            />
            Enable single-click cancel + reselect during move input
          </label>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              color: "#2a2218",
              fontWeight: 600,
              lineHeight: 1.35,
            }}
          >
            <input
              type="checkbox"
              checked={accountSettings.streamerMode}
              onChange={handleStreamerModeToggle}
            />
            Streamer mode
          </label>
          <p style={{ margin: 0, fontSize: "13px", color: "#5a4630", lineHeight: 1.45 }}>
            Hides email and other sensitive account details in the Hub and Settings UI.
          </p>
          <div style={{ display: "grid", gap: "8px" }}>
            <label
              htmlFor="preferred-seat-color"
              style={{ fontSize: "12px", fontWeight: 700, color: "#6f5a38", textTransform: "uppercase", letterSpacing: "1px" }}
            >
              Preferred lobby seat
            </label>
            <select
              id="preferred-seat-color"
              value={accountSettings.preferredSeatColor}
              onChange={(event) => handlePreferredSeatColorChange(event.target.value as PreferredSeatColor)}
              style={{ padding: "10px 12px", borderRadius: "10px", border: "1px solid #ccb89b", background: "#fff9ef", maxWidth: "280px" }}
            >
              <option value="none">None (random)</option>
              <option value="black">Black</option>
              <option value="white">White</option>
            </select>
            <p style={{ margin: 0, fontSize: "13px", color: "#5a4630", lineHeight: 1.45 }}>
              When you host a friend lobby, you are seated automatically after joining. None picks a random open seat.
            </p>
          </div>
        </section>

        <section
          style={{
            borderRadius: "18px",
            border: "2px solid #3c3226",
            background: "rgba(255, 250, 242, 0.84)",
            boxShadow: "0 18px 30px rgba(39, 30, 20, 0.15)",
            padding: "18px",
            display: "grid",
            gap: "12px",
          }}
        >
          <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "1.3px", textTransform: "uppercase", color: "#7a6543" }}>
            Board Sound
          </div>
          <BoardSfxControls
            muted={muted}
            volume={volume}
            onToggleMuted={toggleMuted}
            onVolumeChange={setVolume}
          />
        </section>
      </main>
    </div>
  );
}
