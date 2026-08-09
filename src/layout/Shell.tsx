/**
 * The product shell: sidebar, header, session control.
 *
 * Reads as a commercial platform rather than a debugger. One piece of
 * engineering honesty is kept in the chrome permanently, because removing it
 * would misrepresent the product: the header states the bound model and whether
 * the platform can currently see. A demo that hid a degraded platform behind a
 * confident dashboard would be selling something that does not exist.
 */

import { useRef, useState } from 'react';
import {
  Alert,
  AppBar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Stack,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material';
import SummarizeIcon from '@mui/icons-material/AutoAwesomeOutlined';
import NarrationIcon from '@mui/icons-material/SubtitlesOutlined';
import DashboardIcon from '@mui/icons-material/SpaceDashboardOutlined';
import VideocamIcon from '@mui/icons-material/VideocamOutlined';
import PeopleIcon from '@mui/icons-material/GroupsOutlined';
import FeedIcon from '@mui/icons-material/ArticleOutlined';
import LayersIcon from '@mui/icons-material/LayersOutlined';
import TimelineIcon from '@mui/icons-material/TimelineOutlined';
import ImageIcon from '@mui/icons-material/ImageSearchOutlined';
import SpeedIcon from '@mui/icons-material/SpeedOutlined';
import MemoryIcon from '@mui/icons-material/MemoryOutlined';
import UploadIcon from '@mui/icons-material/FileUploadOutlined';
import PlayIcon from '@mui/icons-material/PlayArrowRounded';
import PauseIcon from '@mui/icons-material/PauseRounded';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePlatform } from '../api/provider';
import { useHealth, useModel } from '../api/hooks';
import { isUnreachable } from '../api/client';
import { brand, mono, observability } from '../theme/theme';

export type PageId =
  | 'summary'
  | 'narration'
  | 'dashboard'
  | 'cameras'
  | 'objects'
  | 'observations'
  | 'state'
  | 'timeline'
  | 'evidence'
  | 'performance'
  | 'model'
  | 'invoice';

export const PAGES: Array<{ id: PageId; label: string; icon: JSX.Element; group: string }> = [
  // First, and in its own group. Everything below it answers an engineer's
  // question; this one answers "what is happening?" for whoever is being shown
  // the product.
  { id: 'summary', label: 'Live Summary', icon: <SummarizeIcon />, group: 'What is happening' },
  { id: 'narration', label: 'Frame by Frame', icon: <NarrationIcon />, group: 'What is happening' },
  { id: 'dashboard', label: 'Dashboard', icon: <DashboardIcon />, group: 'Overview' },
  { id: 'cameras', label: 'Live Cameras', icon: <VideocamIcon />, group: 'Overview' },
  { id: 'objects', label: 'Objects', icon: <PeopleIcon />, group: 'Perception' },
  { id: 'observations', label: 'Observations', icon: <FeedIcon />, group: 'Perception' },
  { id: 'state', label: 'Vision State', icon: <LayersIcon />, group: 'Perception' },
  { id: 'timeline', label: 'Timeline', icon: <TimelineIcon />, group: 'Perception' },
  { id: 'evidence', label: 'Evidence', icon: <ImageIcon />, group: 'Assurance' },
  { id: 'performance', label: 'Performance', icon: <SpeedIcon />, group: 'Assurance' },
  { id: 'model', label: 'Model', icon: <MemoryIcon />, group: 'Assurance' },
  { id: 'invoice', label: 'Invoice Extraction', icon: <UploadIcon />, group: 'Documents' },
];

const SIDEBAR = 232;

export function Shell({
  page,
  onNavigate,
  children,
}: {
  page: PageId;
  onNavigate: (page: PageId) => void;
  children: React.ReactNode;
}) {
  const { sessionId, session, streamStatus } = usePlatform();
  // The shared hooks rather than private copies of them. These were declared
  // again here with their own intervals — same cache keys, different schedules,
  // so the shell quietly set the polling rate for the whole application and
  // tuning it in one place had no effect.
  const health = useHealth();
  const model = useModel();

  const groups = Array.from(new Set(PAGES.map((p) => p.group)));

  // The invoice page talks to the Atlas backend, not to Vision OS, so it stays
  // usable when the platform service is not running — which is the normal case
  // when someone is only checking document extraction.
  //
  // Two consecutive failures, not one. This replaces the entire application
  // with a full-screen notice, and doing that on a single missed poll meant one
  // hiccup blanked the screen and the next poll five seconds later brought it
  // back — the most violent flicker in the product, and the one that made
  // everything else look broken. A platform that is genuinely down fails every
  // poll and still trips this within about ten seconds.
  const platformDown =
    isUnreachable(health.error) && (health.data === undefined || health.failureCount >= 2);
  if (platformDown && page !== 'invoice') {
    return <PlatformDown />;
  }

  return (
    <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Drawer
        variant="permanent"
        sx={{
          width: SIDEBAR,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: SIDEBAR,
            boxSizing: 'border-box',
            bgcolor: brand.surface,
            borderRight: `1px solid ${brand.border}`,
          },
        }}
      >
        <Box sx={{ px: 2, py: 2.25 }}>
          <Typography sx={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '-0.02em' }}>
            UnityWorks
          </Typography>
          <Typography variant="caption" sx={{ color: brand.primary, fontWeight: 700, letterSpacing: '0.1em' }}>
            VISION OS
          </Typography>
        </Box>

        {groups.map((group) => (
          <Box key={group} sx={{ mb: 0.5 }}>
            <Typography
              variant="caption"
              sx={{ px: 2, py: 0.5, display: 'block', textTransform: 'uppercase', letterSpacing: '0.09em', fontSize: '0.63rem' }}
            >
              {group}
            </Typography>
            <List dense disablePadding>
              {PAGES.filter((p) => p.group === group).map((entry) => (
                <ListItemButton
                  key={entry.id}
                  selected={page === entry.id}
                  onClick={() => onNavigate(entry.id)}
                  sx={{
                    mx: 1,
                    borderRadius: 2,
                    mb: 0.25,
                    '&.Mui-selected': {
                      bgcolor: `${brand.primary}22`,
                      '&:hover': { bgcolor: `${brand.primary}33` },
                    },
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 34, color: page === entry.id ? brand.primary : brand.textDim }}>
                    {entry.icon}
                  </ListItemIcon>
                  <ListItemText
                    primary={entry.label}
                    primaryTypographyProps={{
                      fontSize: '0.85rem',
                      fontWeight: page === entry.id ? 650 : 500,
                      color: page === entry.id ? brand.text : brand.textDim,
                    }}
                  />
                </ListItemButton>
              ))}
            </List>
          </Box>
        ))}

        <Box sx={{ flex: 1 }} />
        <Box sx={{ p: 1.5, borderTop: `1px solid ${brand.border}` }}>
          <Typography variant="caption" sx={{ display: 'block', fontFamily: mono, fontSize: '0.65rem' }}>
            model
          </Typography>
          <Typography sx={{ fontFamily: mono, fontSize: '0.72rem', color: brand.text }}>
            {model.data?.adapter_id ?? '—'}
          </Typography>
          <Typography variant="caption" sx={{ fontSize: '0.62rem' }}>
            {model.data?.runtime?.model ?? 'not bound'}
          </Typography>
        </Box>
      </Drawer>

      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <AppBar position="static" elevation={0} sx={{ bgcolor: brand.surface, borderBottom: `1px solid ${brand.border}` }}>
          <Toolbar variant="dense" sx={{ gap: 1.5, minHeight: 56 }}>
            <Typography variant="h2">{PAGES.find((p) => p.id === page)?.label}</Typography>
            <Box sx={{ flex: 1 }} />
            <SessionControl />
            <Chip
              size="small"
              label={streamStatus === 'open' ? 'live' : streamStatus}
              sx={{
                bgcolor: 'transparent',
                border: `1px solid ${streamStatus === 'open' ? observability.observing : observability.degraded}`,
                color: streamStatus === 'open' ? observability.observing : observability.degraded,
              }}
            />
            {session ? (
              <Chip size="small" variant="outlined" label={`frame ${session.frame_index}/${session.frame_count}`} />
            ) : null}
            {/* A stopped session produces genuine zeros everywhere. Saying so in
                the chrome is cheaper than letting an operator read a still
                dashboard as a broken one. */}
            {session && !session.playing ? (
              <Tooltip arrow title="The video is not advancing. Every figure on screen is a true zero, not a measurement.">
                <Chip
                  size="small"
                  label={session.state === 'ready' ? 'not started' : session.state}
                  sx={{
                    bgcolor: 'transparent',
                    border: `1px solid ${observability.degraded}`,
                    color: observability.degraded,
                  }}
                />
              </Tooltip>
            ) : null}
          </Toolbar>
        </AppBar>

        {model.data && model.data.adapter_id !== 'understander.qwen_vl' && sessionId ? (
          <Alert severity="warning" variant="outlined" square sx={{ borderLeft: 'none', borderRight: 'none' }}>
            <strong>Attributes are not coming from a vision model.</strong> The bound adapter is{' '}
            <Mono>{model.data.adapter_id}</Mono> — {model.data.binding_note}
          </Alert>
        ) : null}

        <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: 2.5 }}>{children}</Box>
      </Box>
    </Box>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return <Box component="span" sx={{ fontFamily: mono }}>{children}</Box>;
}

/** Media picker + play/pause. Everything a demo operator touches. */
function SessionControl() {
  const { client, sessionId, setSessionId, session } = usePlatform();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [mediaId, setMediaId] = useState('');

  const media = useQuery({ queryKey: ['media'], queryFn: () => client.listMedia(), retry: false });
  const assets = media.data?.media ?? [];
  // Default to real footage, not the synthetic target.
  //
  // The synthetic source is first in the library and was therefore what the
  // picker chose for anyone who pressed Start without opening the dropdown. It
  // is a 96×96 generated pattern built to exercise the pipeline deterministically
  // — invaluable for a contract test, and the least persuasive thing in the
  // building to put in front of someone asking what the product does.
  const selected =
    mediaId ||
    assets.find((a) => a.usable && a.kind === 'video_file')?.media_id ||
    assets.find((a) => a.usable)?.media_id ||
    '';

  const open = useMutation({
    mutationFn: async () => {
      // Close every open session, not merely the one this page knows about.
      //
      // Sessions outlive the browser. A reload — or Vite pushing an update
      // during development — resets `sessionId` to null while the session it
      // named keeps running on the harness, and the next Start then strands it.
      // Each stranded session holds its own booted platform and goes on asking
      // the one model instance, so the new session queues behind every ghost
      // until nothing can boot at all. That arrives on screen as a summary that
      // never fills in, indistinguishable from a broken product.
      //
      // This application shows one camera at a time, so "one session" is a
      // truth it can simply enforce.
      //
      // Waited on rather than fired and forgotten, because the teardown is the
      // point: the new session should boot into a machine the old ones have
      // already let go of. The platform answers only once an instance is down,
      // which on a loaded box outlasts a minute — so the wait is bounded and
      // Start proceeds either way.
      const open = await client.listSessions().catch(() => ({ sessions: [] }));
      if (open.sessions.length) {
        await Promise.race([
          Promise.all(
            open.sessions.map((held) => client.closeSession(held.session_id).catch(() => undefined)),
          ),
          new Promise((resolve) => setTimeout(resolve, 25_000)),
        ]);
      }

      const created = await client.createSession({
        media_id: selected,
        target_fps: 6,
        autostart: true,
        max_frames: 120,
      });

      // `autostart` is a request to the platform, not a guarantee from it. A
      // session that comes back paused sits at frame 0 forever, and every
      // reading taken from it — objects, coverage, economy, latency — is a
      // truthful zero that looks exactly like a fault. So the button labelled
      // Start makes sure the thing it named actually started.
      if (created.playing) return created;
      return client.transport(created.session_id, 'play').catch(() => created);
    },
    onSuccess: (created) => {
      setSessionId(created.session_id);
      queryClient.invalidateQueries();
    },
  });

  const upload = useMutation({
    mutationFn: (file: File) => client.uploadMedia(file),
    onSuccess: () => media.refetch(),
  });

  const transport = useMutation({
    mutationFn: (action: 'play' | 'pause') => client.transport(sessionId!, action),
  });

  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <input
        ref={fileInput}
        type="file"
        hidden
        accept=".mp4,.avi,.mkv,.mov,.webm"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) upload.mutate(file);
        }}
      />
      <Tooltip title="Upload CCTV footage" arrow>
        <IconButton size="small" onClick={() => fileInput.current?.click()}>
          {upload.isPending ? <CircularProgress size={16} /> : <UploadIcon fontSize="small" />}
        </IconButton>
      </Tooltip>

      <TextField
        select
        size="small"
        value={selected}
        onChange={(event) => setMediaId(event.target.value)}
        sx={{ minWidth: 210, '& .MuiInputBase-input': { fontSize: '0.8rem', py: 0.75 } }}
      >
        {assets.map((asset) => (
          <MenuItem key={asset.media_id} value={asset.media_id} disabled={!asset.usable}>
            {asset.name.replace(/^[0-9a-f]{8}-/, '').slice(0, 34)}
            {asset.probe ? ` · ${asset.probe.width}×${asset.probe.height}` : ''}
          </MenuItem>
        ))}
      </TextField>

      <Tooltip
        arrow
        title={
          open.isPending
            ? 'Opening a session runs the P15 conformance gate, which makes real inference calls to prove the adapter never fabricates. On CPU that is several minutes. Do not press again — a second session competes for the same model.'
            : 'Open a session on the selected footage and begin playback'
        }
      >
        <span>
          <Button
            size="small"
            variant="contained"
            disabled={!selected || open.isPending}
            onClick={() => open.mutate()}
          >
            {open.isPending ? 'Starting…' : 'Start'}
          </Button>
        </span>
      </Tooltip>

      {sessionId ? (
        <Tooltip title={session?.playing ? 'Pause' : 'Resume'} arrow>
          <IconButton
            size="small"
            onClick={() => transport.mutate(session?.playing ? 'pause' : 'play')}
            sx={{ bgcolor: `${brand.primary}22` }}
          >
            {session?.playing ? <PauseIcon fontSize="small" /> : <PlayIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      ) : null}
    </Stack>
  );
}

function PlatformDown() {
  return (
    <Box sx={{ display: 'grid', placeItems: 'center', height: '100vh', p: 4 }}>
      <Alert severity="error" variant="outlined" sx={{ maxWidth: 620 }}>
        <Typography variant="h2" sx={{ mb: 1 }}>
          Vision OS platform service is not running
        </Typography>
        This application is a viewer. It holds no data of its own and computes nothing — every
        value it shows comes from Vision OS.
        <Box
          component="pre"
          sx={{
            mt: 1.5,
            p: 1.5,
            bgcolor: brand.surface,
            border: `1px solid ${brand.border}`,
            borderRadius: 2,
            fontFamily: mono,
            fontSize: '0.78rem',
          }}
        >
          {'cd vision_os_validation_console/harness\npython -m vosvc_harness'}
        </Box>
      </Alert>
    </Box>
  );
}
