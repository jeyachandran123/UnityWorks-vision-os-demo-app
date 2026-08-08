/**
 * Evidence — the justification behind an attribute.
 *
 * Evidence access is a **separately privileged act**: reading "a person was
 * here" and viewing their image are categorically different, and the platform
 * authorises them apart. This deployment disables it by default, and this page
 * says so rather than showing an empty gallery.
 *
 * The evidence reference is always shown even when the crop cannot be read.
 * Knowing an explanation exists is not the same as reading it, and hiding the
 * reference would make V4 look unavailable rather than unauthorised.
 */

import { useMemo, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Chip, Stack, TextField, Typography } from '@mui/material';
import { usePlatform } from '../api/provider';
import { useHealth, useVisionState } from '../api/hooks';
import { EmptyState, Mono, SectionTitle } from '../components/primitives';
import { brand, mono } from '../theme/theme';

interface EvidenceRow {
  ref: string;
  objectId: string;
  attribute: string;
  value: string;
  observedAtNs: number;
  camera: string;
  confidence: number;
  calibrated: boolean;
}

export function Evidence() {
  const { client, sessionId } = usePlatform();
  const health = useHealth();
  const state = useVisionState();
  const [purpose, setPurpose] = useState('');
  const [opened, setOpened] = useState<{ row: EvidenceRow; body: unknown } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const rows = useMemo<EvidenceRow[]>(() => {
    const out: EvidenceRow[] = [];
    for (const object of state.data?.objects ?? []) {
      for (const attribute of Object.values(object.attributes ?? {})) {
        if (!attribute.evidence_ref) continue;
        out.push({
          ref: attribute.evidence_ref,
          objectId: object.object_id,
          attribute: attribute.key,
          value: String(attribute.value),
          observedAtNs: attribute.observed_at_ns,
          camera: object.camera_id,
          confidence: attribute.confidence.value,
          calibrated: attribute.confidence.calibrated,
        });
      }
    }
    return out;
  }, [state.data]);

  if (!sessionId) return <EmptyState what="active session" />;

  const allowed = health.data?.harness.allow_evidence ?? false;

  const open = async (row: EvidenceRow) => {
    setFailure(null);
    try {
      const body = await client.getEvidence(row.ref, purpose.trim(), sessionId);
      setOpened({ row, body });
    } catch (error) {
      setFailure(String(error));
    }
  };

  return (
    <Stack spacing={2}>
      <SectionTitle>Evidence</SectionTitle>

      {!allowed ? (
        <Alert severity="info" variant="outlined">
          <strong>Evidence retrieval is disabled on this deployment.</strong> Viewing imagery is
          authorised separately from reading observations — most consumers need the second and must
          never have the first. The references below are still shown, because knowing an
          explanation exists is not the same as reading it.
        </Alert>
      ) : (
        <Stack direction="row" spacing={1}>
          <TextField
            size="small"
            label="Purpose — recorded with your identity"
            value={purpose}
            onChange={(event) => setPurpose(event.target.value)}
            sx={{ flex: 1, maxWidth: 460 }}
            helperText="Required. This converts imagery access from an invisible act into an attributable one."
          />
        </Stack>
      )}

      {failure ? (
        <Alert severity="error" variant="outlined">
          {failure}
        </Alert>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          what="evidence references yet"
          note="An evidence reference is minted when the platform stores the crop behind an attribute."
        />
      ) : (
        <Stack spacing={1.25}>
          {rows.map((row) => (
            <Card key={`${row.ref}:${row.attribute}`}>
              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Box sx={{ minWidth: 190 }}>
                    <Typography variant="caption" sx={{ display: 'block', fontSize: '0.64rem' }}>
                      Evidence ID
                    </Typography>
                    <Mono>{row.ref}</Mono>
                  </Box>
                  <Field label="Attribute" value={`${row.attribute} = ${row.value}`} />
                  <Field label="Object" value={row.objectId.slice(-10)} />
                  <Field label="Camera" value={row.camera} />
                  <Field label="Capture" value={`+${(row.observedAtNs / 1e6).toFixed(0)} ms`} />
                  <Chip
                    size="small"
                    variant="outlined"
                    label={`${(row.confidence * 100).toFixed(0)}%${row.calibrated ? '' : ' uncal.'}`}
                  />
                  <Box sx={{ flex: 1 }} />
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={!allowed || !purpose.trim()}
                    onClick={() => open(row)}
                  >
                    View crop
                  </Button>
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      {opened ? (
        <Card>
          <CardContent>
            <SectionTitle>Retrieved evidence — {opened.row.ref}</SectionTitle>
            <Box component="pre" sx={{ m: 0, fontFamily: mono, fontSize: '0.72rem', whiteSpace: 'pre-wrap', color: brand.textDim }}>
              {JSON.stringify(opened.body, null, 2)}
            </Box>
          </CardContent>
        </Card>
      ) : null}
    </Stack>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography variant="caption" sx={{ display: 'block', fontSize: '0.64rem' }}>
        {label}
      </Typography>
      <Mono>{value}</Mono>
    </Box>
  );
}
