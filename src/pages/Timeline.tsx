/**
 * Timeline — chronological events, every one from Vision OS.
 *
 * Built from the platform event stream and the observation feed. The page adds
 * ordering and a readable label; it invents no event and merges none. An entry
 * you see here exists as a record you can open.
 */

import { useMemo } from 'react';
import { Box, Card, CardContent, Chip, Stack, Typography } from '@mui/material';
import { usePlatform, useChannel } from '../api/provider';
import { EmptyState, Mono, SectionTitle } from '../components/primitives';
import { brand, mono, observability } from '../theme/theme';
import type { TapMessage } from '../api/types';

/** Event type → a plain-language label. A rename, never an interpretation. */
const LABEL: Record<string, string> = {
  'stream.connected': 'Camera connected',
  'stream.lost': 'Camera signal lost',
  'stream.epoch_advanced': 'Stream restarted — new epoch',
  'detection.completed': 'Frame analysed',
  'tracking.track_created': 'New track started',
  'tracking.track_updated': 'Track updated',
  'tracking.track_lost': 'Track lost',
  'tracking.track_terminated': 'Track ended',
  'registry.object_created': 'Object identified',
  'registry.lifecycle_changed': 'Object lifecycle changed',
  'registry.identity_asserted': 'Identity asserted',
  'registry.region_transition': 'Region boundary crossed',
  'health.coverage_changed': 'Observability changed',
  'runtime.pipeline_attached': 'Pipeline attached',
  'understanding.failed': 'Understanding failed',
  'understanding.fallback_engaged': 'Model fallback engaged',
};

const NOISY = new Set(['tracking.track_updated', 'detection.completed']);

export function Timeline() {
  const { sessionId, buffer, revision } = usePlatform();
  const observations = useChannel('observation');
  void revision;

  const entries = useMemo(() => {
    const events: TapMessage[] = [];
    for (const channel of ['acquisition', 'detection', 'tracking', 'registry', 'health', 'transport'] as const) {
      events.push(...buffer.get(channel));
    }

    const rows = events
      .filter((message) => message.type === 'event')
      .filter((message) => {
        const type = String((message.payload as Record<string, unknown>).event_type ?? '');
        // High-frequency per-frame events would drown the story. They remain
        // visible in the Observations feed and in the platform's own metrics.
        return !NOISY.has(type);
      })
      .map((message) => ({
        seq: message.seq,
        type: String((message.payload as Record<string, unknown>).event_type ?? 'event'),
        frame: message.frame_index,
        payload: message.payload as Record<string, unknown>,
        kind: 'event' as const,
      }));

    for (const message of observations) {
      if (message.type !== 'observation') continue;
      const payload = message.payload as Record<string, unknown>;
      rows.push({
        seq: message.seq,
        type: `observation.${payload.observation_type}`,
        frame: message.frame_index,
        payload,
        kind: 'event' as const,
      });
    }

    return rows.sort((a, b) => a.seq - b.seq).slice(-150);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buffer, revision, observations]);

  if (!sessionId) return <EmptyState what="active session" />;

  return (
    <Stack spacing={2}>
      <SectionTitle>Event timeline</SectionTitle>

      {entries.length === 0 ? (
        <EmptyState what="events yet" note="Events appear as the platform processes frames." />
      ) : (
        <Card>
          <CardContent>
            <Stack spacing={0}>
              {entries.map((entry, index) => (
                <Stack key={`${entry.seq}-${index}`} direction="row" spacing={2} sx={{ py: 0.9 }}>
                  <Typography sx={{ fontFamily: mono, fontSize: '0.72rem', color: brand.textDim, minWidth: 64 }}>
                    {entry.frame !== undefined ? `f${String(entry.frame).padStart(4, '0')}` : `#${entry.seq}`}
                  </Typography>
                  <Box
                    sx={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      mt: 0.7,
                      flexShrink: 0,
                      bgcolor: colourFor(entry.type),
                    }}
                  />
                  <Box sx={{ flex: 1 }}>
                    <Typography sx={{ fontSize: '0.85rem' }}>
                      {LABEL[entry.type] ?? entry.type}
                    </Typography>
                    <Mono colour={brand.textDim}>{summarise(entry.payload)}</Mono>
                  </Box>
                  <Chip size="small" variant="outlined" label={entry.type.split('.')[0]} sx={{ height: 19, fontSize: '0.62rem' }} />
                </Stack>
              ))}
            </Stack>
          </CardContent>
        </Card>
      )}

      <Typography variant="caption">
        Every entry is a record Vision OS produced. This page orders and labels them; it creates
        none.
      </Typography>
    </Stack>
  );
}

function colourFor(type: string): string {
  if (type.includes('lost') || type.includes('failed')) return observability.blind;
  if (type.includes('changed') || type.includes('fallback')) return observability.degraded;
  if (type.startsWith('observation.')) return brand.primary;
  return observability.observing;
}

function summarise(payload: Record<string, unknown>): string {
  const interesting = ['object_id', 'track_id', 'class_id', 'reason', 'status', 'previous', 'current', 'detail'];
  const parts = interesting
    .filter((key) => payload[key] !== undefined && payload[key] !== null && payload[key] !== '')
    .map((key) => `${key}=${String(payload[key]).slice(0, 28)}`);
  return parts.join('  ') || '—';
}
