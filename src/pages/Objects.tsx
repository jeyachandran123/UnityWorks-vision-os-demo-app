/**
 * Objects — one card per tracked object.
 *
 * Every field on a card is a field Vision OS reported. The card adds a friendly
 * label (`Person #3`) and nothing else; the underlying `object_id` is always one
 * hover away, because a demo that showed only the friendly name would be hiding
 * the identifier that makes the claim auditable.
 */

import { useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { usePlatform } from '../api/provider';
import { useVisionState } from '../api/hooks';
import { trackedSeconds } from '../insights/insights';
import {
  ConfidenceBadge,
  CoverageBadge,
  EmptyState,
  Loading,
  Mono,
  SectionTitle,
  Unavailable,
} from '../components/primitives';
import { brand, lifecycleColour, mono, observability } from '../theme/theme';
import type { ObjectView } from '../api/types';

export function Objects() {
  const { sessionId } = usePlatform();
  const state = useVisionState();
  const [inspecting, setInspecting] = useState<ObjectView | null>(null);

  if (!sessionId) return <EmptyState what="active session" note="Start a session to see tracked objects." />;
  if (state.error) return <Unavailable what="Vision State" reason={String(state.error)} />;

  const objects = state.data?.objects ?? [];

  return (
    <Stack spacing={2}>
      <SectionTitle action={<CoverageBadge coverage={state.data?.coverage} />}>
        Tracked objects
      </SectionTitle>

      {state.isLoading && objects.length === 0 ? (
        <Loading label="Reading Vision State" />
      ) : objects.length === 0 ? (
        <EmptyState
          what="objects currently tracked"
          note="Check coverage above before concluding the scene was empty."
        />
      ) : (
        <Box
          sx={{
            display: 'grid',
            gap: 2,
            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          }}
        >
          {objects.map((object, index) => (
            <ObjectCard
              key={object.object_id}
              object={object}
              ordinal={index + 1}
              onInspect={() => setInspecting(object)}
            />
          ))}
        </Box>
      )}

      <Dialog open={Boolean(inspecting)} onClose={() => setInspecting(null)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontSize: '1rem' }}>
          Object detail
          <Typography variant="caption" sx={{ display: 'block', fontFamily: mono }}>
            {inspecting?.object_id}
          </Typography>
        </DialogTitle>
        <DialogContent dividers>
          <Box component="pre" sx={{ fontFamily: mono, fontSize: '0.75rem', whiteSpace: 'pre-wrap', m: 0 }}>
            {JSON.stringify(inspecting, null, 2)}
          </Box>
        </DialogContent>
      </Dialog>
    </Stack>
  );
}

function ObjectCard({
  object,
  ordinal,
  onInspect,
}: {
  object: ObjectView;
  ordinal: number;
  onInspect: () => void;
}) {
  const attributes = Object.values(object.attributes ?? {});
  const seconds = trackedSeconds(object);
  const colour = lifecycleColour(object.lifecycle);
  const friendly = `${object.class_id.charAt(0).toUpperCase()}${object.class_id.slice(1)} #${ordinal}`;

  return (
    <Card sx={{ borderLeft: `3px solid ${colour}` }}>
      <CardContent sx={{ pb: 1.5 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Tooltip title={`Vision OS object_id: ${object.object_id}`} arrow>
            <Typography sx={{ fontWeight: 700, fontSize: '1rem', cursor: 'help' }}>{friendly}</Typography>
          </Tooltip>
          <Box sx={{ flex: 1 }} />
          <Chip
            size="small"
            label={object.lifecycle}
            sx={{ bgcolor: 'transparent', border: `1px solid ${colour}66`, color: colour }}
          />
        </Stack>

        <Stack direction="row" spacing={2} sx={{ mt: 1.25 }}>
          <Field label="Tracked for" value={`${seconds.toFixed(1)}s`} />
          <Field label="Observations" value={String(object.observation_count)} />
          <Field label="Camera" value={object.camera_id} />
        </Stack>

        {object.is_stale ? (
          <Chip
            size="small"
            label="position believed, not measured"
            sx={{ mt: 1, height: 19, fontSize: '0.65rem', color: observability.degraded, bgcolor: 'transparent', border: `1px solid ${observability.degraded}55` }}
          />
        ) : null}

        <Divider sx={{ my: 1.25 }} />

        <Typography variant="caption" sx={{ display: 'block', mb: 0.75 }}>
          Attributes {attributes.length === 0 ? '— none yet' : `(${attributes.length})`}
        </Typography>

        {attributes.length === 0 ? (
          <Typography variant="caption" sx={{ color: brand.textDim, fontStyle: 'italic' }}>
            The model has not been asked about this object yet. Understanding is triggered and
            budgeted — not run on every frame.
          </Typography>
        ) : (
          <Stack spacing={0.75}>
            {attributes.map((attribute) => (
              <Stack key={attribute.key} direction="row" alignItems="center" spacing={1}>
                <Typography variant="caption" sx={{ minWidth: 116, fontFamily: mono, fontSize: '0.68rem' }}>
                  {attribute.key}
                </Typography>
                <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, flex: 1 }}>
                  {String(attribute.value)}
                </Typography>
                <ConfidenceBadge confidence={attribute.confidence} />
              </Stack>
            ))}
          </Stack>
        )}

        <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
          <Button size="small" variant="outlined" onClick={onInspect}>
            Inspect record
          </Button>
          {attributes.some((a) => a.evidence_ref) ? (
            <Tooltip
              arrow
              title="Evidence retrieval is a separately-privileged act and is disabled on this deployment by default."
            >
              <span>
                <Button size="small" disabled>
                  View crop
                </Button>
              </span>
            </Tooltip>
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography variant="caption" sx={{ display: 'block', fontSize: '0.65rem' }}>
        {label}
      </Typography>
      <Mono>{value}</Mono>
    </Box>
  );
}
