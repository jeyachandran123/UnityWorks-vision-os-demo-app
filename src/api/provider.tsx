/**
 * Application state: the client, the active session, and the live tap stream.
 *
 * Holds a connection and a bounded ring of messages the platform sent. It holds
 * **no facts of its own** — every value the UI renders traces back to one of
 * these, which is what keeps "the frontend never infers anything" checkable
 * rather than merely promised.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Channel, SessionDescription, TapMessage } from './types';
import { VisionOsClient } from './client';

/** Bounded per channel: a long demo must not become a memory leak on stage. */
class TapBuffer {
  private readonly byChannel = new Map<Channel, TapMessage[]>();
  private total = 0;

  constructor(readonly capacity = 4000) {}

  push(message: TapMessage): void {
    const held = this.byChannel.get(message.channel) ?? [];
    held.push(message);
    if (held.length > this.capacity) held.splice(0, held.length - this.capacity);
    this.byChannel.set(message.channel, held);
    this.total += 1;
  }

  get(channel: Channel): TapMessage[] {
    return this.byChannel.get(channel) ?? [];
  }

  counts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [channel, held] of this.byChannel) out[channel] = held.length;
    return out;
  }

  get received(): number {
    return this.total;
  }

  clear(): void {
    this.byChannel.clear();
    this.total = 0;
  }
}

export type StreamStatus = 'idle' | 'connecting' | 'open' | 'closed';

interface PlatformContextValue {
  client: VisionOsClient;
  sessionId: string | null;
  setSessionId: (id: string | null) => void;
  session: SessionDescription | null;
  setSession: (session: SessionDescription | null) => void;
  buffer: TapBuffer;
  revision: number;
  streamStatus: StreamStatus;
  /** Sequence holes detected locally — loss is announced, never smoothed. */
  gaps: number;
}

const PlatformContext = createContext<PlatformContextValue | null>(null);

export function PlatformProvider({
  children,
  client: injected,
}: {
  children: ReactNode;
  client?: VisionOsClient;
}) {
  const client = useMemo(() => injected ?? new VisionOsClient(), [injected]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<SessionDescription | null>(null);
  const [revision, setRevision] = useState(0);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>('idle');
  const [gaps, setGaps] = useState(0);

  const buffer = useMemo(() => new TapBuffer(4000), []);
  const pending = useRef(0);
  const lastSeq = useRef(0);

  useEffect(() => {
    if (!sessionId) {
      setStreamStatus('idle');
      return;
    }

    buffer.clear();
    lastSeq.current = 0;
    setGaps(0);
    setStreamStatus('connecting');

    const origin =
      location.protocol === 'https:' ? `wss://${location.host}` : `ws://${location.host}`;
    const socket = new WebSocket(`${origin}/ws/v1/session/${encodeURIComponent(sessionId)}`);

    let frame = 0;
    const flush = () => {
      frame = 0;
      if (pending.current === 0) return;
      pending.current = 0;
      setRevision((r) => r + 1);
    };

    socket.onopen = () => setStreamStatus('open');
    socket.onclose = () => setStreamStatus('closed');
    socket.onmessage = (event) => {
      let message: TapMessage;
      try {
        message = JSON.parse(String(event.data)) as TapMessage;
      } catch {
        setGaps((g) => g + 1);
        return;
      }

      // A jump in `seq` is loss, and loss is counted rather than absorbed.
      if (message.type !== 'heartbeat' && message.seq > 0) {
        if (lastSeq.current > 0 && message.seq > lastSeq.current + 1) {
          setGaps((g) => g + 1);
        }
        lastSeq.current = Math.max(lastSeq.current, message.seq);
      }

      buffer.push(message);
      pending.current += 1;
      if (!frame) frame = requestAnimationFrame(flush);
    };

    return () => {
      if (frame) cancelAnimationFrame(frame);
      socket.close();
    };
  }, [sessionId, buffer]);

  // Adopt a session that is already running, once, on load.
  //
  // Sessions live on the harness, not in this page, so a refresh used to leave
  // a perfectly good session running with nothing pointed at it — the operator
  // saw an empty app, pressed Start, and paid the several-minute boot again
  // while the orphan carried on consuming the model. Reconnecting is what a
  // viewer of a running system should do, and it is what makes an accidental
  // refresh mid-demo a non-event.
  //
  // The newest session wins: if several are somehow open, the one most recently
  // asked for is the one whoever is watching meant to see.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { sessions } = await client.listSessions();
        const live = [...sessions]
          .filter((held) => held.state !== 'ended' && held.state !== 'failed')
          .sort((a, b) => (a.created_at_ns ?? 0) - (b.created_at_ns ?? 0))
          .pop();
        if (!cancelled && live) {
          setSessionId((current) => current ?? live.session_id);
        }
      } catch {
        /* nothing running, or no platform — both are states the UI renders */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  // Keep the session description fresh: the transport state, frame index and
  // channel counts drive most of the chrome.
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const described = await client.getSession(sessionId);
        if (!cancelled) setSession(described);
      } catch {
        /* a session that has gone away is a state the UI renders */
      }
    };
    void tick();
    const timer = setInterval(tick, 1500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [client, sessionId]);

  const value = useMemo<PlatformContextValue>(
    () => ({
      client,
      sessionId,
      setSessionId,
      session,
      setSession,
      buffer,
      revision,
      streamStatus,
      gaps,
    }),
    [client, sessionId, session, buffer, revision, streamStatus, gaps],
  );

  return <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>;
}

export function usePlatform(): PlatformContextValue {
  const value = useContext(PlatformContext);
  if (!value) throw new Error('usePlatform must be used inside <PlatformProvider>');
  return value;
}

export function useChannel(channel: Channel): TapMessage[] {
  const { buffer, revision } = usePlatform();
  return useMemo(
    () => buffer.get(channel),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [buffer, channel, revision],
  );
}

export const useCallbackStable = useCallback;
