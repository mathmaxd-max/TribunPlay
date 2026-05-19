import { useNavigate } from 'react-router-dom';
import { resolveStartColor } from '../clock/buildTimeControl';
import { PageHeaderBrand } from '../ui/PageHeaderBrand';
import { PlaySettingsForm } from '../play/PlaySettingsForm';
import { saveLocalLobbyPayload } from '../play/localLobbySession';
import type { LocalLobbyPayload, PlayLobbySubmitPayload } from '../play/types';

export default function LocalLobby() {
  const navigate = useNavigate();

  const handleStartLocalGame = (payload: PlayLobbySubmitPayload) => {
    const localPayload: LocalLobbyPayload = {
      mode: 'local',
      createdAtMs: Date.now(),
      resolvedStartColor: resolveStartColor(payload.roomSettings.startColor),
      timeControl: payload.timeControl,
      roomSettings: payload.roomSettings,
    };
    saveLocalLobbyPayload(localPayload);
    navigate('/local/play', { state: localPayload });
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background:
          'radial-gradient(circle at top, rgba(255, 250, 240, 0.98), rgba(234, 219, 194, 0.98)), linear-gradient(135deg, #f7f0e5 0%, #e7d7ba 45%, #d9c29c 100%)',
        color: '#1d1a14',
        fontFamily: '"Space Grotesk", "Trebuchet MS", sans-serif',
      }}
    >
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&family=JetBrains+Mono:wght@500&display=swap');`}</style>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 20px',
          gap: '16px',
          background: 'rgba(26, 21, 15, 0.92)',
          color: '#f8f1e7',
          borderBottom: '2px solid #3a2f22',
          flexWrap: 'wrap',
        }}
      >
        <PageHeaderBrand title="Local Game" textColumnStyle={{ minWidth: '140px' }} />
        <button
          type="button"
          onClick={() => navigate('/hub')}
          style={{
            padding: '8px 14px',
            borderRadius: '999px',
            background: '#f2d9b2',
            border: '2px solid #6f5a38',
            color: '#2a2218',
            fontWeight: 700,
            letterSpacing: '1px',
            textTransform: 'uppercase',
            cursor: 'pointer',
          }}
        >
          Home
        </button>
      </div>

      <div style={{ width: '100%', maxWidth: '860px', margin: '0 auto', padding: '20px 14px 24px', display: 'grid', gap: '16px' }}>
        <PlaySettingsForm mode="local" title="Start Local Game" submitLabel="Start Local Game" onSubmit={handleStartLocalGame} />
      </div>
    </div>
  );
}
