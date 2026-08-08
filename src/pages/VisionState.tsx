/**
 * Vision State — the current world, in human terms.
 *
 * A projection, not a log: this is what the platform believes is true *now*.
 * Coverage is rendered unconditionally because the platform returns it
 * unconditionally, and `complete` is shown because a consumer concluding
 * "nothing is here" must check it first.
 */

import { Box, Card, CardContent, Chip, Divider, Stack, Tooltip, Typography } from '@mui/material';
import { usePlatform } from '../api/provider';
import { useVisionState } from '../api/hooks';
import { trackedSeconds } from '../insights/insights';
import {
  ConfidenceBadge,
  CoverageBadge,
  EmptyState,
  Loading,
  MetricCard,
  Mono,
  SectionTitle,
  Unavailable,
} from '../components/primitives';
import { brand, lifecycleColour, mono, observability } from '../theme/theme';

export function VisionState() {
  const { sessionId } = usePlatform();
  const state = useVisionState();

  if (!sessionId) return <EmptyState what="active session" />;
  if (state.error) return <Unavailable what="Vision State" reason={String(state.error)} />;

  const objects = state.data?.objects ?? [];
  const snapshot = state.data?.snapshot;

  return (
    <Stack spacing={2.5}>
      <SectionTitle action={<CoverageBadge coverage={state.data?.coverage} />}>
        Current Vision State
      </SectionTitle>

      <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
        <MetricCard label="Objects" value={objects.length} />
        <MetricCard label="Partitions" value={snapshot?.partitions.length ?? 0} hint="State is partitioned by camera." />
        <MetricCard label="Consistency" value={snapshot?.consistency ?? '—'} />
        <MetricCard label="Max lag" value={(snapshot?.max_lag_ms ?? 0).toFixed(1)} unit="ms" />
        <MetricCard
          label="Complete"
          value={state.data?.complete ? 'yes' : 'no'}
          tone={state.data?.complete ? 'good' : 'warn'}
          hint="A consumer concluding 'nothing is here' must check this and coverage first."
        />
      </Stack>

      {state.isLoading && objects.length === 0 ? (
        <Loading label="Reading the projection" />
      ) : objects.length === 0 ? (
        <EmptyState what="objects in state" note="Check coverage before concluding the scene was empty." />
      ) : (
        <Stack spacing={2}>
          {objects.map((object) => {
            const attributes = Object.values(object.attributes ?? {});
            const colour = lifecycleColour(object.lifecycle);
            return (
              <Card key={object.object_id} sx={{ borderLeft: `3px solid ${colour}` }}>
                <CardContent>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Typography sx={{ fontWeight: 700 }}>
                      {object.class_id} <Mono colour={brand.textDim}>{object.object_id.slice(-8)}</Mono>
                    </Typography>
                    <Box sx={{ flex: 1 }} />
                    <Chip size="small" label={object.lifecycle} sx={{ color: colour, border: `1px solid ${colour}55`, bgcolor: 'transparent' }} />
                  </Stack>

                  <Stack direction="row" spacing={3} sx={{ mt: 1.5 }} flexWrap="wrap" useFlexGap>
                    <Detail label="Current status" value={object.is_stale ? 'believed' : 'visible'} />
                    <Detail label="Lifetime" value={`${trackedSeconds(object).toFixed(1)}s`} />
                    <Detail label="Observations" value={String(object.observation_count)} />
                    <Detail label="Evidence refs" value={String(attributes.filter((a) => a.evidence_ref).length)} />
                    <Detail label="Camera" value={object.camera_id} />
                  </Stack>

                  {object.is_stale ? (
                    <Typography variant="caption" sx={{ display: 'block', mt: 1, color: observability.degraded }}>
                      The last sighting was believed rather than measured — the platform is
                      predicting this position, not observing it.
                    </Typography>
                  ) : null}

                  <Divider sx={{ my: 1.5 }} />
                  <Typography variant="caption" sx={{ display: 'block', mb: 0.75 }}>
                    Attributes
                  </Typography>
                  {attributes.length === 0 ? (
                    <Typography variant="caption" sx={{ fontStyle: 'italic' }}>
                      None yet — understanding is triggered and budgeted, not run per frame.
                    </Typography>
                  ) : (
                    <Stack spacing={0.6}>
                      {attributes.map((attribute) => (
                        <Stack key={attribute.key} direction="row" spacing={1} alignItems="center">
                          <Typography variant="caption" sx={{ minWidth: 130, fontFamily: mono, fontSize: '0.68rem' }}>
                            {attribute.key}
                          </Typography>
                          <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, flex: 1 }}>
                            {String(attribute.value)}
                          </Typography>
                          <ConfidenceBadge confidence={attribute.confidence} />
                          {attribute.evidence_ref ? (
                            <Tooltip title={`Evidence ${attribute.evidence_ref}`} arrow>
                              <Chip size="small" variant="outlined" label="evidence" sx={{ height: 19, fontSize: '0.62rem' }} />
                            </Tooltip>
                          ) : null}
                        </Stack>
                      ))}
                    </Stack>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography variant="caption" sx={{ display: 'block', fontSize: '0.64rem' }}>
        {label}
      </Typography>
      <Mono>{value}</Mono>
    </Box>
  );
}
