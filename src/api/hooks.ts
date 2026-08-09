/**
 * Query bindings. Every hook is a read.
 *
 * The demo issues exactly four writes in total — opening a session, closing it,
 * play and pause — and none of them writes a fact. They drive a video source.
 * There is no hook here that could change what Vision OS has recorded, because
 * the Observation API exposes no such call.
 */

import { useQuery } from '@tanstack/react-query';
import { usePlatform } from './provider';

/** Vision State's clock starts at zero; a wall-clock window would never match. */
export function replayWindow(frameCount: number, fps: number) {
  const span = (frameCount / Math.max(fps, 0.1)) * 1_000_000_000;
  return { start_ns: 0, end_ns: Math.ceil(span * 2) + 1_000_000_000 };
}

export function useHealth() {
  const { client } = usePlatform();
  return useQuery({ queryKey: ['health'], queryFn: () => client.health(), refetchInterval: 5000, retry: false });
}

export function useVisionState() {
  const { client, sessionId } = usePlatform();
  return useQuery({
    // The key is the session and nothing else, deliberately.
    //
    // It used to carry `Math.floor(revision / 6)` so the projection re-read as
    // taps arrived. That made every sixth tap message a *different query*, and
    // a different query has no cached data: `data` went undefined on each
    // rotation and five pages — Dashboard, Objects, Vision State, Live Cameras,
    // Evidence — fell back to `?? []` mid-flight. The dashboard read 0 objects
    // while the platform was reporting one, and the overlay boxes blinked out
    // between frames.
    //
    // Polling on a stable key gets the same freshness with none of that, and it
    // no longer depends on the socket: with the tap stream down the projection
    // used to freeze at whatever it held when the last message arrived, which
    // for a session read at creation time is empty.
    queryKey: ['state', sessionId],
    queryFn: () => client.queryState(sessionId),
    enabled: Boolean(sessionId),
    // Paced to how fast the projection can actually change. Understanding is
    // the slow stage — seconds per call on CPU — so polling faster than this
    // buys nothing but requests, and every extra request is another chance to
    // catch the platform mid-hiccup.
    refetchInterval: 2500,
    retry: false,
  });
}

export function useObservations() {
  const { client, sessionId, session } = usePlatform();
  return useQuery({
    queryKey: ['observations', sessionId, session?.frame_index],
    queryFn: () =>
      client.queryObservations(
        sessionId,
        replayWindow(session?.frame_count ?? 0, session?.target_fps ?? 6),
      ),
    enabled: Boolean(sessionId),
    retry: false,
  });
}

/**
 * The bound adapter and its counters.
 *
 * Five seconds, not three: which adapter is bound cannot change while a session
 * runs, and the latency percentiles move only when a model call completes —
 * roughly once every several seconds on CPU. This is also the most-observed
 * query in the app (the shell, three pages and the pipeline strip all read it),
 * so its interval costs more than any other.
 */
export function useModel() {
  const { client, sessionId } = usePlatform();
  return useQuery({
    queryKey: ['model', sessionId],
    queryFn: () => client.model(sessionId ?? undefined),
    enabled: Boolean(sessionId),
    refetchInterval: 5000,
    retry: false,
  });
}

export function useEconomy() {
  const { client, sessionId } = usePlatform();
  return useQuery({
    queryKey: ['economy', sessionId],
    queryFn: () => client.economy(sessionId ?? undefined),
    enabled: Boolean(sessionId),
    // Counted per model call and per frame, both of which are seconds apart.
    refetchInterval: 5000,
    retry: false,
  });
}

export function useMetrics() {
  const { client, sessionId } = usePlatform();
  return useQuery({
    queryKey: ['metrics', sessionId],
    queryFn: () => client.metrics(sessionId ?? undefined),
    enabled: Boolean(sessionId),
    refetchInterval: 2500,
    retry: false,
  });
}

export function useArchitecture() {
  const { client, sessionId } = usePlatform();
  return useQuery({
    queryKey: ['architecture', sessionId],
    queryFn: () => client.architecture(sessionId ?? undefined),
    enabled: Boolean(sessionId),
    refetchInterval: 6000,
    retry: false,
  });
}
