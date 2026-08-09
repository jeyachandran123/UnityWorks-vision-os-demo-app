/**
 * What the Live Summary shows when the platform is *not* answering with data.
 *
 * The page has three failure-shaped states and they are easy to confuse in
 * code: still asking, asked and refused, and asked and answered with nothing.
 * A viewer must be able to tell them apart, and this is the file that proves
 * they render differently.
 *
 * The refusal case is real, not invented: a session whose Vision OS has not
 * booted answers `/state/query` with HTTP 200 carrying
 * `{"code":"NOT_FOUND","message":"no booted session to query state from"}`,
 * which the client turns into a thrown `ApiError`.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { VisionOsClient } from '../src/api/client';
import { PlatformProvider, usePlatform } from '../src/api/provider';
import { LiveSummary } from '../src/pages/LiveSummary';

const NOT_BOOTED = {
  code: 'NOT_FOUND',
  message: 'no booted session to query state from',
  retryable: false,
};

const SESSION = {
  session_id: 's-test',
  state: 'playing',
  media_id: 'm-1',
  media_name: 'clip.mp4',
  camera_id: 'cam-1',
  tenant_id: 't-1',
  semantics: 'archival',
  target_fps: 6,
  frame_count: 120,
  frame_index: 0,
  playing: true,
  speed: 1,
  exhausted: false,
  events_attached: false,
  taps: { sequence: 0, dropped: 0, by_channel: {} },
};

/** A fetch that answers each path from a table, so no network is involved. */
function fakeFetch(routes: Record<string, unknown>) {
  return vi.fn(async (url: string) => {
    const path = String(url).replace(/^.*\/api\/v1/, '').split('?')[0]!;
    const body = routes[path] ?? {};
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

function Harness({ client, children }: { client: VisionOsClient; children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 0 } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <PlatformProvider client={client}>
        <SelectSession />
        {children}
      </PlatformProvider>
    </QueryClientProvider>
  );
}

/** The provider only queries once a session is chosen, as the Shell does. */
function SelectSession() {
  const { sessionId, setSessionId } = usePlatform();
  if (!sessionId) setTimeout(() => setSessionId('s-test'), 0);
  return null;
}

describe('the summary distinguishes its three empty-looking states', () => {
  it('says the platform refused rather than spinning forever', async () => {
    const client = new VisionOsClient(
      '',
      fakeFetch({
        '/sessions/s-test': SESSION,
        '/state/query': NOT_BOOTED,
        '/model': { available: false, reason: 'no booted session' },
      }),
    );

    render(
      <Harness client={client}>
        <LiveSummary />
      </Harness>,
    );

    // The state the screenshot showed: a session that is "playing" while its
    // platform has not booted. This must read as a refusal, not as progress.
    await waitFor(() => {
      expect(screen.getByText(/unavailable/i)).toBeTruthy();
    });
    // Said in words, not in the platform's error code. This page is read by
    // people who will never know what a booted session is.
    expect(screen.getByText(/still starting up/i)).toBeTruthy();
    expect(screen.queryByText(/no booted session/i)).toBeNull();
    expect(screen.queryByText(/ApiError|NOT_FOUND/)).toBeNull();
    expect(screen.queryByText(/Asking the camera what it can see/)).toBeNull();
    expect(screen.queryByText(/Looking/)).toBeNull();
  });

  it('never shows COVERAGE MISSING merely because the answer has not arrived', async () => {
    // COVERAGE MISSING means the platform broke its contract. Showing it while a
    // request is still in flight cries wolf on the one badge that must be
    // believed.
    const client = new VisionOsClient(
      '',
      fakeFetch({
        '/sessions/s-test': SESSION,
        '/state/query': NOT_BOOTED,
        '/model': { available: false },
      }),
    );

    render(
      <Harness client={client}>
        <LiveSummary />
      </Harness>,
    );

    await waitFor(() => expect(screen.getByText(/unavailable/i)).toBeTruthy());
    expect(screen.queryByText(/COVERAGE MISSING/)).toBeNull();
  });

  it('reports an empty scene as an answer once the platform has answered', async () => {
    const client = new VisionOsClient(
      '',
      fakeFetch({
        '/sessions/s-test': SESSION,
        '/state/query': {
          objects: [],
          snapshot: { partitions: [], consistency: 'strong', max_lag_ms: 0, incomplete: [] },
          coverage: {
            observable_fraction: 1,
            cameras_observing: 1,
            cameras_blind: 0,
            cameras_degraded: 0,
            unavailable: [],
          },
          capabilities: { producible_classes: ['person'], producible_attributes: [] },
        },
        '/model': { available: true, adapter_id: 'understander.qwen_vl' },
      }),
    );

    render(
      <Harness client={client}>
        <LiveSummary />
      </Harness>,
    );

    await waitFor(() =>
      expect(screen.getByText(/Nothing the camera recognises is in view right now/)).toBeTruthy(),
    );
    expect(screen.queryByText(/unavailable/i)).toBeNull();
  });
});
