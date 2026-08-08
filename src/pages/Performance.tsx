/**
 * Performance — the platform's own metrics, grouped by module.
 *
 * Nothing here is timed by this application. Wrapping a module to measure it
 * would change what is being measured; the Metrics Engine's histograms are both
 * more accurate and free.
 */

import { useMemo } from 'react';
import { Box, Card, CardContent, Divider, Stack, Typography } from '@mui/material';
import { usePlatform } from '../api/provider';
import { useEconomy, useMetrics, useModel } from '../api/hooks';
import { EmptyState, MetricCard, Mono, SectionTitle, Unavailable } from '../components/primitives';
import { brand, mono } from '../theme/theme';

const MODULES: Array<{ module: string; prefixes: string[] }> = [
  { module: 'Acquisition', prefixes: ['vision_os.frames', 'vision_os.decode', 'vision_os.source', 'vision_os.buffer', 'vision_os.scheduler'] },
  { module: 'Detection', prefixes: ['vision_os.detection'] },
  { module: 'Tracking', prefixes: ['vision_os.tracking'] },
  { module: 'Object Registry', prefixes: ['vision_os.registry'] },
  { module: 'Crop Manager', prefixes: ['vision_os.cropping'] },
  { module: 'Understanding', prefixes: ['vision_os.understanding'] },
  { module: 'Observation Builder', prefixes: ['vision_os.synthesis'] },
  { module: 'Vision State', prefixes: ['vision_os.state'] },
  { module: 'Observation API', prefixes: ['vision_os.api'] },
  { module: 'Coverage', prefixes: ['vision_os.coverage'] },
];

export function Performance() {
  const { sessionId, session, buffer, revision } = usePlatform();
  const metrics = useMetrics();
  const model = useModel();
  const economy = useEconomy();

  const observedFps = useMemo(() => {
    const frames = buffer.get('acquisition');
    if (frames.length < 2) return null;
    const first = frames[0]!;
    const last = frames[frames.length - 1]!;
    const seconds = (last.ts_ns - first.ts_ns) / 1e9;
    return seconds > 0 ? (frames.length - 1) / seconds : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buffer, revision]);

  const flat = useMemo(() => flatten(metrics.data?.sample?.values ?? {}), [metrics.data]);

  if (!sessionId) return <EmptyState what="active session" />;
  if (metrics.data?.available === false) {
    return <Unavailable what="Metrics" reason={metrics.data.reason} />;
  }

  return (
    <Stack spacing={2.5}>
      <SectionTitle>Performance</SectionTitle>

      <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
        <MetricCard
          label="Pipeline FPS"
          value={observedFps ? observedFps.toFixed(2) : '—'}
          hint="Measured from tap arrival times, not from the configured target. A gap between the two is the finding."
        />
        <MetricCard label="Target FPS" value={session?.target_fps ?? '—'} />
        <MetricCard label="Frames analysed" value={metrics.data?.frames_emitted ?? 0} />
        <MetricCard
          label="Understanding p50"
          value={((model.data?.inference?.p50_latency_ms ?? 0) / 1000).toFixed(1)}
          unit="s"
          hint="The expensive stage. CPU-only inference — a GPU changes this by an order of magnitude."
        />
        <MetricCard label="Observations" value={economy.data?.observations_built ?? 0} />
        <MetricCard
          label="Model calls"
          value={economy.data?.actual_model_calls ?? 0}
          tone="good"
        />
      </Stack>

      <Card>
        <CardContent>
          <SectionTitle>Per-module metrics</SectionTitle>
          {flat.length === 0 ? (
            <EmptyState
              what="metric values"
              note="The Metrics Engine reported no readable values. That is a capability gap, not a zero."
            />
          ) : (
            <Stack spacing={2}>
              {MODULES.map(({ module, prefixes }) => {
                const rows = flat.filter((row) => prefixes.some((p) => row.key.startsWith(p)));
                if (rows.length === 0) return null;
                return (
                  <Box key={module}>
                    <Typography variant="h3" sx={{ mb: 0.75 }}>
                      {module}
                    </Typography>
                    <Stack spacing={0.35}>
                      {rows.slice(0, 14).map((row) => (
                        <Stack key={row.key} direction="row" spacing={2}>
                          <Typography sx={{ fontFamily: mono, fontSize: '0.7rem', color: brand.textDim, flex: 1 }}>
                            {row.key.replace('vision_os.', '')}
                          </Typography>
                          <Mono>{format(row.value)}</Mono>
                        </Stack>
                      ))}
                    </Stack>
                    <Divider sx={{ mt: 1.25 }} />
                  </Box>
                );
              })}
            </Stack>
          )}
        </CardContent>
      </Card>

      <Typography variant="caption">
        {metrics.data?.names.length ?? 0} metric names in the platform's closed vocabulary.
        <strong> vision_os.replay.mismatches must be zero</strong> — a non-zero value means a
        rebuild produced a different world from the live run.
      </Typography>
    </Stack>
  );
}

interface FlatRow {
  key: string;
  value: unknown;
}

function flatten(value: unknown, prefix = ''): FlatRow[] {
  if (value === null || value === undefined) return [];
  if (typeof value !== 'object') return prefix ? [{ key: prefix, value }] : [];
  if (Array.isArray(value)) return prefix ? [{ key: prefix, value }] : [];

  const out: FlatRow[] = [];
  for (const [key, held] of Object.entries(value as Record<string, unknown>)) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (held !== null && typeof held === 'object' && !Array.isArray(held)) {
      out.push(...flatten(held, next));
    } else {
      out.push({ key: next, value: held });
    }
  }
  return out;
}

function format(value: unknown): string {
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(3);
  if (typeof value === 'object') return JSON.stringify(value).slice(0, 60);
  return String(value);
}
