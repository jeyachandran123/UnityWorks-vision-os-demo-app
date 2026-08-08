/**
 * Query bindings. Every hook is a read.
 *
 * The demo issues exactly three writes in total — play, pause, and opening a
 * session — and none of them writes a fact. They drive a video source. There is
 * no hook here that could change what Vision OS has recorded, because the
 * Observation API exposes no such call.
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
  const { client, sessionId, revision } = usePlatform();
  return useQuery({
    // `revision` divides so the projection re-reads as the replay advances
    // without a request per message.
    queryKey: ['state', sessionId, Math.floor(revision / 6)],
    queryFn: () => client.queryState(sessionId),
    enabled: Boolean(sessionId),
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

export function useModel() {
  const { client, sessionId } = usePlatform();
  return useQuery({
    queryKey: ['model', sessionId],
    queryFn: () => client.model(sessionId ?? undefined),
    enabled: Boolean(sessionId),
    refetchInterval: 3000,
    retry: false,
  });
}

export function useEconomy() {
  const { client, sessionId } = usePlatform();
  return useQuery({
    queryKey: ['economy', sessionId],
    queryFn: () => client.economy(sessionId ?? undefined),
    enabled: Boolean(sessionId),
    refetchInterval: 3000,
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
