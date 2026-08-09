/**
 * Live Summary — the page for the person who did not build this.
 *
 * Every other page in this product answers an engineer's question. This one
 * answers *"what is happening?"* in sentences, at a size you can read from
 * across a desk, with the machinery folded away behind one link.
 *
 * The machinery is folded away, not removed. "Show where this came from" opens
 * the same field citations the Dashboard shows inline, because a summary a
 * manager cannot audit is a summary they have to take on trust — and this is a
 * product whose entire argument is that you should not have to.
 */

import { useState } from 'react';
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  Collapse,
  Link,
  Stack,
  Typography,
} from '@mui/material';
import { usePlatform } from '../api/provider';
import { ApiError } from '../api/client';
import { useModel, useVisionState } from '../api/hooks';
import { describeScene } from '../insights/scene';
import { CoverageBadge, EmptyState, Loading, Unavailable } from '../components/primitives';
import { brand, mono, observability } from '../theme/theme';

export function LiveSummary() {
  const { sessionId, session } = usePlatform();
  const state = useVisionState();
  const model = useModel();
  const [showFields, setShowFields] = useState(false);

  if (!sessionId) {
    return (
      <EmptyState
        what="camera running"
        note="Choose footage in the header and press Start. The summary appears as the camera sees things."
      />
    );
  }

  // Only when there is nothing to show.
  //
  // React Query keeps the last successful `data` when a later poll fails, and
  // this used to replace a filled page with an error box on any single failed
  // refresh — then put it back 2.5 seconds later when the next one succeeded.
  // Polling twice a minute, a platform that hiccups occasionally made the page
  // flash between the summary and an empty state, over and over.
  //
  // A failed refresh is not the loss of what the platform already said. The
  // page keeps showing it and admits it has stopped updating, which is both
  // steadier to look at and truer than blanking.
  if (state.error && !state.data) {
    const booting =
      state.error instanceof ApiError && state.error.message.includes('no booted session');
    return (
      <Unavailable
        what="Camera summary"
        reason={
          booting
            ? 'The camera is still starting up. The first start takes a few minutes while the ' +
              'platform checks that the model answers honestly before it will trust a single word ' +
              'from it.'
            : String(state.error)
        }
      />
    );
  }

  const objects = state.data?.objects ?? [];
  const scene = describeScene(objects);
  const coverage = state.data?.coverage;
  const recognises = state.data?.capabilities?.producible_classes ?? [];
  const describedBy = model.data?.runtime?.model;
  const realModel = model.data?.adapter_id === 'understander.qwen_vl';
  const stalled = Boolean(session && !session.playing && session.frame_index === 0);

  return (
    <Stack spacing={3} sx={{ maxWidth: 900 }}>
      {stalled ? (
        <Alert severity="info" variant="outlined">
          The camera is loaded but not running yet. Press ▶ in the header to start it.
        </Alert>
      ) : null}

      {/* Data on screen, refresh failing. Say so quietly rather than throwing
          away what the platform already reported. */}
      {state.error && state.data ? (
        <Alert severity="warning" variant="outlined" sx={{ borderColor: observability.degraded }}>
          This summary has stopped updating. What you see below is the last thing the camera
          reported, not what it can see now.
        </Alert>
      ) : null}

      {/* --- the whole scene, in one sentence -------------------------------- */}
      <Box>
        <Typography sx={{ fontSize: '1.9rem', fontWeight: 700, lineHeight: 1.3, letterSpacing: '-0.02em' }}>
          {state.isLoading && objects.length === 0 ? 'Looking…' : scene.headline}
        </Typography>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1.25 }}>
          {/* Only once an answer has arrived. `COVERAGE MISSING` means the
              platform broke a contract it always keeps, and showing it while
              the first request is still in flight cries wolf on the one badge
              that has to be believed. */}
          {state.data ? <CoverageBadge coverage={coverage} /> : null}
          {session ? (
            <Typography variant="caption">
              {session.media_name} · second {Math.round(session.frame_index / Math.max(session.target_fps, 1))} of{' '}
              {Math.round(session.frame_count / Math.max(session.target_fps, 1))}
            </Typography>
          ) : null}
        </Stack>
      </Box>

      {/* --- what each one is doing ------------------------------------------ */}
      {state.isLoading && objects.length === 0 ? (
        <Loading label="Asking the camera what it can see" />
      ) : objects.length === 0 ? (
        <Card>
          <CardContent>
            <Typography sx={{ fontSize: '1rem' }}>
              The camera is watching and has not recognised anything yet.
            </Typography>
            <Typography variant="caption" sx={{ display: 'block', mt: 1 }}>
              That is a real answer, not a failure. Check the coverage badge above: if the camera
              could see, then nothing it recognises was there.
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <Stack spacing={2}>
          {groupByObject(scene.lines).map(([objectId, lines]) => (
            <Card key={objectId}>
              <CardContent>
                <Stack spacing={1.25}>
                  {lines.map((line, index) => (
                    <Box key={line.id}>
                      <Typography
                        sx={{
                          fontSize: index === 0 ? '1.15rem' : '0.95rem',
                          fontWeight: index === 0 ? 600 : 400,
                          lineHeight: 1.6,
                          color: index === 0 ? brand.text : brand.textDim,
                        }}
                      >
                        {line.text}
                      </Typography>
                      <Collapse in={showFields}>
                        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 0.75, mb: 0.5 }}>
                          {line.cites.map((cited) => (
                            <Chip
                              key={`${line.id}:${cited.field}`}
                              size="small"
                              label={`${cited.field} = ${cited.value}`}
                              sx={{ fontSize: '0.66rem', height: 20, fontFamily: mono, bgcolor: brand.surfaceHigh }}
                            />
                          ))}
                        </Stack>
                      </Collapse>
                    </Box>
                  ))}
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      <Link
        component="button"
        underline="hover"
        onClick={() => setShowFields((shown) => !shown)}
        sx={{ alignSelf: 'flex-start', fontSize: '0.82rem', color: brand.primary }}
      >
        {showFields ? 'Hide where this came from' : 'Show where this came from'}
      </Link>

      {/* --- the two things a viewer must not get wrong ----------------------- */}
      <Card sx={{ bgcolor: brand.surface }}>
        <CardContent>
          <Typography variant="caption" sx={{ display: 'block', textTransform: 'uppercase', letterSpacing: '0.08em', mb: 1 }}>
            How to read this page
          </Typography>

          <Typography sx={{ fontSize: '0.9rem', mb: 1.25 }}>
            <strong>These sentences are written from what the camera reported</strong> — nothing on
            this page is guessed, and nothing is added that the camera did not say.
          </Typography>

          <Typography sx={{ fontSize: '0.9rem', mb: 1.25 }}>
            <strong>This camera is set up to recognise{' '}
            {recognises.length ? recognises.join(', ') : 'a fixed list of things'}.</strong>{' '}
            Anything else in the picture is not reported at all — and "not reported" is not the same
            as "not there". Widening that list is a setup change, not a new product.
          </Typography>

          {describedBy ? (
            <Typography sx={{ fontSize: '0.9rem' }}>
              <strong>Descriptions come from {describedBy}</strong>, running on this machine. No
              image leaves it.
              {realModel ? null : ' The usual model is not answering right now, so the details above are placeholders rather than what a model saw.'}
            </Typography>
          ) : null}
        </CardContent>
      </Card>

      {coverage && coverage.observable_fraction < 1 ? (
        <Alert severity="warning" variant="outlined" sx={{ borderColor: observability.degraded }}>
          The camera could not see all of the area during this period. Anything missing from the
          summary may simply not have been visible.
        </Alert>
      ) : null}
    </Stack>
  );
}

function groupByObject(lines: ReturnType<typeof describeScene>['lines']) {
  const grouped = new Map<string, typeof lines>();
  for (const line of lines) {
    grouped.set(line.objectId, [...(grouped.get(line.objectId) ?? []), line]);
  }
  return [...grouped.entries()];
}
