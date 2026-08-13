/**
 * The timeline covers the whole video, and says when it does not.
 *
 * ### The failure being pinned
 *
 * A 13.8-second clip rendered as twenty analysis frames ending at 00:03. Nothing
 * was broken in the decoder. The page never saw the rest, because
 * `queryObservations` asked for one page of 500 records and dropped the cursor.
 * Observations are ordered by capture time, so a truncated page is always the
 * **beginning** of the video, and the timeline ended wherever the first 500
 * records happened to run out.
 *
 * That is the worst shape a bug can take: a plausible-looking answer. Twenty
 * frames of a video is exactly what a short video looks like.
 *
 * Two properties are asserted here, one per cause: every page is drained, and
 * every frame is placed on the video's own clock rather than the replay's.
 */

import { describe, expect, it } from 'vitest';
import { MAX_OBSERVATION_PAGES, OBSERVATION_PAGE_SIZE, VisionOsClient } from '../src/api/client';
import { formatPreciseClock, frameClock, groupObservationsByFrame } from '../src/insights/frames';
import type { Observation } from '../src/api/types';

// Measured from the real file, not assumed: 30.0 fps, 415 source frames,
// 13.83 s, which at two frames per second is 28 analysis frames.
const SOURCE_FPS = 30.0044;
const SOURCE_FRAMES = 415;
const SAMPLES = 28;
const STRIDE = 15;

function sampleObservations(count: number, perFrame = 20): Observation[] {
  const records: Observation[] = [];
  for (let frame = 0; frame < count; frame += 1) {
    for (let n = 0; n < perFrame; n += 1) {
      records.push({
        observation_id: `obs-${frame}-${n}`,
        observation_type: 'presence',
        camera_id: 'cam-validation',
        frame_ref: { camera_id: 'cam-validation', stream_epoch: 0, frame_seq: frame },
        // The replay clock: the harness pump at 6 fps, which is what these
        // records really carry and why it must not drive the timeline.
        t_capture_ns: Math.round((frame / 6) * 1e9),
        class_id: 'person',
        object_id: `obj-${frame}-${n}`,
      } as Observation);
    }
  }
  return records;
}

/** `frame_index` → `pts_ms`, exactly as the session's frame ledger reports it. */
function ledgerFor(count: number): Map<number, number> {
  const map = new Map<number, number>();
  for (let frame = 0; frame < count; frame += 1) {
    map.set(frame, Math.round((frame * STRIDE * 1000) / SOURCE_FPS));
  }
  return map;
}

/** A client wired to a fake transport that pages exactly as the platform does. */
function pagingClient(totalRecords: number) {
  const all = Array.from({ length: totalRecords }, (_, index) => ({
    observation_id: `obs-${String(index).padStart(6, '0')}`,
    observation_type: 'presence',
    t_capture_ns: index,
  }));
  const requests: Array<Record<string, unknown>> = [];

  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
    requests.push(payload);
    const limit = Number(payload.limit ?? 100);
    const cursor = payload.cursor as string | undefined;
    const start = cursor ? all.findIndex((o) => o.observation_id === cursor) + 1 : 0;
    const page = all.slice(start, start + limit);
    const next = start + limit < all.length ? page[page.length - 1]?.observation_id : null;
    return new Response(
      JSON.stringify({ observations: page, cursor: next, window_fully_observable: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as unknown as typeof fetch;

  return { client: new VisionOsClient('', fetchImpl), requests };
}

// --- cause one: the dropped cursor ----------------------------------------------- //

describe('the observation feed is read to the end', () => {
  it('returns every record when the session exceeds one page', async () => {
    const { client } = pagingClient(4321);
    const result = await client.queryObservations('s1', { start_ns: 0, end_ns: 10 ** 12 });
    expect(result.observations).toHaveLength(4321);
    expect(result.truncated).toBe(false);
  });

  it('follows the cursor rather than re-reading the first page', async () => {
    const { client, requests } = pagingClient(2500);
    await client.queryObservations('s1', { start_ns: 0, end_ns: 10 ** 12 });

    expect(requests).toHaveLength(3);
    expect(requests[0]!.cursor).toBeUndefined();
    expect(requests[1]!.cursor).toBeTruthy();
    expect(new Set(requests.slice(1).map((r) => r.cursor)).size).toBe(2);
  });

  it('asks for the largest page the platform will serve', async () => {
    const { client, requests } = pagingClient(10);
    await client.queryObservations('s1', { start_ns: 0, end_ns: 10 ** 12 });
    expect(requests[0]!.limit).toBe(OBSERVATION_PAGE_SIZE);
  });

  it('stops at a bound and reports it rather than reading forever', async () => {
    const { client } = pagingClient(OBSERVATION_PAGE_SIZE * (MAX_OBSERVATION_PAGES + 5));
    const result = await client.queryObservations('s1', { start_ns: 0, end_ns: 10 ** 12 });
    expect(result.observations).toHaveLength(OBSERVATION_PAGE_SIZE * MAX_OBSERVATION_PAGES);
    // The one case paging cannot cover has to be visible, because an invisible
    // one is the bug this file exists for.
    expect(result.truncated).toBe(true);
  });

  it('a single short page needs exactly one request', async () => {
    const { client, requests } = pagingClient(12);
    const result = await client.queryObservations('s1', { start_ns: 0, end_ns: 10 ** 12 });
    expect(result.observations).toHaveLength(12);
    expect(requests).toHaveLength(1);
  });
});

// --- cause two: the timeline read the replay clock -------------------------------- //

describe('the timeline is on the video’s clock', () => {
  it('reaches the end of the 13-second clip instead of stopping at 00:03', () => {
    const groups = groupObservationsByFrame(sampleObservations(SAMPLES), ledgerFor(SAMPLES));

    expect(groups).toHaveLength(SAMPLES);
    expect(frameClock(groups[0]!).text).toBe('0:00.0');

    const last = frameClock(groups[groups.length - 1]!);
    expect(last.text).toBe('0:13.5');
    expect(last.fromSource).toBe(true);
    // The regression, stated as the symptom.
    expect(groups[groups.length - 1]!.sourceMs!).toBeGreaterThan(13_000);
  });

  it('places samples half a second apart across the whole video', () => {
    const groups = groupObservationsByFrame(sampleObservations(SAMPLES), ledgerFor(SAMPLES));
    const seconds = groups.map((group) => group.sourceMs! / 1000);
    for (let index = 1; index < seconds.length; index += 1) {
      expect(seconds[index]! - seconds[index - 1]!).toBeCloseTo(0.5, 1);
    }
  });

  it('does not derive the timestamp from the array position', () => {
    // Frames arriving with gaps. A position-derived clock would renumber them
    // 0, 0.5, 1.0 and be wrong about every one.
    const wanted = new Set([0, 14, 27]);
    const records = sampleObservations(SAMPLES).filter((o) =>
      wanted.has((o.frame_ref as { frame_seq: number }).frame_seq),
    );
    const groups = groupObservationsByFrame(records, ledgerFor(SAMPLES));

    expect(groups.map((g) => g.frameIndex)).toEqual([0, 14, 27]);
    // 14 × 15 ÷ 30.0044 = 6.999 s and 27 × 15 ÷ 30.0044 = 13.498 s — rounded to
    // the tenth they read as 7.0 and 13.5, which is where those frames are.
    expect(groups.map((g) => frameClock(g).text)).toEqual(['0:00.0', '0:07.0', '0:13.5']);
  });

  it('keeps the source frame position out of the analysis index', () => {
    // Analysis frame 27 is source frame 405 at 13.5s. Both facts survive.
    const groups = groupObservationsByFrame(sampleObservations(SAMPLES), ledgerFor(SAMPLES));
    const last = groups[groups.length - 1]!;

    expect(last.frameIndex).toBe(27);
    expect(Math.round((last.sourceMs! * SOURCE_FPS) / 1000)).toBe(27 * STRIDE);
    expect(27 * STRIDE).toBeLessThan(SOURCE_FRAMES);
  });

  it('says so rather than guessing when the ledger has no entry', () => {
    const groups = groupObservationsByFrame(sampleObservations(3), null);
    expect(groups.every((group) => group.sourceMs === null)).toBe(true);
    expect(groups.map((group) => frameClock(group).fromSource)).toEqual([false, false, false]);
  });

  it('orders the timeline by where frames sit in the video', () => {
    const shuffled = [...sampleObservations(SAMPLES)].reverse();
    const groups = groupObservationsByFrame(shuffled, ledgerFor(SAMPLES));
    const stamps = groups.map((group) => group.sourceMs!);
    expect(stamps).toEqual([...stamps].sort((a, b) => a - b));
  });
});

// --- the clock format ------------------------------------------------------------- //

describe('half-second samples are legible', () => {
  it('shows tenths, so consecutive samples are not identical labels', () => {
    expect(formatPreciseClock(0)).toBe('0:00.0');
    expect(formatPreciseClock(0.5)).toBe('0:00.5');
    expect(formatPreciseClock(13.5)).toBe('0:13.5');
    expect(formatPreciseClock(75.5)).toBe('1:15.5');
    expect(formatPreciseClock(600)).toBe('10:00.0');
  });

  it('never renders two adjacent 2 fps samples the same way', () => {
    const groups = groupObservationsByFrame(sampleObservations(SAMPLES), ledgerFor(SAMPLES));
    const labels = groups.map((group) => frameClock(group).text);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

// --- no count-shaped limit on the render path -------------------------------------- //

describe('nothing caps the number of frames rendered', () => {
  it('groups far more frames than any previous limit', () => {
    // 600 analysis frames is a five-minute video at 2 fps.
    const groups = groupObservationsByFrame(sampleObservations(600, 2), ledgerFor(600));
    expect(groups).toHaveLength(600);
  });

  it.each([
    [10, 5],
    [28, 13.5],
    [60, 30],
    [120, 60],
  ])('%i analysis frames span about %s seconds', (samples, seconds) => {
    const groups = groupObservationsByFrame(sampleObservations(samples, 2), ledgerFor(samples));
    expect(groups).toHaveLength(samples);
    const last = groups[groups.length - 1]!.sourceMs! / 1000;
    expect(last).toBeGreaterThan(seconds - 1);
    expect(last).toBeLessThanOrEqual(seconds);
  });
});
