import { useCallback, useEffect, useRef, useState } from "react";

import {
  PetalField,
  type ScoreEvent,
} from "@/game/PetalField";
import {
  GOLDEN_CHAIN_WINDOW_MS,
  createPetalGameSnapshot,
  getEffectiveGoldenChain,
  type PetalGameSnapshot,
} from "@/game/engine";
import { useDeviceMode } from "@/game/useDeviceMode";

const BEST_KEY = "petal-chase-best";

function readBest(): number {
  try {
    const value = Number(localStorage.getItem(BEST_KEY));
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  } catch {
    return 0;
  }
}

function saveBest(value: number) {
  try { localStorage.setItem(BEST_KEY, String(value)); } catch { /* Best scores are optional. */ }
}

type Toast = { id: number; text: string; record: boolean };

/**
 * The game screen. The middle of the screen belongs to the petals: the name and
 * controls sit in the top-left corner, the score in the top-right, and the
 * instructions in a small card at the bottom-left that steps aside as soon as
 * the player catches a golden petal. H hides everything but the petals.
 *
 * Where the game can't run (touch, narrow windows, no hover) the petals fall
 * as decoration and the card says why. Reduced motion shows no petals at all.
 */
export function Game() {
  const device = useDeviceMode();
  const playable = device?.mode === "game";
  const [session, setSession] = useState<PetalGameSnapshot | null>(null);
  const [savedBest, setSavedBest] = useState(0);
  const [intro, setIntro] = useState(true);
  const [minimal, setMinimal] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [, setChainTick] = useState(0);
  const sessionRef = useRef<PetalGameSnapshot | null>(null);
  const runStartBestRef = useRef(0);
  const savedBestRef = useRef(0);

  useEffect(() => {
    const best = readBest();
    savedBestRef.current = best;
    setSavedBest(best);
  }, []);

  const handleScore = useCallback((event: ScoreEvent) => {
    // The game loop owns scoring; this only mirrors its snapshot for display.
    const previous = sessionRef.current;
    const next = event.snapshot;
    sessionRef.current = next;
    setSession(next);
    if (event.kind === "golden") {
      setIntro(false);
      if (!previous || previous.score === 0) runStartBestRef.current = savedBestRef.current;
      if (next.score > savedBestRef.current) {
        savedBestRef.current = next.score;
        setSavedBest(next.score);
        saveBest(next.score);
      }
    } else if (previous && previous.score > 0) {
      const record = previous.score > runStartBestRef.current;
      setToast({ id: Date.now(), text: record ? `New best · ${previous.score}` : `Run over · ${previous.score}`, record });
    }
  }, []);

  const handlePlayableChange = useCallback((enabled: boolean) => {
    // Show the HUD at zero as soon as the game is live; drop it otherwise.
    const next = enabled ? createPetalGameSnapshot() : null;
    sessionRef.current = next;
    setSession(next);
  }, []);

  // A chain lapses after its window with no new event, so redraw when it does.
  useEffect(() => {
    if (!session?.lastCatchAt) return;
    const left = GOLDEN_CHAIN_WINDOW_MS - (Date.now() - session.lastCatchAt);
    if (left <= 0) return;
    const timer = setTimeout(() => setChainTick(tick => tick + 1), left + 30);
    return () => clearTimeout(timer);
  }, [session?.lastCatchAt]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      const key = event.key.toLowerCase();
      if (key === "h") setMinimal(value => !value);
      else if (key === "escape") setMinimal(false);
      else if (key === "?" || key === "i") { setMinimal(false); setIntro(value => !value); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const score = session?.score ?? 0;
  const best = Math.max(savedBest, session?.best ?? 0);
  const chain = session ? getEffectiveGoldenChain(session, Date.now()) : 0;
  const message = device?.mode === "none"
    ? "The petals are hidden because your device asks for reduced motion."
    : device?.mode === "decorative"
      ? "Petal Chase is played with a mouse or trackpad on a wider screen. Here, the petals just fall."
      : null;

  return (
    <div className={["game", minimal ? "is-minimal" : ""].filter(Boolean).join(" ")}>
      {device && device.mode !== "none" && (
        playable
          ? <PetalField count={8} className="petal" interactive="play" onScore={handleScore} onPlayableChange={handlePlayableChange} />
          : <PetalField count={device.narrow ? 5 : 8} className="petal" />
      )}

      <header className="corner corner-start">
        <h1 className="wordmark">Petal Chase</h1>
        {playable && (
          <div className="controls">
            <button type="button" className="control" onClick={() => setIntro(value => !value)} aria-pressed={intro} aria-label="How to play" title="How to play (?)">?</button>
            <button type="button" className="control" onClick={() => setMinimal(true)} aria-label="Hide everything but the petals" title="Hide everything but the petals (H)">
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8Z" fill="none" stroke="currentColor" strokeWidth="1.2" /><circle cx="8" cy="8" r="1.9" fill="currentColor" /></svg>
            </button>
          </div>
        )}
      </header>

      {playable && session && (
        <section className="corner corner-end hud" aria-label="Score">
          <div className="hud-stat">
            <span className="hud-label">Best</span>
            <span className="hud-value hud-best">{best}</span>
          </div>
          <div className="hud-stat">
            <span className="hud-label">Score</span>
            <span key={`${score}:${session.touchedAt}`} className={["hud-value", "hud-score", session.lastKind === "golden" && score > 0 ? "is-gold" : ""].filter(Boolean).join(" ")}>{score}</span>
          </div>
          <span className={["hud-chain", chain > 1 ? "is-on" : ""].filter(Boolean).join(" ")} aria-hidden={chain <= 1}>×{Math.max(chain, 2)} chain</span>
          {toast && <p key={toast.id} className={["toast", toast.record ? "is-record" : ""].filter(Boolean).join(" ")} role="status">{toast.text}</p>}
        </section>
      )}

      {(message || (playable && intro)) && (
        <aside className="card" aria-live="polite">
          {message ? <p>{message}</p> : (
            <>
              <p>Chase the <span className="gold">golden petals</span> with your cursor and dodge everything else. Chain them back to back for bigger points.</p>
              <p className="card-sign">Happy hunting.</p>
              <p className="card-keys"><kbd>H</kbd> petals only <span aria-hidden="true">·</span> <kbd>?</kbd> help</p>
            </>
          )}
        </aside>
      )}

      {minimal && (
        <button type="button" className="restore" onClick={() => setMinimal(false)} aria-label="Show the score and controls" title="Show the score and controls (H)">
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8Z" fill="none" stroke="currentColor" strokeWidth="1.2" /><circle cx="8" cy="8" r="1.9" fill="currentColor" /><path d="M2.5 13.5 13.5 2.5" stroke="currentColor" strokeWidth="1.2" /></svg>
        </button>
      )}
    </div>
  );
}
