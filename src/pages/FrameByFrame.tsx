/**
 * Frame by Frame — the vision model describing the video, second by second.
 *
 * This is the page that answers "what is happening in the video?" in the way a
 * person would answer it. It is also the page that most needs its label read,
 * so the label is not a footnote here — it is the first thing on screen and it
 * is repeated on every card.
 *
 * These sentences are **not Vision OS observations**. The platform's records
 * are attached to a tracked object, drawn from a vocabulary its registry
 * accepted, carry a confidence and an evidence reference, and replay to the
 * same value. A narration has none of that: it is the model looking at a whole
 * picture and writing a sentence. It is useful, it is often right, and nothing
 * in the platform stands behind it.
 *
 * Both belong in the product. Pretending they are the same thing is what would
 * make it dishonest.
 */

import { useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material';
import { usePlatform } from '../api/provider';
import { EmptyState, Mono, SectionTitle, Unavailable } from '../components/primitives';
import { brand, mono, observability } from '../theme/theme';

export function FrameByFrame() {
  const { client, sessionId, session } = usePlatform();

  const feed = useQuery({
    queryKey: ['narration', sessionId],
    queryFn: () => client.narration(sessionId!),
    enabled: Boolean(sessionId),
    // A caption takes 10–20 s on CPU, so polling faster than this only asks the
    // same question again before the model has had time to answer once.
    refetchInterval: 4000,
    retry: false,
  });

  const start = useMutation({
    mutationFn: () => client.startNarration(sessionId!, {}),
    onSuccess: () => feed.refetch(),
  });

  // Begin as soon as the page is opened on a live session. Waiting for a second
  // button press would cost the audience twenty seconds of nothing while a
  // caption ran, and there is nothing to configure.
  useEffect(() => {
    if (sessionId && feed.data && !feed.data.started && !start.isPending) {
      start.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, feed.data?.started]);

  if (!sessionId) {
    return (
      <EmptyState
        what="camera running"
        note="Choose footage in the header and press Start, then come back here."
      />
    );
  }

  if (start.data && start.data.available === false) {
    return <Unavailable what="Frame narration" reason={start.data.reason} />;
  }

  const records = [...(feed.data?.records ?? [])].sort((a, b) => a.frame_index - b.frame_index);
  const fps = session?.target_fps ?? 6;
  const running = feed.data?.running ?? false;

  return (
    <Stack spacing={2.5} sx={{ maxWidth: 900 }}>
      <SectionTitle
        action={
          <Chip
            size="small"
            label={running ? 'describing…' : records.length ? 'finished' : 'starting'}
            sx={{
              bgcolor: 'transparent',
              border: `1px solid ${running ? observability.observing : brand.border}`,
              color: running ? observability.observing : brand.textDim,
            }}
          />
        }
      >
        What happens in the video
      </SectionTitle>

      <Alert severity="info" variant="outlined">
        <strong>These sentences come from the vision model, not from Vision OS.</strong> The model
        looks at each frame and describes it. Unlike everything on the other pages, these carry no
        confidence, no evidence and no guarantee — the platform did not record them and does not
        stand behind them. They are here because they are the fastest way to understand a video, and
        labelled because they are not proof of anything.
      </Alert>

      {running ? <LinearProgress sx={{ height: 3, borderRadius: 2 }} /> : null}

      {records.length === 0 ? (
        <Card>
          <CardContent>
            <Typography sx={{ fontSize: '1rem' }}>
              The model is looking at the first frame.
            </Typography>
            <Typography variant="caption" sx={{ display: 'block', mt: 1 }}>
              Each description takes ten to twenty seconds on this machine, because the model runs
              here rather than in a data centre. On a GPU this is roughly a second.
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <Stack spacing={1.5}>
          {records.map((record) => (
            <Card key={record.frame_index} sx={{ borderLeft: `3px solid ${brand.primary}` }}>
              <CardContent sx={{ py: 1.75, '&:last-child': { pb: 1.75 } }}>
                <Stack direction="row" spacing={2} alignItems="flex-start">
                  <Box sx={{ minWidth: 74 }}>
                    <Typography variant="caption" sx={{ display: 'block', fontSize: '0.62rem' }}>
                      at
                    </Typography>
                    <Mono>{formatClock(record.frame_index / Math.max(fps, 1))}</Mono>
                    <Typography variant="caption" sx={{ display: 'block', fontSize: '0.6rem', color: brand.textDim }}>
                      frame {record.frame_index}
                    </Typography>
                  </Box>

                  <Box sx={{ flex: 1 }}>
                    {record.available ? (
                      <Typography sx={{ fontSize: '1.02rem', lineHeight: 1.6 }}>
                        {record.text}
                      </Typography>
                    ) : (
                      // A refusal stays a refusal. The alternative — quietly
                      // dropping the frame — would make the account of the video
                      // look continuous when part of it is missing.
                      <Typography sx={{ fontSize: '0.95rem', color: observability.degraded }}>
                        The model did not answer for this frame. {record.reason}
                      </Typography>
                    )}
                    <Typography
                      variant="caption"
                      sx={{ display: 'block', mt: 0.75, fontFamily: mono, fontSize: '0.62rem' }}
                    >
                      model description · {(record.latency_ms / 1000).toFixed(1)}s
                      {record.model ? ` · ${record.model}` : ''}
                    </Typography>
                  </Box>
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      {!running && records.length > 0 ? (
        <Button variant="outlined" size="small" onClick={() => start.mutate()} sx={{ alignSelf: 'flex-start' }}>
          Describe more frames
        </Button>
      ) : null}

      {feed.data?.stride ? (
        <Typography variant="caption">
          Sampling every {feed.data.stride} frames — about one description per second of footage.
          Describing every frame would take roughly {Math.round(feed.data.stride * 15)} times longer
          and tell you almost nothing more.
        </Typography>
      ) : null}
    </Stack>
  );
}

function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, '0')}`;
}
