/**
 * Live Cameras — the video stage with Vision OS overlays.
 *
 * Boxes, track ids and trajectories are drawn from `ObjectView.spatial`, which
 * is normalized frame-of-reference geometry the platform produced. The overlay
 * computes position on screen; it never computes *what* is at that position.
 *
 * Frame serving is off by default (V12 — pixels stay local). When it is off this
 * page still works: the geometry is real even when the picture is withheld, and
 * saying so is more honest than a black rectangle.
 */

import { useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Chip, Stack, TextField, Typography } from '@mui/material';
import { usePlatform } from '../api/provider';
import { useHealth, useVisionState } from '../api/hooks';
import { CoverageBadge, EmptyState, Mono, SectionTitle } from '../components/primitives';
import { brand, lifecycleColour, mono, observability } from '../theme/theme';

export function LiveCameras() {
  const { client, sessionId, session } = usePlatform();
  const health = useHealth();
  const state = useVisionState();
  const [purpose, setPurpose] = useState('');
  const [confirmed, setConfirmed] = useState('');

  if (!sessionId) return <EmptyState what="active session" />;

  const serveFrames = health.data?.harness.serve_frames ?? false;
  const objects = state.data?.objects ?? [];
  const index = session?.frame_index ?? 0;

  return (
    <Stack spacing={2}>
      <SectionTitle action={<CoverageBadge coverage={state.data?.coverage} />}>
        {session?.camera_id ?? 'Camera'} — {session?.media_name}
      </SectionTitle>

      <Card>
        <CardContent>
          <Box
            sx={{
              position: 'relative',
              aspectRatio: '16 / 9',
              bgcolor: '#05070d',
              borderRadius: 2,
              overflow: 'hidden',
              border: `1px solid ${brand.border}`,
            }}
          >
            {serveFrames && confirmed ? (
              <Box
                component="img"
                alt={`frame ${index}`}
                src={client.frameUrl(sessionId, index, confirmed)}
                sx={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            ) : (
              <Stack alignItems="center" justifyContent="center" sx={{ height: '100%', px: 4 }}>
                <Typography variant="caption" sx={{ textAlign: 'center' }}>
                  Imagery is not being served. Vision OS keeps pixels local by default — only
                  observations travel. The geometry below is real regardless.
                </Typography>
              </Stack>
            )}

            {/* Overlays: normalized coordinates → percentages. Pure projection. */}
            {objects.map((object) => {
              const bbox = object.spatial?.bbox;
              if (!bbox) return null;
              const colour = lifecycleColour(object.lifecycle);
              return (
                <Box
                  key={object.object_id}
                  sx={{
                    position: 'absolute',
                    left: `${bbox.x1 * 100}%`,
                    top: `${bbox.y1 * 100}%`,
                    width: `${(bbox.x2 - bbox.x1) * 100}%`,
                    height: `${(bbox.y2 - bbox.y1) * 100}%`,
                    border: `2px solid ${colour}`,
                    borderRadius: 1,
                    boxShadow: `0 0 0 1px #00000055`,
                  }}
                >
                  <Box
                    sx={{
                      position: 'absolute',
                      top: -21,
                      left: -2,
                      px: 0.75,
                      py: 0.1,
                      bgcolor: colour,
                      color: '#05070d',
                      borderRadius: 0.75,
                      fontFamily: mono,
                      fontSize: '0.63rem',
                      fontWeight: 700,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {object.class_id} · {object.object_id.slice(-6)}
                  </Box>
                </Box>
              );
            })}
          </Box>

          {serveFrames && !confirmed ? (
            <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
              <TextField
                size="small"
                label="Purpose (recorded with your identity)"
                value={purpose}
                onChange={(event) => setPurpose(event.target.value)}
                sx={{ flex: 1 }}
              />
              <Button variant="outlined" disabled={!purpose.trim()} onClick={() => setConfirmed(purpose.trim())}>
                View imagery
              </Button>
            </Stack>
          ) : null}

          <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} flexWrap="wrap" useFlexGap>
            <Chip size="small" variant="outlined" label={`frame ${index} / ${session?.frame_count ?? 0}`} />
            <Chip size="small" variant="outlined" label={`${objects.length} objects`} />
            <Chip size="small" variant="outlined" label={session?.semantics ?? '—'} />
            {session?.playing ? (
              <Chip size="small" label="running" sx={{ bgcolor: `${observability.observing}22`, color: observability.observing }} />
            ) : (
              <Chip size="small" label="paused" variant="outlined" />
            )}
          </Stack>
        </CardContent>
      </Card>

      {!serveFrames ? (
        <Alert severity="info" variant="outlined">
          <strong>Pixels stay local (V12).</strong> Set <Mono>VOSVC_SERVE_FRAMES=1</Mono> on the
          platform service to display imagery. Every frame fetch then requires a declared purpose
          and is written to the audit trail.
        </Alert>
      ) : null}
    </Stack>
  );
}
