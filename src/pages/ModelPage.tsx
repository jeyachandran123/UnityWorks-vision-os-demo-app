/**
 * Model — transparency about what is actually answering.
 *
 * The panel reads the **bound adapter**, never configuration. If Qwen is
 * unavailable and the platform fell back to a constant, this page says so in the
 * largest text on the screen. A demo that displayed "Qwen Vision" while a static
 * head answered would be the single most dishonest thing this product could do.
 */

import { Alert, Box, Card, CardContent, Chip, Divider, Stack, Tooltip, Typography } from '@mui/material';
import { useEconomy, useModel } from '../api/hooks';
import { usePlatform } from '../api/provider';
import { EmptyState, MetricCard, Mono, SectionTitle, Unavailable } from '../components/primitives';
import { brand, mono, observability } from '../theme/theme';

export function ModelPage() {
  const { sessionId } = usePlatform();
  const model = useModel();
  const economy = useEconomy();

  if (!sessionId) return <EmptyState what="active session" />;
  if (model.data?.available === false) return <Unavailable what="Model panel" reason={model.data.reason} />;

  const data = model.data;
  const inference = data?.inference;
  // `understander.*` is a model adapter; `attr.*` is a constant-answer head.
  // Comparing against a single model id made every provider except one look
  // like a fallback.
  const isRealModel = Boolean(data?.adapter_id?.startsWith('understander.'));
  const capabilities = (data?.capabilities ?? {}) as Record<string, unknown>;

  return (
    <Stack spacing={2.5}>
      <SectionTitle>Understanding model</SectionTitle>

      {!isRealModel ? (
        <Alert severity="warning" variant="outlined">
          <strong>A vision model is not answering.</strong> The bound adapter is{' '}
          <Mono>{data?.adapter_id}</Mono>. {data?.binding_note}. Attributes shown elsewhere in this
          application are constants, not model output.
        </Alert>
      ) : null}

      <Card sx={{ borderColor: isRealModel ? `${observability.observing}55` : brand.border }}>
        <CardContent>
          <Stack direction="row" spacing={2} alignItems="center">
            <Box>
              <Typography variant="caption">Bound adapter (P15)</Typography>
              <Typography sx={{ fontSize: '1.25rem', fontWeight: 700, fontFamily: mono }}>
                {data?.adapter_id ?? '—'}
              </Typography>
              <Typography variant="caption">{data?.runtime?.model ?? 'unknown model'}</Typography>
            </Box>
            <Box sx={{ flex: 1 }} />
            <Stack spacing={0.75} alignItems="flex-end">
              <Chip
                size="small"
                label={String(capabilities.data_residency ?? 'unknown residency')}
                sx={{
                  bgcolor: 'transparent',
                  border: `1px solid ${observability.observing}66`,
                  color: observability.observing,
                }}
              />
              <Tooltip
                arrow
                title="A remote adapter is refused at binding time by a site with a residency policy — never discovered later in an audit."
              >
                <Typography variant="caption">
                  {data?.runtime?.endpoint ?? 'in-process'}
                </Typography>
              </Tooltip>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
        <MetricCard label="Requests" value={inference?.requests ?? 0} />
        <MetricCard label="Succeeded" value={inference?.succeeded ?? 0} tone="good" />
        <MetricCard
          label="Refused"
          value={inference?.refused ?? 0}
          tone={(inference?.refused ?? 0) > 0 ? 'warn' : 'default'}
          hint="An explicit refusal, recorded as evidence. The adapter never fabricates a plausible answer on failure."
        />
        <MetricCard
          label="Unparseable"
          value={inference?.unparseable ?? 0}
          tone={(inference?.unparseable ?? 0) > 0 ? 'warn' : 'default'}
          hint="Model output that did not parse. Preserved verbatim as evidence rather than discarded."
        />
        <MetricCard
          label="Latency p50"
          value={((inference?.p50_latency_ms ?? 0) / 1000).toFixed(1)}
          unit="s"
        />
        <MetricCard
          label="Latency p95"
          value={((inference?.p95_latency_ms ?? 0) / 1000).toFixed(1)}
          unit="s"
        />
        <MetricCard
          label="Cold start"
          value={((data?.cold_start_ms ?? 0) / 1000).toFixed(0)}
          unit="s"
          hint="One-off model load, measured separately and excluded from the percentiles so steady-state performance is not misreported."
        />
      </Stack>

      <Card>
        <CardContent>
          <SectionTitle>Perceptual economy</SectionTitle>
          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
            <MetricCard label="Naive calls" value={economy.data?.naive_model_calls ?? 0} tone="bad" />
            <MetricCard label="Actual calls" value={economy.data?.actual_model_calls ?? 0} tone="good" />
            <MetricCard
              label="Binding-time"
              value={economy.data?.binding_time_calls ?? 0}
              hint="Conformance-gate probes made when the adapter was bound. Validation, not video analysis — excluded from the economy figure."
            />
            <MetricCard label="Avoided" value={economy.data?.calls_avoided ?? 0} tone="good" />
          </Stack>
          <Divider sx={{ my: 2 }} />
          <Typography variant="caption">{economy.data?.note}</Typography>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <SectionTitle>Declared capabilities</SectionTitle>
          <Box component="pre" sx={{ m: 0, fontFamily: mono, fontSize: '0.72rem', whiteSpace: 'pre-wrap', color: brand.textDim }}>
            {JSON.stringify(capabilities, null, 2)}
          </Box>
          <Typography variant="caption" sx={{ display: 'block', mt: 1 }}>
            <Mono>producible_attributes</Mono> is what makes a capability gap visible rather than
            being discovered by a consumer waiting for an attribute that will never arrive.
          </Typography>
        </CardContent>
      </Card>

      {(data?.warnings ?? []).length > 0 ? (
        <Card>
          <CardContent>
            <SectionTitle>Binding notes</SectionTitle>
            <Stack spacing={0.5}>
              {data!.warnings.map((warning) => (
                <Typography key={warning} variant="caption" sx={{ fontFamily: mono }}>
                  · {warning}
                </Typography>
              ))}
            </Stack>
          </CardContent>
        </Card>
      ) : null}
    </Stack>
  );
}
