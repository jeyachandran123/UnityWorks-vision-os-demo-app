/**
 * Observations — the live feed, in three lenses.
 *
 * Narrative is the default here, unlike the engineering console: this audience
 * reads sentences. Raw JSON stays one click away and the header says which is
 * authoritative, because a prose view that could not be checked against the
 * record would be a story rather than a report.
 */

import { useMemo, useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Chip,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { usePlatform, useChannel } from '../api/provider';
import { renderObservation } from '../narrative/render';
import { EmptyState, Mono, SectionTitle } from '../components/primitives';
import { brand, mono, observability } from '../theme/theme';
import type { Observation, TapMessage } from '../api/types';

type Lens = 'narrative' | 'structured' | 'json';

export function Observations() {
  const { sessionId } = usePlatform();
  const messages = useChannel('observation');
  const [lens, setLens] = useState<Lens>('narrative');

  const observations = useMemo(
    () => messages.filter((m) => m.type === 'observation').slice(-120).reverse(),
    [messages],
  );

  if (!sessionId) return <EmptyState what="active session" />;

  return (
    <Stack spacing={2}>
      <SectionTitle
        action={
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Typography variant="caption">
              The same record, three ways. If they disagree, the JSON is right.
            </Typography>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={lens}
              onChange={(_, value: Lens | null) => value && setLens(value)}
            >
              <ToggleButton value="narrative">Narrative</ToggleButton>
              <ToggleButton value="structured">Structured</ToggleButton>
              <ToggleButton value="json">Raw JSON</ToggleButton>
            </ToggleButtonGroup>
          </Stack>
        }
      >
        Observation feed
      </SectionTitle>

      {observations.length === 0 ? (
        <EmptyState
          what="observations yet"
          note="Observations are suppressed when nothing changed — a 10–50× reduction is the designed behaviour, not a fault."
        />
      ) : (
        <Stack spacing={1.25}>
          {observations.map((message) => (
            <ObservationRow key={message.seq} message={message} lens={lens} />
          ))}
        </Stack>
      )}
    </Stack>
  );
}

function ObservationRow({ message, lens }: { message: TapMessage; lens: Lens }) {
  const observation = message.payload as unknown as Observation;
  const narrative = useMemo(() => renderObservation(observation), [observation]);

  return (
    <Card>
      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
          <Chip size="small" label={observation.observation_type} sx={{ bgcolor: brand.surfaceHigh }} />
          {observation.class_id ? <Chip size="small" variant="outlined" label={observation.class_id} /> : null}
          <Box sx={{ flex: 1 }} />
          <Tooltip title="Every observation carries provenance — V4 makes an unexplainable observation worse than none." arrow>
            <Chip
              size="small"
              label={observation.provenance ? 'traceable' : 'NO PROVENANCE'}
              sx={{
                bgcolor: 'transparent',
                border: `1px solid ${observation.provenance ? observability.observing : observability.blind}`,
                color: observation.provenance ? observability.observing : observability.blind,
              }}
            />
          </Tooltip>
        </Stack>

        {lens === 'narrative' ? (
          <>
            <Typography sx={{ fontSize: '0.92rem', lineHeight: 1.7 }}>{narrative.sentence}</Typography>
            {narrative.caveats.length > 0 ? (
              <Stack spacing={0.35} sx={{ mt: 1 }}>
                {narrative.caveats.map((caveat) => (
                  <Typography
                    key={caveat}
                    variant="caption"
                    sx={{ pl: 1, borderLeft: `2px solid ${observability.degraded}` }}
                  >
                    {caveat}
                  </Typography>
                ))}
              </Stack>
            ) : null}
            <Typography variant="caption" sx={{ display: 'block', mt: 0.75, fontStyle: 'italic' }}>
              {narrative.clauses.length} clauses, each traced to a field
              {narrative.unrenderedFields.length
                ? ` · not spoken: ${narrative.unrenderedFields.join(', ')}`
                : ''}
            </Typography>
          </>
        ) : lens === 'structured' ? (
          <Stack spacing={0.4}>
            {Object.entries(observation)
              .filter(([, value]) => value !== null && value !== undefined)
              .map(([key, value]) => (
                <Stack key={key} direction="row" spacing={1.5}>
                  <Typography variant="caption" sx={{ minWidth: 150, fontFamily: mono, fontSize: '0.68rem' }}>
                    {key}
                  </Typography>
                  <Mono>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</Mono>
                </Stack>
              ))}
          </Stack>
        ) : (
          <Box
            component="pre"
            sx={{ m: 0, fontFamily: mono, fontSize: '0.72rem', whiteSpace: 'pre-wrap', color: brand.textDim }}
          >
            {JSON.stringify(observation, null, 2)}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
