/**
 * The Dashboard — the page that has to answer four questions in fifteen seconds:
 *
 * 1. What is Vision OS seeing right now?
 * 2. What did it understand?
 * 3. How did that become business knowledge?
 * 4. **Why not just send every frame to an LLM?**
 *
 * The fourth is the whole argument, so it gets the largest tile on the page and
 * the numbers are measured rather than claimed.
 */

import { Alert, Box, Card, CardContent, Chip, Divider, Stack, Tooltip, Typography } from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForwardRounded';
import { usePlatform } from '../api/provider';
import { useEconomy, useModel, useVisionState } from '../api/hooks';
import { deriveInsights, VERTICALS, type Vertical } from '../insights/insights';
import {
  CoverageBadge,
  EmptyState,
  Loading,
  MetricCard,
  Provenance,
  SectionTitle,
  Unavailable,
} from '../components/primitives';
import { PipelineStrip } from '../components/PipelineStrip';
import { brand, mono, observability } from '../theme/theme';
import { useState } from 'react';

export function Dashboard() {
  const { sessionId, session } = usePlatform();
  const state = useVisionState();
  const economy = useEconomy();
  const model = useModel();
  const [vertical, setVertical] = useState<Vertical>('retail');

  if (!sessionId) {
    return (
      <EmptyState
        what="active session"
        note="Choose footage in the header and press Start to begin analysis."
      />
    );
  }

  const objects = state.data?.objects ?? [];
  const attributed = objects.filter((o) => Object.keys(o.attributes ?? {}).length > 0);
  const insights = deriveInsights(objects, vertical);
  const reduction = economy.data?.reduction_factor ?? null;

  // A read that failed is not a reading of zero. These cards used to render
  // `?? 0` on error, which drew "the platform could not be asked" and "the
  // platform saw nothing" identically — the exact conflation this application
  // exists to refuse. An em dash says the number is missing; the banner below
  // says why.
  //
  // `&& !data` matters as much as the error does. React Query holds the last
  // successful answer through a failed refresh, so keying off the error alone
  // blanked every card the moment one poll missed and refilled them on the
  // next — a dashboard that flickered between numbers and dashes while the
  // platform was fine.
  const stateFailed = Boolean(state.error && !state.data);
  const economyFailed = Boolean(economy.error && !economy.data);
  const modelFailed = Boolean(model.error && !model.data);
  const dash = '—';

  // The platform is being asked and is answering; the video simply is not
  // moving. Every figure below is then a true zero, and an operator reading a
  // motionless dashboard deserves to be told that rather than left to guess.
  const stalled = Boolean(session && !session.playing && session.frame_index === 0);

  return (
    <Stack spacing={3}>
      {session?.state === 'failed' ? (
        <Unavailable what="Session" reason={session.error ?? 'The platform reported the session failed.'} />
      ) : stalled ? (
        <Alert severity="info" variant="outlined">
          <strong>The session is open but no frames have been processed.</strong> Every figure on
          this page is therefore a true zero rather than a measurement. Press ▶ in the header to
          advance the video.
        </Alert>
      ) : null}

      {stateFailed ? <Unavailable what="Vision State" reason={String(state.error)} /> : null}

      {/* --- headline metrics ------------------------------------------------ */}
      <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
        <MetricCard
          label="Objects tracked"
          value={stateFailed ? dash : objects.length}
          sub={<Provenance source="Vision State projection" />}
        />
        <MetricCard
          label="With attributes"
          value={stateFailed ? dash : attributed.length}
          tone={!stateFailed && attributed.length > 0 ? 'good' : 'default'}
          sub={<Provenance source="Understanding Engine" />}
        />
        <MetricCard
          label="Frames analysed"
          value={session ? session.frame_index : dash}
          sub={<Provenance source="Acquisition" />}
        />
        <MetricCard
          label="Model calls"
          value={economyFailed ? dash : (economy.data?.actual_model_calls ?? 0)}
          tone="good"
          hint="Calls the platform actually spent on video. Binding-time conformance probes are excluded."
          sub={<Provenance source="P15 adapter" />}
        />
        <MetricCard
          label="Model latency p50"
          value={modelFailed ? dash : ((model.data?.inference?.p50_latency_ms ?? 0) / 1000).toFixed(1)}
          unit={modelFailed ? undefined : 's'}
          sub={<Provenance source="Qwen adapter timing" />}
        />
      </Stack>

      {/* --- the argument ---------------------------------------------------- */}
      <Card sx={{ borderColor: `${brand.primary}66` }}>
        <CardContent>
          <SectionTitle
            action={
              <Chip
                size="small"
                label="measured, not estimated"
                sx={{ color: observability.observing, border: `1px solid ${observability.observing}55`, bgcolor: 'transparent' }}
              />
            }
          >
            Why not just send every frame to the model?
          </SectionTitle>

          {economyFailed ? (
            <Unavailable what="Economy report" reason={String(economy.error)} />
          ) : economy.data?.available === false ? (
            <Unavailable what="Economy report" reason={economy.data.reason} />
          ) : (
            <>
              <Stack direction="row" spacing={4} alignItems="flex-end" flexWrap="wrap" useFlexGap>
                <Box>
                  <Typography variant="caption">Naive: one call per frame per object</Typography>
                  <Typography sx={{ fontFamily: mono, fontSize: '2rem', fontWeight: 700, color: observability.blind }}>
                    {economy.data?.naive_model_calls ?? 0}
                  </Typography>
                  <Typography variant="caption">
                    ≈ {formatDuration(economy.data?.naive_wall_clock_s ?? 0)} of inference
                  </Typography>
                </Box>

                <ArrowForwardIcon sx={{ color: brand.textDim, mb: 2 }} />

                <Box>
                  <Typography variant="caption">Vision OS actually spent</Typography>
                  <Typography sx={{ fontFamily: mono, fontSize: '2rem', fontWeight: 700, color: observability.observing }}>
                    {economy.data?.actual_model_calls ?? 0}
                  </Typography>
                  <Typography variant="caption">
                    ≈ {formatDuration(economy.data?.actual_wall_clock_s ?? 0)} of inference
                  </Typography>
                </Box>

                <Box sx={{ flex: 1 }} />

                <Box sx={{ textAlign: 'right' }}>
                  <Typography variant="caption">Reduction</Typography>
                  <Typography sx={{ fontFamily: mono, fontSize: '2.6rem', fontWeight: 800, color: brand.accent, lineHeight: 1 }}>
                    {reduction && reduction >= 1 ? `${reduction.toFixed(1)}×` : '—'}
                  </Typography>
                </Box>
              </Stack>

              <Divider sx={{ my: 2 }} />
              <Typography variant="caption" sx={{ display: 'block', mb: 1 }}>
                Four mechanisms produce the gap. Each is an architectural decision, not a tuning pass:
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {(economy.data?.mechanisms ?? []).map((mechanism) => (
                  <Tooltip key={mechanism.name} title={mechanism.detail} arrow>
                    <Chip size="small" label={mechanism.name} variant="outlined" />
                  </Tooltip>
                ))}
              </Stack>
              {reduction !== null && reduction < 1 ? (
                <Typography variant="caption" sx={{ display: 'block', mt: 1.5, color: observability.degraded }}>
                  The reduction is below 1× on this run. That is reported rather than hidden — it
                  happens early in a session when few frames have been processed relative to the
                  first understanding calls.
                </Typography>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      {/* --- pipeline -------------------------------------------------------- */}
      <Card>
        <CardContent>
          <SectionTitle>Live pipeline</SectionTitle>
          <PipelineStrip />
        </CardContent>
      </Card>

      {/* --- insights -------------------------------------------------------- */}
      <Card>
        <CardContent>
          <SectionTitle
            action={
              <Stack direction="row" spacing={0.5}>
                {(Object.keys(VERTICALS) as Vertical[]).map((id) => (
                  <Chip
                    key={id}
                    size="small"
                    label={VERTICALS[id].label}
                    onClick={() => setVertical(id)}
                    variant={vertical === id ? 'filled' : 'outlined'}
                    color={vertical === id ? 'primary' : 'default'}
                  />
                ))}
              </Stack>
            }
          >
            Business view — {VERTICALS[vertical].description}
          </SectionTitle>

          <Typography variant="caption" sx={{ display: 'block', mb: 1.5 }}>
            <strong>Demonstration layer.</strong> These sentences are assembled in this application
            from Vision OS observations. The platform reports what is visible; deciding what it
            means is the consumer's job, and this is what that looks like.
          </Typography>

          {state.isLoading && objects.length === 0 ? (
            <Loading label="Reading Vision State" />
          ) : insights.length === 0 ? (
            <EmptyState
              what="insights yet"
              note="Insights appear as objects are confirmed and attributes arrive."
            />
          ) : (
            <Stack spacing={1}>
              {insights.slice(0, 8).map((insight) => (
                <Box
                  key={insight.id}
                  sx={{
                    p: 1.25,
                    borderRadius: 2,
                    border: `1px solid ${brand.border}`,
                    borderLeft: `3px solid ${insight.severity === 'notice' ? observability.degraded : brand.primary}`,
                  }}
                >
                  <Typography sx={{ fontSize: '0.92rem' }}>{insight.headline}</Typography>
                  <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 0.75 }}>
                    {insight.basis.map((cited) => (
                      <Tooltip key={cited.field} title={`Vision OS field: ${cited.field}`} arrow>
                        <Chip
                          size="small"
                          label={`${cited.field.split('.').pop()}: ${cited.value}`}
                          sx={{ fontSize: '0.66rem', height: 19, bgcolor: brand.surfaceHigh }}
                        />
                      </Tooltip>
                    ))}
                  </Stack>
                  <Typography variant="caption" sx={{ display: 'block', mt: 0.5, fontStyle: 'italic' }}>
                    {insight.rule}
                  </Typography>
                </Box>
              ))}
            </Stack>
          )}
        </CardContent>
      </Card>

      {/* --- coverage -------------------------------------------------------- */}
      <Stack direction="row" spacing={1.5} alignItems="center">
        <CoverageBadge coverage={state.data?.coverage} />
        <Typography variant="caption">
          Coverage accompanies every state answer. An empty result below full coverage means
          nothing was <em>observed</em> — not that nothing happened.
        </Typography>
      </Stack>
    </Stack>
  );
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
  if (seconds < 90) return `${seconds.toFixed(0)}s`;
  if (seconds < 5400) return `${(seconds / 60).toFixed(1)} min`;
  return `${(seconds / 3600).toFixed(1)} hr`;
}
