/**
 * Frame by Frame — the video, one sampled frame at a time, for a human.
 *
 * **A view. Nothing else.** It issues one read (`queryObservations`) and one
 * image fetch per frame. There is no code path from this file to a model: it
 * cannot cause an inference, only display one that already happened and was
 * recorded. Every sentence, count, box and label is assembled from records the
 * platform produced, by the pure functions in [[frames.ts]].
 *
 * The audience is a manager, so the architecture vocabulary is folded away —
 * `frame_ref`, `object_id`, `evidence_ref`, adapter and model are all present
 * and all one click behind "Traceability". Hidden, never removed: a summary
 * that cannot be audited is a story.
 *
 * ### Two pictures, never confused
 *
 * The object detail can show two images, and they are labelled apart because
 * they are different evidence:
 *
 * - **"the image sent to the model"** — the retained crop, served from the
 *   archive the Crop Manager's sink wrote. Present only when the deployment's
 *   `cropping.retention_mode` is `evidence`; an `ephemeral` or `never_persist`
 *   policy means no crop was kept, and the page says which.
 * - **"this frame, at the detected position"** — the frame magnified to the
 *   bounding box, by CSS. Always available when imagery is served, and never
 *   described as the crop, because it is not what the model was given.
 *
 * Collapsing those two into one label would be a small lie that makes every
 * other claim on the page worth less.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Collapse,
  Link,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { usePlatform } from '../api/provider';
import { useHealth, useObservations } from '../api/hooks';
import {
  countByClass,
  describeDetections,
  describeFrameRef,
  describeUnderstanding,
  deriveHighlights,
  formatClock,
  groupObservationsByFrame,
  humanClass,
  titleCase,
  type FrameGroup,
  type FrameObject,
} from '../insights/frames';
import { EmptyState, Loading, Mono, SectionTitle, Unavailable } from '../components/primitives';
import { brand, mono, observability } from '../theme/theme';

/** Iconography only. Adds no meaning a record does not already carry. */
const ICONS: Record<string, string> = {
  person: '👤',
  bicycle: '🚲',
  car: '🚗',
  bus: '🚌',
  truck: '🚚',
  motorcycle: '🏍️',
  traffic_light: '🚦',
  backpack: '🎒',
  handbag: '👜',
  chair: '🪑',
  dining_table: '🍽️',
  bottle: '🍾',
  cup: '☕',
};

const PURPOSE_HINT = 'e.g. reviewing footage for the Tuesday incident';

export function FrameByFrame() {
  const { client, sessionId, session } = usePlatform();
  const health = useHealth();
  const feed = useObservations();
  // Which crops the deployment actually kept. Polled with the feed, because a
  // crop appears only once its object has been examined.
  const cropIndex = useQuery({
    queryKey: ['crops', sessionId],
    queryFn: () => client.crops(sessionId!),
    enabled: Boolean(sessionId),
    refetchInterval: 4000,
    retry: false,
  });

  const [purpose, setPurpose] = useState('');
  const [confirmedPurpose, setConfirmedPurpose] = useState('');
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [selectedObject, setSelectedObject] = useState<string | null>(null);
  const [showTrace, setShowTrace] = useState(false);

  const groups = useMemo(
    () => groupObservationsByFrame(feed.data?.observations ?? []),
    [feed.data],
  );

  const highlights = useMemo(() => deriveHighlights(groups), [groups]);

  // Focus the newest frame as records arrive, until the viewer picks one.
  useEffect(() => {
    if (!focusedKey && groups.length) setFocusedKey(groups[groups.length - 1]!.key);
  }, [groups, focusedKey]);

  if (!sessionId) {
    return (
      <EmptyState
        what="camera running"
        note="Choose footage in the header and press Start. Frames appear here as the platform records what it saw."
      />
    );
  }
  if (feed.error && !feed.data) {
    return <Unavailable what="Observation feed" reason={String(feed.error)} />;
  }

  const framesServed = health.data?.harness.serve_frames ?? false;
  const focused = groups.find((group) => group.key === focusedKey) ?? groups[groups.length - 1];
  const fps = session?.target_fps ?? 1;

  return (
    <Stack spacing={2.5} sx={{ maxWidth: 1040 }}>
      <SectionTitle
        action={
          <Chip size="small" variant="outlined" label={`${groups.length} frames`} />
        }
      >
        Frame by frame
      </SectionTitle>

      {!framesServed ? (
        <Alert severity="info" variant="outlined">
          <strong>Images are not being served.</strong> The camera's geometry and everything the
          platform recorded is shown below; the pictures themselves stay on the machine unless the
          deployment enables them (<Mono>VOSVC_SERVE_FRAMES=1</Mono>).
        </Alert>
      ) : !confirmedPurpose ? (
        <Card sx={{ borderColor: `${brand.primary}66` }}>
          <CardContent>
            <Typography sx={{ fontWeight: 600, mb: 0.5 }}>Why are you viewing this footage?</Typography>
            <Typography variant="caption" sx={{ display: 'block', mb: 1.5 }}>
              Viewing imagery is recorded against your identity. Reading what the camera reported
              and looking at the picture are different permissions, and the second one is
              attributable.
            </Typography>
            <Stack direction="row" spacing={1}>
              <TextField
                size="small"
                fullWidth
                placeholder={PURPOSE_HINT}
                value={purpose}
                onChange={(event) => setPurpose(event.target.value)}
                sx={{ maxWidth: 460 }}
              />
              <Button
                variant="contained"
                disabled={!purpose.trim()}
                onClick={() => setConfirmedPurpose(purpose.trim())}
              >
                Show footage
              </Button>
            </Stack>
          </CardContent>
        </Card>
      ) : null}

      {/* --- timeline ------------------------------------------------------- */}
      {groups.length > 0 ? (
        <Box sx={{ overflowX: 'auto', pb: 0.5 }}>
          <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 'min-content' }}>
            {groups.map((group) => {
              const active = group.key === focused?.key;
              return (
                <Chip
                  key={group.key}
                  size="small"
                  label={formatClock(group.captureNs / 1e9)}
                  onClick={() => {
                    setFocusedKey(group.key);
                    setSelectedObject(null);
                  }}
                  sx={{
                    fontFamily: mono,
                    cursor: 'pointer',
                    bgcolor: active ? `${brand.primary}33` : brand.surfaceHigh,
                    border: `1px solid ${active ? brand.primary : 'transparent'}`,
                    color: active ? brand.text : brand.textDim,
                  }}
                />
              );
            })}
          </Stack>
        </Box>
      ) : null}

      {feed.isLoading && groups.length === 0 ? (
        <Loading label="Reading what the camera recorded" />
      ) : !focused ? (
        <EmptyState
          what="frames recorded yet"
          note="A frame appears here once the platform has recorded something about it."
        />
      ) : (
        <FrameCard
          group={focused}
          fps={fps}
          cropUrlFor={(objectId) => {
            if (!objectId || !confirmedPurpose) return null;
            const held = cropIndex.data?.by_object?.[objectId];
            if (!held?.length) return null;
            // The crop taken on this frame when there is one, otherwise the most
            // recent — an object is examined once per freshness window, so the
            // image that produced its attributes is usually an earlier frame's.
            const match =
              held.find((crop) => crop.frame_seq === focused.frameIndex) ??
              held[held.length - 1]!;
            return client.cropUrl(match.crop_id, confirmedPurpose, sessionId);
          }}
          cropsRefused={Boolean(
            (cropIndex.data?.refused_ephemeral ?? 0) > 0 ||
              (cropIndex.data?.refused_never_persist ?? 0) > 0,
          )}
          frameUrl={
            framesServed && confirmedPurpose && focused.frameIndex !== null
              ? client.frameUrl(sessionId, focused.frameIndex, confirmedPurpose)
              : null
          }
          highlights={highlights.filter((entry) => entry.frameKey === focused.key)}
          selectedObject={selectedObject}
          onSelectObject={setSelectedObject}
          showTrace={showTrace}
          onToggleTrace={() => setShowTrace((shown) => !shown)}
        />
      )}

      <Typography variant="caption">
        Sampled at {fps} frame{fps === 1 ? '' : 's'} per second. A moment with no frame here
        produced no record — the camera looked and reported nothing, which is a different fact from
        not having looked.
      </Typography>
    </Stack>
  );
}

// --- one frame ---------------------------------------------------------------- //

function FrameCard({
  group,
  fps,
  frameUrl,
  cropUrlFor,
  cropsRefused,
  highlights,
  selectedObject,
  onSelectObject,
  showTrace,
  onToggleTrace,
}: {
  group: FrameGroup;
  fps: number;
  frameUrl: string | null;
  cropUrlFor: (objectId: string | null) => string | null;
  cropsRefused: boolean;
  highlights: ReturnType<typeof deriveHighlights>;
  selectedObject: string | null;
  onSelectObject: (id: string | null) => void;
  showTrace: boolean;
  onToggleTrace: () => void;
}) {
  const counts = countByClass(group);
  const summary = describeDetections(group);
  const understood = group.objects.filter((object) => object.attributes.length > 0);
  const selected = group.objects.find((object) => object.objectId === selectedObject) ?? null;

  return (
    <Card>
      <CardContent>
        <Stack direction="row" alignItems="baseline" spacing={1.5} sx={{ mb: 1.5 }}>
          <Typography sx={{ fontSize: '1.6rem', fontWeight: 700, fontFamily: mono }}>
            {formatClock(group.captureNs / 1e9)}
          </Typography>
          <Typography variant="caption">
            {group.frameIndex !== null ? `frame ${group.frameIndex}` : 'no frame number recorded'}
            {' · '}
            {group.observations.length} records
          </Typography>
        </Stack>

        {/* --- the picture, with what the camera found on it ----------------- */}
        <Box
          sx={{
            position: 'relative',
            width: '100%',
            aspectRatio: '16 / 9',
            bgcolor: '#05070d',
            borderRadius: 2,
            overflow: 'hidden',
            border: `1px solid ${brand.border}`,
          }}
        >
          {frameUrl ? (
            <Box
              component="img"
              src={frameUrl}
              alt={`frame ${group.frameIndex ?? ''}`}
              sx={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
            />
          ) : (
            <Stack alignItems="center" justifyContent="center" sx={{ height: '100%', px: 4 }}>
              <Typography variant="caption" sx={{ textAlign: 'center' }}>
                The picture is not being shown. The positions below are still exactly what the
                camera reported.
              </Typography>
            </Stack>
          )}

          {group.objects.map((object) => {
            if (!object.bbox) return null;
            const isSelected = object.objectId === selectedObject;
            const dimmed = selectedObject !== null && !isSelected;
            const colour = isSelected ? brand.accent : observability.observing;
            return (
              <Box
                key={object.objectId ?? object.label}
                onClick={() => onSelectObject(isSelected ? null : object.objectId)}
                sx={{
                  position: 'absolute',
                  left: `${object.bbox.x1 * 100}%`,
                  top: `${object.bbox.y1 * 100}%`,
                  width: `${(object.bbox.x2 - object.bbox.x1) * 100}%`,
                  height: `${(object.bbox.y2 - object.bbox.y1) * 100}%`,
                  border: `2px solid ${colour}`,
                  borderRadius: 0.75,
                  cursor: 'pointer',
                  opacity: dimmed ? 0.3 : 1,
                  transition: 'opacity 120ms',
                }}
              >
                {isSelected || group.objects.length <= 8 ? (
                  <Box
                    sx={{
                      position: 'absolute',
                      top: -18,
                      left: -2,
                      px: 0.6,
                      bgcolor: colour,
                      color: '#05070d',
                      borderRadius: 0.5,
                      fontFamily: mono,
                      fontSize: '0.6rem',
                      fontWeight: 700,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {object.label}
                  </Box>
                ) : null}
              </Box>
            );
          })}
        </Box>

        {/* --- detected ------------------------------------------------------ */}
        <Typography variant="caption" sx={{ display: 'block', mt: 2.5, mb: 1, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Detected
        </Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {counts.length === 0 ? (
            <Typography variant="caption">Nothing the camera recognises.</Typography>
          ) : (
            counts.map(({ classId, count }) => (
              <Chip
                key={classId}
                size="small"
                label={`${ICONS[classId] ?? '•'}  ${titleCase(humanClass(classId))} × ${count}`}
                sx={{ bgcolor: brand.surfaceHigh, fontSize: '0.78rem' }}
              />
            ))
          )}
        </Stack>

        {/* --- what happened -------------------------------------------------- */}
        <Typography variant="caption" sx={{ display: 'block', mt: 2.5, mb: 0.75, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          What happened
        </Typography>
        <Typography sx={{ fontSize: '1.05rem', lineHeight: 1.6 }}>{summary}</Typography>

        {highlights.length > 0 ? (
          <Stack spacing={0.4} sx={{ mt: 1.25 }}>
            {highlights.map((entry, index) => (
              <Typography
                key={`${entry.kind}-${entry.objectId ?? index}`}
                variant="caption"
                sx={{ pl: 1, borderLeft: `2px solid ${brand.primary}` }}
              >
                {entry.text}
              </Typography>
            ))}
          </Stack>
        ) : null}

        {/* --- understanding --------------------------------------------------- */}
        <Typography variant="caption" sx={{ display: 'block', mt: 2.5, mb: 1, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          What the model was asked about
        </Typography>
        {understood.length === 0 ? (
          <Typography variant="caption" sx={{ fontStyle: 'italic' }}>
            None of these objects was examined in this frame. Examination is triggered and
            budgeted — it does not run for every object on every frame.
          </Typography>
        ) : (
          <Stack spacing={1}>
            {understood.map((object) => (
              <ObjectUnderstanding
                key={object.objectId ?? object.label}
                object={object}
                selected={object.objectId === selectedObject}
                onSelect={() =>
                  onSelectObject(object.objectId === selectedObject ? null : object.objectId)
                }
              />
            ))}
          </Stack>
        )}

        {/* --- selected object detail ------------------------------------------ */}
        {selected ? (
          <ObjectDetail
            object={selected}
            frameUrl={frameUrl}
            cropUrl={cropUrlFor(selected.objectId)}
            cropsRefused={cropsRefused}
          />
        ) : null}

        {/* --- evidence ---------------------------------------------------------- */}
        {(() => {
          const withCrops = group.objects
            .map((object) => ({ object, url: cropUrlFor(object.objectId) }))
            .filter((entry): entry is { object: FrameObject; url: string } => Boolean(entry.url));
          if (!withCrops.length) return null;
          return (
            <>
              <Typography
                variant="caption"
                sx={{ display: 'block', mt: 2.5, mb: 1, textTransform: 'uppercase', letterSpacing: '0.08em' }}
              >
                Evidence — the images the model was given
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {withCrops.map(({ object, url }) => (
                  <Box
                    key={object.objectId ?? object.label}
                    onClick={() => onSelectObject(object.objectId)}
                    sx={{ cursor: 'pointer', textAlign: 'center' }}
                  >
                    <Box
                      component="img"
                      src={url}
                      alt={object.label}
                      sx={{
                        width: 84,
                        height: 84,
                        objectFit: 'contain',
                        borderRadius: 1,
                        bgcolor: '#05070d',
                        border: `1px solid ${
                          object.objectId === selectedObject ? brand.accent : brand.border
                        }`,
                        display: 'block',
                      }}
                    />
                    <Typography variant="caption" sx={{ fontSize: '0.6rem' }}>
                      {object.label}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            </>
          );
        })()}

        {/* --- traceability ----------------------------------------------------- */}
        <Link
          component="button"
          underline="hover"
          onClick={onToggleTrace}
          sx={{ mt: 2.5, fontSize: '0.8rem', color: brand.primary, display: 'block' }}
        >
          {showTrace ? 'Hide traceability' : 'Show traceability'}
        </Link>
        <Collapse in={showTrace} unmountOnExit>
          <Box sx={{ mt: 1.5, p: 1.5, bgcolor: brand.surface, borderRadius: 1.5, border: `1px solid ${brand.border}` }}>
            <Stack spacing={0.5}>
              <Trace label="frame_ref" value={describeFrameRef(group.observations[0]?.frame_ref)} />
              <Trace label="camera" value={group.cameraId} />
              <Trace label="objects" value={String(group.objects.length)} />
              <Trace label="observations" value={String(group.observations.length)} />
              <Trace label="capture" value={`${(group.captureNs / 1e9).toFixed(3)} s`} />
              <Trace label="sampled at" value={`${fps} fps`} />
            </Stack>
            <Box
              component="pre"
              sx={{
                mt: 1.5,
                m: 0,
                p: 1.25,
                maxHeight: '40vh',
                overflow: 'auto',
                fontFamily: mono,
                fontSize: '0.68rem',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                color: brand.textDim,
              }}
            >
              {JSON.stringify(group.observations, null, 2)}
            </Box>
          </Box>
        </Collapse>
      </CardContent>
    </Card>
  );
}

function ObjectUnderstanding({
  object,
  selected,
  onSelect,
}: {
  object: FrameObject;
  selected: boolean;
  onSelect: () => void;
}) {
  const lines = describeUnderstanding(object);
  return (
    <Box
      onClick={onSelect}
      sx={{
        p: 1.25,
        borderRadius: 1.5,
        cursor: 'pointer',
        border: `1px solid ${selected ? brand.accent : brand.border}`,
        bgcolor: selected ? `${brand.accent}0d` : 'transparent',
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1}>
        <Typography sx={{ fontWeight: 650, fontSize: '0.95rem' }}>
          {ICONS[object.classId] ?? '•'} {object.label}
        </Typography>
        <Box sx={{ flex: 1 }} />
        {object.confidence ? (
          <Tooltip
            arrow
            title={
              object.confidence.calibrated
                ? 'Calibrated — comparable across models.'
                : 'Self-reported by the model and uncalibrated. Not a probability, and not comparable between models.'
            }
          >
            <Chip
              size="small"
              variant="outlined"
              label={`${(object.confidence.value * 100).toFixed(0)}%${
                object.confidence.calibrated ? '' : ' uncal.'
              }`}
              sx={{ height: 19, fontSize: '0.62rem' }}
            />
          </Tooltip>
        ) : null}
      </Stack>
      <Stack spacing={0.25} sx={{ mt: 0.75 }}>
        {lines.map((line) => (
          <Typography key={line} sx={{ fontSize: '0.88rem', color: brand.textDim }}>
            • {line}
          </Typography>
        ))}
      </Stack>
    </Box>
  );
}

/**
 * The selected object, magnified out of the frame this page already holds.
 *
 * **Not the crop the model saw.** That crop has an `evidence_ref` and no stored
 * blob — nothing writes crop bytes into the evidence store — so retrieving it
 * returns a 404. Showing this magnified region and calling it "the crop" would
 * be the kind of small lie that makes every other claim on the page worth less,
 * so it is labelled for what it is.
 */
function ObjectDetail({
  object,
  frameUrl,
  cropUrl,
  cropsRefused,
}: {
  object: FrameObject;
  frameUrl: string | null;
  cropUrl: string | null;
  cropsRefused: boolean;
}) {
  const box = object.bbox;
  const evidence = object.attributes.find((attribute) => attribute.evidenceRef)?.evidenceRef;

  return (
    <Box sx={{ mt: 2.5, p: 1.5, borderRadius: 1.5, border: `1px solid ${brand.accent}55` }}>
      <Typography variant="caption" sx={{ display: 'block', mb: 1, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {object.label} — detail
      </Typography>

      <Stack direction="row" spacing={2} alignItems="flex-start" flexWrap="wrap" useFlexGap>
        {/* The crop the model was actually asked about, when the deployment's
            retention policy kept it. */}
        {cropUrl ? (
          <Box sx={{ flexShrink: 0 }}>
            <Box
              component="img"
              src={cropUrl}
              alt={`${object.label} crop`}
              sx={{
                width: 190,
                height: 190,
                objectFit: 'contain',
                borderRadius: 1,
                border: `1px solid ${observability.observing}66`,
                bgcolor: '#05070d',
                display: 'block',
              }}
            />
            <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: observability.observing }}>
              the image sent to the model
            </Typography>
          </Box>
        ) : null}

        {/* The same region taken out of the frame. Shown alongside the crop when
            both exist, and alone when the crop was not retained — labelled
            differently in each case, because they are different things. */}
        {frameUrl && box ? (
          <Box sx={{ flexShrink: 0 }}>
            <Box
              sx={{
                width: 190,
                height: 190,
                borderRadius: 1,
                border: `1px solid ${brand.border}`,
                overflow: 'hidden',
                position: 'relative',
                bgcolor: '#05070d',
              }}
            >
              <Box
                component="img"
                src={frameUrl}
                alt={`${object.label} region`}
                sx={{
                  position: 'absolute',
                  width: `${100 / Math.max(box.x2 - box.x1, 0.02)}%`,
                  left: `${(-box.x1 * 100) / Math.max(box.x2 - box.x1, 0.02)}%`,
                  top: `${(-box.y1 * 100) / Math.max(box.y2 - box.y1, 0.02)}%`,
                  height: `${100 / Math.max(box.y2 - box.y1, 0.02)}%`,
                  objectFit: 'fill',
                }}
              />
            </Box>
            <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
              this frame, at the detected position
            </Typography>
          </Box>
        ) : null}

        <Box sx={{ flex: 1, minWidth: 240 }}>
          <Stack spacing={0.5}>
            <Trace label="object" value={object.objectId ?? '—'} />
            <Trace label="class" value={object.classId} />
            {box ? (
              <Trace
                label="position"
                value={`${box.x1.toFixed(3)}, ${box.y1.toFixed(3)} → ${box.x2.toFixed(3)}, ${box.y2.toFixed(3)}`}
              />
            ) : null}
            <Trace label="evidence" value={evidence ?? 'none recorded'} />
            <Trace label="records" value={object.observationIds.length.toString()} />
          </Stack>

          {!cropUrl ? (
            <Typography variant="caption" sx={{ display: 'block', mt: 1, color: observability.degraded }}>
              {cropsRefused
                ? 'The image sent to the model was not kept: this deployment’s retention policy ' +
                  'is not “evidence”, so crops are analysed and discarded.'
                : 'No image was retained for this object — it may not have been examined in this frame.'}
            </Typography>
          ) : null}
        </Box>
      </Stack>
    </Box>
  );
}

function Trace({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <Stack direction="row" spacing={1.5}>
      <Typography variant="caption" sx={{ minWidth: 92, fontFamily: mono, fontSize: '0.66rem' }}>
        {label}
      </Typography>
      <Mono>{value}</Mono>
    </Stack>
  );
}

