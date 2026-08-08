/**
 * The demo's visual identity.
 *
 * Deliberately **not** the Validation Console's instrument-panel dark theme. An
 * audience of stakeholders and customers should feel they are looking at a
 * commercial product, not at somebody's debugger — so this is lighter in weight,
 * more generous with space, and uses colour as brand rather than as diagnostic
 * signal.
 *
 * One thing is carried over unchanged, because it is not a style choice: the
 * **observability palette**. Green means the platform can see, amber means
 * degraded, red means blind, violet means a gap. Those four meanings are
 * Vision OS's, not ours, and a demo that recoloured them for prettiness would be
 * misreporting the platform to the exact audience least able to notice.
 */

import { createTheme, alpha } from '@mui/material/styles';

export const brand = {
  primary: '#4f7cff',
  primaryDim: '#3a5fd9',
  accent: '#00d4b8',
  surface: '#12141c',
  surfaceRaised: '#191c26',
  surfaceHigh: '#212533',
  border: '#2a2f3f',
  text: '#eef1f8',
  textDim: '#98a0b8',
} as const;

/** Vision OS's observability vocabulary. Four meanings, fixed. */
export const observability = {
  observing: '#3ddc84',
  degraded: '#ffb020',
  blind: '#ff5c5c',
  gap: '#b48cff',
  unknown: '#6b7391',
} as const;

export const mono =
  'ui-monospace, "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace';

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: brand.primary },
    secondary: { main: brand.accent },
    success: { main: observability.observing },
    warning: { main: observability.degraded },
    error: { main: observability.blind },
    background: { default: brand.surface, paper: brand.surfaceRaised },
    divider: brand.border,
    text: { primary: brand.text, secondary: brand.textDim },
  },
  typography: {
    fontFamily: '"Inter", "Segoe UI", system-ui, -apple-system, sans-serif',
    h1: { fontSize: '1.6rem', fontWeight: 700, letterSpacing: '-0.02em' },
    h2: { fontSize: '1.15rem', fontWeight: 650, letterSpacing: '-0.01em' },
    h3: { fontSize: '0.82rem', fontWeight: 650, textTransform: 'uppercase', letterSpacing: '0.06em' },
    body2: { fontSize: '0.85rem' },
    caption: { fontSize: '0.75rem', color: brand.textDim },
  },
  shape: { borderRadius: 12 },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { backgroundColor: brand.surface },
        '::-webkit-scrollbar': { width: 9, height: 9 },
        '::-webkit-scrollbar-thumb': { background: brand.border, borderRadius: 6 },
        '::-webkit-scrollbar-track': { background: 'transparent' },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          border: `1px solid ${brand.border}`,
          backgroundColor: brand.surfaceRaised,
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          border: `1px solid ${brand.border}`,
          transition: 'border-color 160ms, transform 160ms',
          '&:hover': { borderColor: alpha(brand.primary, 0.5) },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 600, fontSize: '0.72rem' },
        sizeSmall: { height: 22 },
      },
    },
    MuiButton: {
      styleOverrides: { root: { textTransform: 'none', fontWeight: 600 } },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: { fontSize: '0.75rem', lineHeight: 1.55, maxWidth: 360 },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderColor: brand.border, fontSize: '0.8rem' },
        head: { color: brand.textDim, fontWeight: 650, background: brand.surface },
      },
    },
  },
});

/** Colour for a lifecycle state. Vision OS's vocabulary, not ours. */
export function lifecycleColour(state: string): string {
  switch (state) {
    case 'active':
      return observability.observing;
    case 'provisional':
    case 'occluded':
      return observability.degraded;
    case 'lost':
      return observability.blind;
    default:
      return observability.unknown;
  }
}
