/**
 * Presentation primitives for the demo.
 *
 * Two carry real weight and should be read before use:
 *
 * - `Unavailable` vs `EmptyState` — "we could not look" and "nothing was there"
 *   never render the same. That is V8, and it is the one piece of Validation
 *   Console discipline that must survive into a customer-facing product.
 * - `Provenance` — every number on a commercial dashboard invites the question
 *   *"says who?"*. This answers it inline.
 */

import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  LinearProgress,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import type { ReactNode } from 'react';
import type { Confidence, CoverageSummary } from '../api/types';
import { brand, mono, observability } from '../theme/theme';

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
      <Typography variant="h2">{children}</Typography>
      <Box sx={{ flex: 1 }} />
      {action}
    </Stack>
  );
}

export function MetricCard({
  label,
  value,
  unit,
  hint,
  tone = 'default',
  sub,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: string;
  tone?: 'default' | 'good' | 'warn' | 'bad';
  sub?: ReactNode;
}) {
  const colour = {
    default: brand.text,
    good: observability.observing,
    warn: observability.degraded,
    bad: observability.blind,
  }[tone];

  const card = (
    <Card sx={{ minWidth: 156, flex: '1 1 156px' }}>
      <CardContent sx={{ py: 1.75, '&:last-child': { pb: 1.75 } }}>
        <Stack direction="row" alignItems="center" spacing={0.5}>
          <Typography variant="caption" sx={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {label}
          </Typography>
          {hint ? <InfoOutlinedIcon sx={{ fontSize: 13, color: brand.textDim }} /> : null}
        </Stack>
        <Typography sx={{ fontSize: '1.7rem', fontWeight: 700, color: colour, lineHeight: 1.25, fontFamily: mono }}>
          {value}
          {unit ? (
            <Typography component="span" sx={{ fontSize: '0.85rem', ml: 0.5, color: brand.textDim }}>
              {unit}
            </Typography>
          ) : null}
        </Typography>
        {sub ? <Box sx={{ mt: 0.5 }}>{sub}</Box> : null}
      </CardContent>
    </Card>
  );

  return hint ? (
    <Tooltip title={hint} arrow>
      {card}
    </Tooltip>
  ) : (
    card
  );
}

/** The platform could not be asked, or could not answer. Conclude nothing. */
export function Unavailable({ what, reason }: { what: string; reason?: string | null }) {
  return (
    <Alert severity="warning" variant="outlined" sx={{ borderColor: observability.degraded }}>
      <strong>{what} unavailable.</strong> {reason ?? 'No reason was supplied.'}
      <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
        This is not an empty result — nothing may be concluded from it.
      </Typography>
    </Alert>
  );
}

/** The platform looked and found nothing. A complete answer. */
export function EmptyState({ what, note }: { what: string; note?: string }) {
  return (
    <Box sx={{ py: 5, textAlign: 'center' }}>
      <Typography variant="body2" color="text.secondary">
        No {what}.
      </Typography>
      {note ? (
        <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
          {note}
        </Typography>
      ) : null}
    </Box>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <Stack alignItems="center" spacing={1.5} sx={{ py: 5 }}>
      <CircularProgress size={22} />
      <Typography variant="caption">{label}</Typography>
    </Stack>
  );
}

/**
 * Confidence, with calibration state always visible.
 *
 * An uncalibrated score is not comparable across models (02_VOM §7.2). A
 * commercial dashboard that rendered `0.80` as a clean "80%" would invite
 * exactly the cross-model comparison the platform refuses to support, so the
 * qualifier is part of the value rather than a footnote.
 */
export function ConfidenceBadge({ confidence }: { confidence?: Confidence | null }) {
  if (!confidence) return <Chip size="small" label="no confidence" variant="outlined" />;
  const pct = `${(confidence.value * 100).toFixed(0)}%`;
  return (
    <Tooltip
      arrow
      title={
        confidence.calibrated
          ? 'Calibrated — comparable across models.'
          : 'Self-reported by the model and uncalibrated. Not comparable across models, and not a probability.'
      }
    >
      <Chip
        size="small"
        label={confidence.calibrated ? pct : `${pct} uncal.`}
        sx={{
          bgcolor: 'transparent',
          border: `1px solid ${confidence.calibrated ? observability.observing : observability.degraded}`,
          color: confidence.calibrated ? observability.observing : observability.degraded,
        }}
      />
    </Tooltip>
  );
}

/** Coverage accompanies every state answer, so it accompanies every state view. */
export function CoverageBadge({ coverage }: { coverage?: CoverageSummary }) {
  if (!coverage) {
    return (
      <Tooltip arrow title="This result arrived without coverage. The platform returns it unconditionally, so its absence is a contract violation.">
        <Chip size="small" label="COVERAGE MISSING" sx={{ bgcolor: observability.blind, color: '#fff' }} />
      </Tooltip>
    );
  }
  const fraction = coverage.observable_fraction;
  const full = fraction >= 1 && coverage.unavailable.length === 0;
  const colour = full ? observability.observing : fraction > 0 ? observability.degraded : observability.blind;
  return (
    <Tooltip
      arrow
      title={`observing ${coverage.cameras_observing} · degraded ${coverage.cameras_degraded} · blind ${coverage.cameras_blind}. An empty result below full coverage does not mean nothing happened — it means nothing was observed.`}
    >
      <Chip
        size="small"
        icon={<Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: colour, ml: 1 }} />}
        label={`Coverage ${(fraction * 100).toFixed(0)}%`}
        sx={{ bgcolor: 'transparent', border: `1px solid ${colour}55`, color: brand.text }}
      />
    </Tooltip>
  );
}

/** Inline answer to "says who?" — the field and module a value came from. */
export function Provenance({ source }: { source: string }) {
  return (
    <Tooltip arrow title={`Reported by Vision OS: ${source}`}>
      <Typography
        variant="caption"
        sx={{ fontFamily: mono, color: brand.textDim, cursor: 'help', fontSize: '0.68rem' }}
      >
        ⟵ {source}
      </Typography>
    </Tooltip>
  );
}

export function Mono({ children, colour }: { children: ReactNode; colour?: string }) {
  return (
    <Box component="span" sx={{ fontFamily: mono, fontSize: '0.78rem', color: colour }}>
      {children}
    </Box>
  );
}

export function Meter({ value, max, tone = 'default' }: { value: number; max: number; tone?: 'default' | 'good' | 'warn' }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const colour = tone === 'good' ? observability.observing : tone === 'warn' ? observability.degraded : brand.primary;
  return (
    <LinearProgress
      variant="determinate"
      value={pct}
      sx={{
        height: 6,
        borderRadius: 3,
        bgcolor: brand.surfaceHigh,
        '& .MuiLinearProgress-bar': { bgcolor: colour, borderRadius: 3 },
      }}
    />
  );
}

export function relativeSeconds(ns: number, originNs: number): string {
  const seconds = (ns - originNs) / 1_000_000_000;
  if (!Number.isFinite(seconds)) return '—';
  const abs = Math.abs(seconds);
  if (abs < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(abs / 60);
  return `${minutes}m ${(abs % 60).toFixed(0)}s`;
}
