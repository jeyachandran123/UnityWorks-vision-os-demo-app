/**
 * Frame serving and crop serving are **two permissions**, and the page must not
 * treat one as the gate for the other.
 *
 * 12_SECURITY §5.3 separates reading what the camera reported from looking at
 * the picture, and the harness separates the pictures again: `VOSVC_SERVE_FRAMES`
 * governs whole frames, `VOSVC_ALLOW_EVIDENCE` governs the retained crops a model
 * was actually shown. Granting the second while withholding the first is the
 * recommended posture — a reviewer checking a compliance finding needs the
 * 224×224 crop behind the claim, not the whole room.
 *
 * The regression this file locks: the purpose prompt was rendered only when
 * *frames* were served. With frames off and evidence on, no purpose could be
 * declared, so every crop URL stayed null and the evidence tiles reported
 * "purpose needed" forever with no way to supply one. Crops were being served
 * correctly by the harness the entire time; the page just never asked for them.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { VisionOsClient } from '../src/api/client';
import { PlatformProvider, usePlatform } from '../src/api/provider';
import { FrameByFrame } from '../src/pages/FrameByFrame';

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

/** `/health`, with the two imagery permissions set independently. */
function health(serveFrames: boolean, allowEvidence: boolean) {
  return {
    status: 'ok',
    harness: {
      version: '1.0.0',
      serve_frames: serveFrames,
      allow_evidence: allowEvidence,
    },
    vision_os: { available: true },
  };
}

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

function routesFor(serveFrames: boolean, allowEvidence: boolean) {
  return {
    '/sessions/s-test': SESSION,
    '/health': health(serveFrames, allowEvidence),
    '/observations/query': { observations: [], cursor: null },
    '/state/query': { objects: [], coverage: {}, capabilities: {} },
    '/crops': { available: true, by_object: {}, skips_by_object: {} },
    '/frames': { entries: [] },
    '/compliance/status': { enabled: false, rule_count: 0, rules: [], required_attributes: [], capability_gaps: [] },
    '/compliance/evaluate': { available: false, findings: [], summary: {} },
  };
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

function SelectSession() {
  const { sessionId, setSessionId } = usePlatform();
  if (!sessionId) setTimeout(() => setSessionId('s-test'), 0);
  return null;
}

const PURPOSE_PROMPT = /why are you viewing this footage/i;
const WITHHELD = /images are not being served/i;

describe('imagery permissions are independent', () => {
  it('asks for a purpose when only crops are served', async () => {
    // The regression. Frames off, evidence on — the recommended posture, and
    // the one that used to make crops unreachable.
    const client = new VisionOsClient('', fakeFetch(routesFor(false, true)));
    render(
      <Harness client={client}>
        <FrameByFrame />
      </Harness>,
    );

    await waitFor(() => expect(screen.getAllByText(PURPOSE_PROMPT).length).toBeGreaterThan(0));
    expect(screen.queryAllByText(WITHHELD)).toHaveLength(0);
  });

  it('says so when crops are served but whole frames are not', async () => {
    const client = new VisionOsClient('', fakeFetch(routesFor(false, true)));
    render(
      <Harness client={client}>
        <FrameByFrame />
      </Harness>,
    );

    // A reviewer should learn what they are about to get *before* declaring a
    // purpose, not after.
    await waitFor(() =>
      expect(screen.getAllByText(/not whole frames/i).length).toBeGreaterThan(0),
    );
  });

  it('asks for a purpose when only whole frames are served', async () => {
    const client = new VisionOsClient('', fakeFetch(routesFor(true, false)));
    render(
      <Harness client={client}>
        <FrameByFrame />
      </Harness>,
    );

    await waitFor(() => expect(screen.getAllByText(PURPOSE_PROMPT).length).toBeGreaterThan(0));
    expect(screen.queryAllByText(/not whole frames/i)).toHaveLength(0);
  });

  it('withholds only when neither permission is granted', async () => {
    const client = new VisionOsClient('', fakeFetch(routesFor(false, false)));
    render(
      <Harness client={client}>
        <FrameByFrame />
      </Harness>,
    );

    await waitFor(() => expect(screen.getAllByText(WITHHELD).length).toBeGreaterThan(0));
    expect(screen.queryAllByText(PURPOSE_PROMPT)).toHaveLength(0);
  });
});
