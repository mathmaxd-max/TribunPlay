import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import * as engine from "@tribunplay/engine";
import { API_BASE } from "../config";
import {
  getStoredIdentity,
  setIdentityFromAuthSuccess,
  type AuthSuccessResponse,
  type StoredIdentity,
} from "../auth/identityStore";
import { getBaseColor, getHexagonColor } from "../hexagonColors";
import { SplitUnitGlyph, UnitGlyph } from "../ui/UnitGlyph";
import {
  buildOpponentMoveTimeline,
  cubicEaseInOut,
  OPPONENT_MOVE_EASING,
  reverseOpponentMoveTimeline,
  type OpponentMoveTimeline,
  type PositionRef,
  type VisualUnit,
} from "../ui/animations/opponentMoveTimeline";
import { useBoardSfx, type BoardSfxEvent } from "../audio/boardSfx";
import { preloadBoardAssets } from "../audio/boardSfx";
import { areAllUnitIconsReady, preloadAllUnitIcons } from "../ui/unitIcons";
import { PageHeaderBrand } from "../ui/PageHeaderBrand";
import { ContinueMenu } from "../ui/ContinueMenu";
import { navPillButtonStyle, navPillLinkStyle } from "../ui/pageNavStyles";
import {
  buildContinueTargetsFromEngineState,
  saveLocalLobbyPrefill,
} from "../navigation";
import { openFriendLobbyFromPrefill } from "../play/createFriendGame";

type ReplayAction = {
  ply: number;
  actionU32: number;
  actorColor: number | null;
  createdAt: string;
};

type ReplayGame = {
  gameId: string;
  code: string;
  status: string;
  seat: "black" | "white";
  opponent: { name: string | null };
  winnerColor: number | null;
  endOpcode: number | null;
  endReason: number | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
};

type ReplayResponse = {
  game: ReplayGame;
  snapshot: {
    boardB64: string;
    initialTurn: engine.Color;
    timeControl: unknown;
  };
  actions: ReplayAction[];
  actionsB64: string;
};

type TilePixelData = {
  cid: number;
  x: number;
  y: number;
  displayX: number;
  displayY: number;
  centerX: number;
  centerY: number;
  hexX: number;
  hexY: number;
};

type ActiveReplayAnimation = {
  id: number;
  timeline: OpponentMoveTimeline;
  startedAtMs: number;
  nowMs: number;
  soundEvent: BoardSfxEvent | null;
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

const formatDateTime = (value: string | null): string => {
  if (!value) return "-";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Date(parsed).toLocaleString();
};

const isReplayStepAction = (actionU32: number): boolean => engine.isBoardMoveOpcode(engine.opcode(actionU32 >>> 0));

const mapStepSound = (forwardBefore: engine.State, forwardAfter: engine.State): BoardSfxEvent | null => {
  if (forwardBefore.status !== "ended" && forwardAfter.status === "ended") {
    return "gameEnded";
  }
  return "moveReceived";
};

export default function Review() {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creatingFriendLobby, setCreatingFriendLobby] = useState(false);
  const [game, setGame] = useState<ReplayGame | null>(null);
  const [actions, setActions] = useState<number[]>([]);
  const [states, setStates] = useState<engine.State[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [changedTiles, setChangedTiles] = useState<number[]>([]);
  const [isFlipped, setIsFlipped] = useState(false);
  const [unitIconsReady, setUnitIconsReady] = useState(() => areAllUnitIconsReady());
  const [boardViewportWidth, setBoardViewportWidth] = useState(0);
  const [boardViewportHeight, setBoardViewportHeight] = useState(0);
  const [activeAnimation, setActiveAnimation] = useState<ActiveReplayAnimation | null>(null);
  const [tribunCaptureAttackerCid, setTribunCaptureAttackerCid] = useState<number | null>(null);
  const animationIdRef = useRef(0);
  const boardViewportRef = useRef<HTMLDivElement | null>(null);
  const { playSfx } = useBoardSfx();

  useEffect(() => {
    void preloadBoardAssets();
    let active = true;
    if (areAllUnitIconsReady()) {
      setUnitIconsReady(true);
      return () => {
        active = false;
      };
    }
    void preloadAllUnitIcons().then(() => {
      if (active) {
        setUnitIconsReady(true);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const element = boardViewportRef.current;
    if (!element) return;
    const resize = () => {
      const rect = element.getBoundingClientRect();
      setBoardViewportWidth(rect.width);
      setBoardViewportHeight(rect.height);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    window.addEventListener("resize", resize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [states.length]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        if (!gameId) {
          throw new Error("Missing game id.");
        }
        const identity = getStoredIdentity();
        if (!identity || identity.mode !== "token") {
          throw new Error("Review mode is only available for authenticated accounts.");
        }
        const tokenIdentity: Extract<StoredIdentity, { mode: "token" }> = identity;

        let accessToken = tokenIdentity.session.accessToken;
        const doFetch = async () =>
          fetch(`${API_BASE}/api/history/${encodeURIComponent(gameId)}`, {
            method: "GET",
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          });

        let response = await doFetch();
        if (!response.ok && response.status === 401) {
          const nextIdentity = await refreshSessionOrThrow(tokenIdentity);
          accessToken = nextIdentity.session.accessToken;
          response = await doFetch();
        }

        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: "Failed to load replay" }));
          throw new Error(err.error || "Failed to load replay");
        }

        const data = (await response.json()) as ReplayResponse;
        const initialState: engine.State = {
          board: engine.unpackBoard(data.snapshot.boardB64),
          turn: data.snapshot.initialTurn,
          ply: 0,
          drawOfferBy: null,
          drawOfferBlocked: null,
          status: "active",
          winner: null,
        };

        const allActions = (data.actions ?? []).map((entry) => entry.actionU32 >>> 0);
        const replayActions: number[] = [];
        const replayStates: engine.State[] = [initialState];
        let currentState = initialState;
        let detectedTribunCaptureAttackerCid: number | null = null;

        for (const actionWord of allActions) {
          const next = engine.applyAction(currentState, actionWord >>> 0);
          const decoded = engine.decodeAction(actionWord >>> 0);
          if (decoded.opcode === 9 && next.status === "ended") {
            detectedTribunCaptureAttackerCid = decoded.fields.attackerCid;
          }
          if (isReplayStepAction(actionWord)) {
            replayActions.push(actionWord >>> 0);
            replayStates.push(next);
          }
          currentState = next;
        }

        if (!cancelled) {
          setGame(data.game);
          setActions(replayActions);
          setStates(replayStates);
          setCurrentIndex(0);
          setChangedTiles([]);
          setActiveAnimation(null);
          setTribunCaptureAttackerCid(detectedTribunCaptureAttackerCid);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load replay");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [gameId]);

  useEffect(() => {
    if (!activeAnimation) return;
    let rafId = 0;
    const animationId = activeAnimation.id;

    const tick = (timestampMs: number) => {
      setActiveAnimation((previous) => {
        if (!previous || previous.id !== animationId) return previous;
        if (timestampMs - previous.startedAtMs >= previous.timeline.totalDurationMs) {
          if (previous.soundEvent) {
            playSfx(previous.soundEvent);
          }
          return null;
        }
        return {
          ...previous,
          nowMs: timestampMs,
        };
      });
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [activeAnimation, playSfx]);

  const currentState = states[currentIndex] ?? null;

  const startStepAnimation = (params: {
    timeline: OpponentMoveTimeline;
    soundEvent: BoardSfxEvent | null;
  }) => {
    if (params.timeline.primitives.length === 0 || params.timeline.totalDurationMs <= 0) {
      if (params.soundEvent) {
        playSfx(params.soundEvent);
      }
      setActiveAnimation(null);
      return;
    }

    animationIdRef.current += 1;
    const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
    setActiveAnimation({
      id: animationIdRef.current,
      timeline: params.timeline,
      startedAtMs: nowMs,
      nowMs,
      soundEvent: params.soundEvent,
    });
  };

  const canStepForward = !loading && !activeAnimation && currentIndex < actions.length;
  const canStepBack = !loading && !activeAnimation && currentIndex > 0;

  const goNext = () => {
    if (!canStepForward) return;
    const fromIndex = currentIndex;
    const toIndex = fromIndex + 1;
    const actionWord = actions[fromIndex];
    const before = states[fromIndex];
    const after = states[toIndex];
    const delta = engine.deriveBoardDelta(before.board, after.board);
    const timeline = buildOpponentMoveTimeline({
      beforeState: before,
      afterState: after,
      actionWord,
      changedCids: delta.changedCids,
    });

    setCurrentIndex(toIndex);
    setChangedTiles(delta.changedCids);
    startStepAnimation({
      timeline,
      soundEvent: mapStepSound(before, after),
    });
  };

  const goPrev = () => {
    if (!canStepBack) return;
    const fromIndex = currentIndex;
    const toIndex = fromIndex - 1;
    const actionWord = actions[toIndex];
    const forwardBefore = states[toIndex];
    const forwardAfter = states[fromIndex];
    const delta = engine.deriveBoardDelta(forwardAfter.board, forwardBefore.board);
    const forwardTimeline = buildOpponentMoveTimeline({
      beforeState: forwardBefore,
      afterState: forwardAfter,
      actionWord,
      changedCids: delta.changedCids,
    });

    setCurrentIndex(toIndex);
    setChangedTiles(delta.changedCids);
    startStepAnimation({
      timeline: reverseOpponentMoveTimeline(forwardTimeline),
      soundEvent: mapStepSound(forwardBefore, forwardAfter),
    });
  };

  const goStart = () => {
    if (loading || activeAnimation) return;
    setCurrentIndex(0);
    setChangedTiles([]);
    setActiveAnimation(null);
  };

  const goEnd = () => {
    if (loading || activeAnimation || states.length === 0) return;
    setCurrentIndex(states.length - 1);
    setChangedTiles([]);
    setActiveAnimation(null);
  };

  const renderVisualUnit = (unit: VisualUnit): JSX.Element | null => {
    if (unit.p <= 0 && unit.s <= 0) return null;
    const mode = unitIconsReady ? "icon" : "number";
    const textColor = unit.tribun
      ? unit.color === 0
        ? "#AE0000"
        : "#00B4FF"
      : unit.color === 0
      ? "#000"
      : "#fff";
    const textColorSecondary = unit.color === 0 ? "#fff" : "#000";
    const strokeColor = unit.tribun
      ? unit.color === 0
        ? "#000"
        : "#fff"
      : unit.color === 0
      ? "#fff"
      : "#000";
    const strokeColorSecondary = unit.color === 0 ? "#000" : "#fff";
    const sizePx = unit.tribun ? 72 : 64;
    const splitOffset = { x: 12, y: 15 };

    if (unit.s > 0) {
      return (
        <SplitUnitGlyph
          mode={mode}
          primary={{ height: unit.s, tribun: false }}
          secondary={{ height: unit.p, tribun: unit.tribun }}
          sizePx={sizePx}
          offsetPx={splitOffset}
          numberColors={{
            primary: { fill: textColorSecondary, stroke: strokeColorSecondary },
            secondary: { fill: textColor, stroke: strokeColor },
          }}
        />
      );
    }

    return (
      <UnitGlyph
        mode={mode}
        unit={{ height: unit.p, tribun: unit.tribun }}
        sizePx={sizePx}
        numberColor={{ fill: textColor, stroke: strokeColor }}
      />
    );
  };

  const renderBoard = () => {
    if (!currentState) return null;

    const innerHexSize = 45;
    const borderWidth = 2;
    const spacingMultiplier = 0.98;
    const outerHexSize = innerHexSize + borderWidth;
    const centerSize = outerHexSize * spacingMultiplier;
    const d = (Math.sqrt(3) / 2) * centerSize;
    const outerHexWidth = 2 * outerHexSize;
    const outerHexHeight = Math.sqrt(3) * outerHexSize;
    const innerHexWidth = 2 * innerHexSize;
    const innerHexHeight = Math.sqrt(3) * innerHexSize;
    const innerOffsetX = (outerHexWidth - innerHexWidth) / 2;
    const innerOffsetY = (outerHexHeight - innerHexHeight) / 2;

    const validTiles: Array<{ cid: number; x: number; y: number; displayX: number; displayY: number }> = [];
    for (let cid = 0; cid < 121; cid += 1) {
      if (engine.isValidTile(cid)) {
        const { x, y } = engine.decodeCoord(cid);
        const displayX = isFlipped ? -x : x;
        const displayY = isFlipped ? -y : y;
        validTiles.push({ cid, x, y, displayX, displayY });
      }
    }

    let minPixelX = Infinity;
    let maxPixelX = -Infinity;
    let minPixelY = Infinity;
    let maxPixelY = -Infinity;

    validTiles.forEach(({ displayX, displayY }) => {
      const z = displayY - displayX;
      const centerX = ((3 * z) / 2) * centerSize;
      const centerY = (displayX + displayY) * d;
      minPixelX = Math.min(minPixelX, centerX - outerHexWidth / 2);
      maxPixelX = Math.max(maxPixelX, centerX + outerHexWidth / 2);
      minPixelY = Math.min(minPixelY, centerY - outerHexHeight / 2);
      maxPixelY = Math.max(maxPixelY, centerY + outerHexHeight / 2);
    });

    const tilePixels: TilePixelData[] = validTiles.map(({ cid, x, y, displayX, displayY }) => {
      const z = displayY - displayX;
      const centerX = ((3 * z) / 2) * centerSize;
      const centerY = (displayX + displayY) * d;
      return {
        cid,
        x,
        y,
        displayX,
        displayY,
        centerX: centerX - minPixelX,
        centerY: centerY - minPixelY,
        hexX: centerX - outerHexWidth / 2 - minPixelX,
        hexY: centerY - outerHexHeight / 2 - minPixelY,
      };
    });

    const tilePixelByCid = new Map<number, TilePixelData>(tilePixels.map((tile) => [tile.cid, tile]));
    const changedSet = new Set(changedTiles);
    const tribunHighlightCid =
      currentState.status === "ended" && tribunCaptureAttackerCid !== null ? tribunCaptureAttackerCid : null;
    const activeTimeline = activeAnimation?.timeline ?? null;
    const activeTimelineElapsedMs = activeAnimation ? Math.max(0, activeAnimation.nowMs - activeAnimation.startedAtMs) : 0;
    const hiddenAnimatedUnitCids = new Set(activeTimeline?.hiddenStaticUnitCids ?? []);

    const resolveAnchorOffset = (anchor: "center" | "primary" | "secondary" | undefined): { x: number; y: number } => {
      if (anchor === "primary") return { x: 12, y: -15 };
      if (anchor === "secondary") return { x: -12, y: 15 };
      return { x: 0, y: 0 };
    };

    const resolvePositionRef = (position: PositionRef): { x: number; y: number } | null => {
      if (position.type === "tile") {
        const tile = tilePixelByCid.get(position.cid);
        if (!tile) return null;
        const offset = resolveAnchorOffset(position.anchor);
        return { x: tile.centerX + offset.x, y: tile.centerY + offset.y };
      }
      if (position.type === "between") {
        const fromTile = tilePixelByCid.get(position.fromCid);
        const toTile = tilePixelByCid.get(position.toCid);
        if (!fromTile || !toTile) return null;
        const ratio = Math.max(0, Math.min(1, position.ratio));
        return {
          x: fromTile.centerX + (toTile.centerX - fromTile.centerX) * ratio,
          y: fromTile.centerY + (toTile.centerY - fromTile.centerY) * ratio,
        };
      }
      const tile = tilePixelByCid.get(position.cid);
      if (!tile) return null;
      return {
        x: tile.centerX + Math.cos(position.angleRad) * position.distancePx,
        y: tile.centerY + Math.sin(position.angleRad) * position.distancePx,
      };
    };

    const tiles = tilePixels.map(({ cid, x, y, hexX, hexY }) => {
      const staticUnit = engine.unitByteToUnit(currentState.board[cid]);
      const shouldHideStaticUnit = hiddenAnimatedUnitCids.has(cid);
      const unit = shouldHideStaticUnit ? null : staticUnit;
      const baseColor = getBaseColor(x, y);
      const tileState = tribunHighlightCid === cid ? "selected" : changedSet.has(cid) ? "lastOpponentMove" : "selectable";
      const tileColor = getHexagonColor(baseColor, tileState);
      const hexClipPath = "polygon(100% 50%, 75% 0%, 25% 0%, 0% 50%, 25% 100%, 75% 100%)";

      return (
        <div
          key={cid}
          style={{
            position: "absolute",
            left: `${hexX}px`,
            top: `${hexY}px`,
            width: `${outerHexWidth}px`,
            height: `${outerHexHeight}px`,
            clipPath: hexClipPath,
            background: "#222",
            transition: `all 0.2s ${OPPONENT_MOVE_EASING}`,
          }}
        >
          <div
            style={{
              position: "absolute",
              left: `${innerOffsetX}px`,
              top: `${innerOffsetY}px`,
              width: `${innerHexWidth}px`,
              height: `${innerHexHeight}px`,
              clipPath: hexClipPath,
              background: tileColor,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "10px",
            }}
          >
            {unit ? renderVisualUnit({ p: unit.p, s: unit.s, color: unit.color, tribun: unit.tribun }) : null}
          </div>
        </div>
      );
    });

    const animatedPrimitives: JSX.Element[] = [];
    if (activeTimeline) {
      for (const primitive of activeTimeline.primitives) {
        const started = activeTimelineElapsedMs >= primitive.startMs;
        const ended = activeTimelineElapsedMs > primitive.startMs + primitive.durationMs;
        if (!started || ended) continue;

        const fromPosition = resolvePositionRef(primitive.from);
        const toPosition = resolvePositionRef(primitive.to);
        if (!fromPosition || !toPosition) continue;

        const rawProgress = primitive.durationMs <= 0 ? 1 : (activeTimelineElapsedMs - primitive.startMs) / primitive.durationMs;
        const eased = cubicEaseInOut(rawProgress);
        const x = fromPosition.x + (toPosition.x - fromPosition.x) * eased;
        const y = fromPosition.y + (toPosition.y - fromPosition.y) * eased;
        const scaleValue = primitive.fromScale + (primitive.toScale - primitive.fromScale) * eased;
        const opacityValue = primitive.fromOpacity + (primitive.toOpacity - primitive.fromOpacity) * eased;

        if (primitive.kind === "numberMove") {
          animatedPrimitives.push(
            <div
              key={primitive.id}
              style={{
                position: "absolute",
                left: `${x}px`,
                top: `${y}px`,
                transform: `translate(-50%, -50%) scale(${scaleValue})`,
                opacity: opacityValue,
                minWidth: "42px",
                height: "42px",
                borderRadius: "999px",
                border: "2px solid #2a2218",
                background: "#ffe2a8",
                color: "#2a2218",
                fontWeight: 800,
                fontSize: "27px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                pointerEvents: "none",
                zIndex: 18,
              }}
            >
              {primitive.value}
            </div>,
          );
          continue;
        }

        animatedPrimitives.push(
          <div
            key={primitive.id}
            style={{
              position: "absolute",
              left: `${x}px`,
              top: `${y}px`,
              transform: `translate(-50%, -50%) scale(${scaleValue})`,
              opacity: opacityValue,
              pointerEvents: "none",
              zIndex: 16,
            }}
          >
            {renderVisualUnit(primitive.unit)}
          </div>,
        );
      }
    }

    const safetyMargin = 2;
    const boardWidth = maxPixelX - minPixelX + safetyMargin;
    const boardHeight = maxPixelY - minPixelY + safetyMargin;
    const availableWidth = boardViewportWidth || boardWidth;
    const availableHeight = boardViewportHeight || boardHeight;
    const scale = Math.min(1, availableWidth / boardWidth, availableHeight / boardHeight);

    return (
      <div
        ref={boardViewportRef}
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: `${boardWidth}px`,
            height: `${boardHeight}px`,
            transform: `translate(-50%, -50%) scale(${scale})`,
            transformOrigin: "center",
          }}
        >
          {tiles}
          {animatedPrimitives}
        </div>
      </div>
    );
  };

  const stepLabel = `${currentIndex} / ${actions.length}`;
  const activeState = states[currentIndex] ?? null;
  const continueTargets = useMemo(
    () => (activeState ? buildContinueTargetsFromEngineState(activeState) : null),
    [activeState],
  );
  const continueBlocked = loading || !!error || !!activeAnimation || !continueTargets || creatingFriendLobby;

  const openBoardCanvasFromReview = () => {
    if (!continueTargets) return;
    navigate("/board-canvas", { state: { boardCanvasImport: continueTargets.boardCanvasImport } });
  };

  const openLocalFromReview = () => {
    if (!continueTargets) return;
    saveLocalLobbyPrefill(continueTargets.localPrefill);
    navigate("/local", { state: { playLobbyPrefill: continueTargets.localPrefill } });
  };

  const openFriendFromReview = async () => {
    if (!continueTargets?.friendPrefill) return;
    setCreatingFriendLobby(true);
    setError(null);
    try {
      await openFriendLobbyFromPrefill(navigate, continueTargets.friendPrefill);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create friend lobby.");
    } finally {
      setCreatingFriendLobby(false);
    }
  };

  const continueMenuItems = [
    {
      label: "Open in Board Canvas",
      onSelect: openBoardCanvasFromReview,
      disabled: continueBlocked,
      disabledReason: continueBlocked ? "Wait for replay to finish loading." : undefined,
    },
    {
      label: "Start Local Game",
      onSelect: openLocalFromReview,
      disabled: continueBlocked,
      disabledReason: continueBlocked ? "Wait for replay to finish loading." : undefined,
    },
    {
      label: creatingFriendLobby ? "Creating lobby..." : "Open Friend Lobby",
      onSelect: () => void openFriendFromReview(),
      disabled: continueBlocked || !continueTargets?.friendPrefill,
      disabledReason: creatingFriendLobby
        ? "Creating lobby..."
        : continueBlocked
          ? "Wait for replay to finish loading."
          : undefined,
    },
  ];

  const resultLabel = useMemo(() => {
    if (!game) return "-";
    if (game.winnerColor === null) return "Draw";
    const seatColor = game.seat === "black" ? 0 : 1;
    return game.winnerColor === seatColor ? "Win" : "Loss";
  }, [game]);

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
          padding: "12px 20px",
          gap: "12px",
          background: "rgba(26, 21, 15, 0.92)",
          color: "#f8f1e7",
          borderBottom: "2px solid #3a2f22",
          flexWrap: "wrap",
        }}
      >
        <PageHeaderBrand title="Review Mode" />
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <ContinueMenu items={continueMenuItems} />
          <Link to="/history" style={navPillLinkStyle}>
            History
          </Link>
          <button type="button" onClick={() => navigate("/hub")} style={navPillButtonStyle}>
            Hub
          </button>
        </div>
      </header>

      <main style={{ width: "100%", maxWidth: "1200px", margin: "0 auto", padding: "18px 14px 24px", display: "grid", gap: "12px" }}>
        {loading && (
          <div style={{ borderRadius: "14px", border: "1px solid #d8cbb8", background: "#fffaf0", padding: "14px" }}>
            Loading replay...
          </div>
        )}

        {error && (
          <div style={{ borderRadius: "14px", border: "2px solid #8b3b3b", background: "#f7d7d5", color: "#5c1c16", padding: "14px", fontWeight: 600 }}>
            {error}
          </div>
        )}

        {!loading && !error && game && activeState && (
          <>
            <div
              style={{
                borderRadius: "18px",
                border: "2px solid #3c3226",
                background: "rgba(255, 250, 242, 0.84)",
                boxShadow: "0 18px 30px rgba(39, 30, 20, 0.15)",
                padding: "16px",
                display: "grid",
                gap: "10px",
              }}
            >
              <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "1.3px", textTransform: "uppercase", color: "#7a6543" }}>
                Replay
              </div>
              <div style={{ fontSize: "28px", fontWeight: 700, color: "#2c2318" }}>
                Against {game.opponent.name ?? "Unknown"}
              </div>
              <div style={{ color: "#5a4630", fontSize: "13px", display: "grid", gap: "2px" }}>
                <div>Result: {resultLabel}</div>
                <div>Started: {formatDateTime(game.startedAt)}</div>
                <div>Ended: {formatDateTime(game.endedAt)}</div>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                <button
                  type="button"
                  onClick={goStart}
                  disabled={loading || !!activeAnimation || currentIndex === 0}
                  style={{
                    padding: "9px 12px",
                    borderRadius: "999px",
                    border: "2px solid #6f5a38",
                    background: loading || !!activeAnimation || currentIndex === 0 ? "#e6dccf" : "#f2d9b2",
                    color: "#2a2218",
                    fontWeight: 700,
                    cursor: loading || !!activeAnimation || currentIndex === 0 ? "not-allowed" : "pointer",
                  }}
                >
                  Start
                </button>
                <button
                  type="button"
                  onClick={goPrev}
                  disabled={!canStepBack}
                  style={{
                    padding: "9px 12px",
                    borderRadius: "999px",
                    border: "2px solid #6f5a38",
                    background: canStepBack ? "#f2d9b2" : "#e6dccf",
                    color: "#2a2218",
                    fontWeight: 700,
                    cursor: canStepBack ? "pointer" : "not-allowed",
                  }}
                >
                  Prev
                </button>
                <button
                  type="button"
                  onClick={goNext}
                  disabled={!canStepForward}
                  style={{
                    padding: "9px 12px",
                    borderRadius: "999px",
                    border: "2px solid #6f5a38",
                    background: canStepForward ? "#f2d9b2" : "#e6dccf",
                    color: "#2a2218",
                    fontWeight: 700,
                    cursor: canStepForward ? "pointer" : "not-allowed",
                  }}
                >
                  Next
                </button>
                <button
                  type="button"
                  onClick={goEnd}
                  disabled={loading || !!activeAnimation || currentIndex === actions.length}
                  style={{
                    padding: "9px 12px",
                    borderRadius: "999px",
                    border: "2px solid #6f5a38",
                    background: loading || !!activeAnimation || currentIndex === actions.length ? "#e6dccf" : "#f2d9b2",
                    color: "#2a2218",
                    fontWeight: 700,
                    cursor: loading || !!activeAnimation || currentIndex === actions.length ? "not-allowed" : "pointer",
                  }}
                >
                  End
                </button>
                <div
                  style={{
                    padding: "9px 12px",
                    borderRadius: "999px",
                    border: "1px solid #d8cbb8",
                    background: "#fffaf0",
                    color: "#5a4630",
                    fontWeight: 700,
                  }}
                >
                  Move: {stepLabel}
                </div>
              </div>
            </div>

            <div
              style={{
                borderRadius: "18px",
                border: "2px solid #3c3226",
                background: "rgba(255, 250, 242, 0.7)",
                boxShadow: "0 18px 30px rgba(39, 30, 20, 0.15)",
                padding: "12px",
                height: "min(72vh, 720px)",
                minHeight: "420px",
                position: "relative",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <button
                type="button"
                onClick={() => setIsFlipped((prev) => !prev)}
                title="Flip board"
                aria-label="Flip board"
                style={{
                  position: "absolute",
                  top: "8px",
                  right: "8px",
                  width: "24px",
                  height: "24px",
                  borderRadius: "6px",
                  border: `2px solid ${isFlipped ? "#111" : "#1c1a16"}`,
                  background: isFlipped ? "#111" : "#f6f0e6",
                  color: isFlipped ? "#f6f0e6" : "#1c1a16",
                  fontSize: "10px",
                  fontWeight: 700,
                  letterSpacing: "0.5px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 6px 12px rgba(20, 15, 10, 0.18)",
                  zIndex: 2,
                }}
              />
              {renderBoard()}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
