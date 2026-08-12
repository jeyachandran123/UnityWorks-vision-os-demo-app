import { useState } from 'react';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { theme } from './theme/theme';
import { PlatformProvider } from './api/provider';
import { Shell, type PageId } from './layout/Shell';
import { LiveSummary } from './pages/LiveSummary';
import { FrameByFrame } from './pages/FrameByFrame';
import { Dashboard } from './pages/Dashboard';
import { LiveCameras } from './pages/LiveCameras';
import { Objects } from './pages/Objects';
import { Observations } from './pages/Observations';
import { VisionState } from './pages/VisionState';
import { Timeline } from './pages/Timeline';
import { Evidence } from './pages/Evidence';
import { Performance } from './pages/Performance';
import { ModelPage } from './pages/ModelPage';
import { InvoiceTest } from './pages/InvoiceTest';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Never show a cached answer as if it were live: Vision State is a
      // projection and legitimately changes between frames.
      staleTime: 0,
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

function Router({ page }: { page: PageId }) {
  switch (page) {
    case 'summary':
      return <LiveSummary />;
    case 'frames':
      return <FrameByFrame />;
    case 'cameras':
      return <LiveCameras />;
    case 'objects':
      return <Objects />;
    case 'observations':
      return <Observations />;
    case 'state':
      return <VisionState />;
    case 'timeline':
      return <Timeline />;
    case 'evidence':
      return <Evidence />;
    case 'performance':
      return <Performance />;
    case 'model':
      return <ModelPage />;
    case 'invoice':
      return <InvoiceTest />;
    default:
      return <Dashboard />;
  }
}

export default function App() {
  // Opens on the plain-language summary rather than the Dashboard: the first
  // screen anyone sees should be readable by whoever is being shown the
  // product, and the engineering views are one click away for the people who
  // want them.
  //
  // `#invoice` opens the extraction check directly, so it is reachable without
  // the Vision OS platform service running behind the dashboard.
  const [page, setPage] = useState<PageId>(
    window.location.hash === '#invoice' ? 'invoice' : 'summary',
  );

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <QueryClientProvider client={queryClient}>
        <PlatformProvider>
          <Shell page={page} onNavigate={setPage}>
            <Router page={page} />
          </Shell>
        </PlatformProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
