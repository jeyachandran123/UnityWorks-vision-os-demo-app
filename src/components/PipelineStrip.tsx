/**
 * The live pipeline, as a horizontal strip.
 *
 * Nine stages, each showing whether it is producing and how much. The one piece
 * of discipline carried over from the engineering console: a stage that produced
 * **nothing** and a stage that could not be **observed** are drawn differently.
 * A commercial dashboard that showed both as a grey box would be hiding the
 * difference between a quiet scene and a broken tap.
 */

import { Box, Chip, Stack, Tooltip, Typography } from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { usePlatform } from '../api/provider';
import { useModel } from '../api/hooks';
import { brand, mono, observability } from '../theme/theme';
import type { Channel } from '../api/types';

const STAGES: Array<{ channel: Channel; label: string; module: string }> = [
  { channel: 'acquisition', label: 'Video', module: 'M2·M3·M4' },
  { channel: 'detection', label: 'Detection', module: 'M5' },
  { channel: 'tracking', label: 'Tracking', module: 'M6' },
  { channel: 'registry', label: 'Registry', module: 'M7' },
  { channel: 'cropping', label: 'Crop', module: 'M8' },
  { channel: 'understanding', label: 'Understanding', module: 'M9' },
  { channel: 'synthesis', label: 'Builder', module: 'M11' },
  { channel: 'state', label: 'Vision State', module: 'M12' },
  { channel: 'observation', label: 'Observation API', module: 'M14' },
];

/** Stages whose only signal is the Event Bus — without it they are unobservable. */
const EVENT_ONLY = new Set<Channel>(['cropping', 'understanding', 'synthesis']);

export function PipelineStrip() {
  const { buffer, revision, session } = usePlatform();
  const model = useModel();
  void revision;

  const counts = buffer.counts();
  const busAttached = session?.events_attached ?? false;
  const vlmCalls = model.data?.inference?.requests ?? 0;

  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Stack direction="row" alignItems="stretch" spacing={0} sx={{ minWidth: 900 }}>
        {STAGES.map((stage, index) => {
          const count = counts[stage.channel] ?? 0;
          const unobservable = EVENT_ONLY.has(stage.channel) && !busAttached;
          const active = count > 0;

          // Understanding is the expensive stage and the one the audience cares
          // about, so it reports model calls rather than message counts.
          const value =
            stage.channel === 'understanding' && vlmCalls > 0 ? `${vlmCalls} calls` : `${count}`;

          const colour = unobservable
            ? observability.degraded
            : active
              ? observability.observing
              : brand.textDim;

          return (
            <Stack key={stage.channel} direction="row" alignItems="center">
              <Tooltip
                arrow
                title={
                  unobservable
                    ? 'Not observable — the Event Bus tap is not attached. Nothing may be concluded from this stage being empty.'
                    : active
                      ? `${stage.module} produced ${count} messages this session.`
                      : `${stage.module} was observed and produced nothing. That is a legitimate answer, not a fault.`
                }
              >
                <Box
                  sx={{
                    px: 1.5,
                    py: 1,
                    minWidth: 104,
                    borderRadius: 2,
                    border: `1px solid ${active && !unobservable ? `${observability.observing}44` : brand.border}`,
                    bgcolor: active && !unobservable ? `${observability.observing}0d` : 'transparent',
                    opacity: unobservable ? 0.75 : 1,
                  }}
                >
                  <Typography sx={{ fontSize: '0.78rem', fontWeight: 650 }}>{stage.label}</Typography>
                  <Typography variant="caption" sx={{ fontFamily: mono, fontSize: '0.62rem', display: 'block' }}>
                    {stage.module}
                  </Typography>
                  {unobservable ? (
                    <Chip
                      size="small"
                      label="no signal"
                      sx={{ mt: 0.5, height: 17, fontSize: '0.6rem', color: observability.degraded, bgcolor: 'transparent', border: `1px solid ${observability.degraded}55` }}
                    />
                  ) : (
                    <Typography sx={{ fontFamily: mono, fontSize: '0.82rem', color: colour, fontWeight: 700 }}>
                      {value}
                    </Typography>
                  )}
                </Box>
              </Tooltip>
              {index < STAGES.length - 1 ? (
                <ChevronRightIcon sx={{ fontSize: 16, color: brand.border, mx: 0.25 }} />
              ) : null}
            </Stack>
          );
        })}
      </Stack>

      <Typography variant="caption" sx={{ display: 'block', mt: 1.25 }}>
        A stage showing <strong>0</strong> was observed and produced nothing. A stage showing{' '}
        <strong>no signal</strong> could not be observed at all — the two are different, and the
        platform never conflates them.
      </Typography>
    </Box>
  );
}
