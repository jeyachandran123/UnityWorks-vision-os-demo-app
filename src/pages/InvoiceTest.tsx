/**
 * Invoice Extraction — a check harness, not a product surface.
 *
 * Upload a PDF or image, see the JSON the Document VLM pipeline returned, on
 * this page. It talks to the Atlas backend (proxied at `/atlas`), not to the
 * Vision OS platform, so it works whether or not the platform service is up.
 */

import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Stack,
  Typography,
} from '@mui/material';
import UploadIcon from '@mui/icons-material/FileUploadOutlined';
import { SectionTitle } from '../components/primitives';
import { extractInvoice, type ExtractionAttempt } from '../api/invoiceClient';
import { brand, mono, observability } from '../theme/theme';

export function InvoiceTest() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExtractionAttempt | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function extract() {
    if (!file) return;
    setBusy(true);
    setFailure(null);
    setResult(null);
    try {
      setResult(await extractInvoice(file));
    } catch (error) {
      setFailure(
        error instanceof Error ? error.message : 'Request failed before a response arrived',
      );
    } finally {
      setBusy(false);
    }
  }

  const ok = result?.status === 200;
  const envelope = (result?.body ?? {}) as Record<string, unknown>;
  const error = (envelope.error ?? {}) as Record<string, unknown>;
  const rawExcerpt = typeof error.rawExcerpt === 'string' ? error.rawExcerpt : '';

  return (
    <Box>
      <SectionTitle>Invoice Extraction</SectionTitle>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
        Posts to the Atlas Document Extraction API. Whichever provider{' '}
        <code>DOCUMENT_VLM_PROVIDER</code> selects answers — this page cannot tell which,
        and does not need to.
      </Typography>

      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2 }}>
        <Button component="label" variant="outlined" startIcon={<UploadIcon />}>
          {file ? 'Change file' : 'Choose invoice'}
          <input
            hidden
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.webp,image/*,application/pdf"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setResult(null);
              setFailure(null);
            }}
          />
        </Button>
        <Button variant="contained" disabled={!file || busy} onClick={extract}>
          {busy ? 'Extracting…' : 'Extract'}
        </Button>
        {busy && <CircularProgress size={18} />}
        {file && (
          <Typography variant="caption" sx={{ fontFamily: mono }}>
            {file.name} · {(file.size / 1024).toFixed(0)} KB
          </Typography>
        )}
      </Stack>

      {failure && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {failure} — is the Atlas backend running on port 8000 with APP_DEBUG=true?
        </Alert>
      )}

      {result && (
        <>
          <Stack direction="row" spacing={1} sx={{ mb: 1.5 }} flexWrap="wrap" useFlexGap>
            <Chip
              size="small"
              label={`HTTP ${result.status}`}
              sx={{
                bgcolor: ok ? observability.observing : observability.blind,
                color: '#0b0d13',
              }}
            />
            {typeof envelope.provider === 'string' && envelope.provider && (
              <Chip size="small" label={`provider: ${envelope.provider}`} />
            )}
            {typeof envelope.model === 'string' && envelope.model && (
              <Chip size="small" label={`model: ${envelope.model}`} />
            )}
            {typeof envelope.processingTime === 'number' && (
              <Chip size="small" label={`${Math.round(envelope.processingTime)} ms server`} />
            )}
            <Chip size="small" variant="outlined" label={`${Math.round(result.elapsedMs)} ms round trip`} />
          </Stack>

          {Array.isArray(envelope.warnings) && envelope.warnings.length > 0 && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              {(envelope.warnings as string[]).map((warning) => (
                <div key={warning}>{warning}</div>
              ))}
            </Alert>
          )}

          {rawExcerpt && (
            <>
              <Typography variant="h3" sx={{ mb: 1 }}>
                What the model actually said
              </Typography>
              <Box
                component="pre"
                sx={{
                  m: 0,
                  mb: 2,
                  p: 2,
                  maxHeight: '30vh',
                  overflow: 'auto',
                  fontFamily: mono,
                  fontSize: '0.75rem',
                  lineHeight: 1.6,
                  bgcolor: brand.surface,
                  border: `1px solid ${observability.degraded}`,
                  borderRadius: 1.5,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {rawExcerpt}
              </Box>
            </>
          )}

          <Box
            component="pre"
            sx={{
              m: 0,
              p: 2,
              maxHeight: '60vh',
              overflow: 'auto',
              fontFamily: mono,
              fontSize: '0.78rem',
              lineHeight: 1.6,
              bgcolor: brand.surfaceRaised,
              border: `1px solid ${brand.border}`,
              borderRadius: 1.5,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {typeof result.body === 'string'
              ? result.body
              : JSON.stringify(result.body, null, 2)}
          </Box>
        </>
      )}
    </Box>
  );
}
