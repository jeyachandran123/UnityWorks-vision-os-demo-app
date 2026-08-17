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
import { useFrameLedger, useHealth, useObservations, useVisionState } from '../api/hooks';
import {
  collectFrameEvidence,
  countByClass,
  describeDetections,
  describeFrameRef,
  describeFrameStory,
  describeUnderstanding,
  deriveHighlights,
  frameClock,
  groupObservationsByFrame,
  humanClass,
  titleCase,
  type FrameEvidence,
  type FrameGroup,
  type FrameObject,
} from '../insights/frames';
import type {
  ComplianceState,
  ComplianceStatus,
  CropIndex,
  Finding,
} from '../api/types';
import {
  describeLabelSpace,
  qualifyClassClaim,
  readLabelSpace,
  type LabelSpace,
} from '../insights/capability';
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

  // When each sampled frame sits in the video, and what the bound detector can
  // actually name. Both are reads; neither changes anything Vision OS recorded.
  const ledger = useFrameLedger();
  const state = useVisionState();

  // Compliance findings, recomputed on the platform side from current Vision
  // State. Polled alongside the crops rather than accumulated here: a finding is
  // a pure function of (rules, observations, now), so re-reading is always
  // correct and needs no invalidation — and a stale violation on screen is worse
  // than a slow one.
  const complianceStatus = useQuery({
    queryKey: ['compliance-status', sessionId],
    queryFn: () => client.complianceStatus(sessionId!),
    enabled: Boolean(sessionId),
    retry: false,
  });
  const compliance = useQuery({
    queryKey: ['compliance', sessionId],
    queryFn: () => client.compliance(sessionId!),
    enabled: Boolean(sessionId),
    refetchInterval: 4000,
    retry: false,
  });
  const findingsByObject = useMemo(() => {
    const map = new Map<string, Finding[]>();
    for (const finding of compliance.data?.findings ?? []) {
      const key = finding.subject.object_id;
      map.set(key, [...(map.get(key) ?? []), finding]);
    }
    return map;
  }, [compliance.data]);
  const labelSpace = useMemo(
    () => readLabelSpace(state.data?.capabilities),
    [state.data],
  );

  const [purpose, setPurpose] = useState('');
  const [confirmedPurpose, setConfirmedPurpose] = useState('');
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [selectedObject, setSelectedObject] = useState<string | null>(null);
  const [showTrace, setShowTrace] = useState(false);

  const sourceMsByFrame = useMemo(() => {
    const map = new Map<number, number>();
    for (const entry of ledger.data?.entries ?? []) map.set(entry.frame_index, entry.pts_ms);
    return map;
  }, [ledger.data]);

  const groups = useMemo(
    () => groupObservationsByFrame(feed.data?.observations ?? [], sourceMsByFrame),
    [feed.data, sourceMsByFrame],
  );

  const highlights = useMemo(() => deriveHighlights(groups), [groups]);

  // What the timeline actually covers. A viewer can read the end of this against
  // the length of the video and see for themselves that nothing was cut off.
  const span = useMemo(() => {
    if (!groups.length) return null;
    return {
      first: frameClock(groups[0]!).text,
      last: frameClock(groups[groups.length - 1]!).text,
    };
  }, [groups]);

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

  // Two **independent** permissions, and keeping them apart is the point.
  //
  // 12_SECURITY §5.3 separates reading what the camera reported from looking at
  // the picture, and the harness separates the pictures again: `VOSVC_SERVE_FRAMES`
  // governs whole frames, `VOSVC_ALLOW_EVIDENCE` governs the retained crops a
  // model was actually shown. Granting the second while withholding the first is
  // the recommended posture — a reviewer checking a finding needs the 224x224
  // crop behind the claim, not the whole room.
  //
  // This page used to treat frame serving as the gate for both, which made that
  // posture unusable: the purpose prompt never rendered, so no purpose could be
  // declared, so every crop URL stayed null and the evidence tiles reported
  // "purpose needed" forever with no way to supply one. The crops were being
  // served correctly the entire time; the page simply never asked for them.
  const framesServed = health.data?.harness.serve_frames ?? false;
  const evidenceAllowed = health.data?.harness.allow_evidence ?? false;
  const imageryAvailable = framesServed || evidenceAllowed;
  const focused = groups.find((group) => group.key === focusedKey) ?? groups[groups.length - 1];
  const fps = session?.target_fps ?? 1;

  return (
    <Stack spacing={2.5} sx={{ maxWidth: 1040 }}>
      <SectionTitle
        action={
          <Stack direction="row" spacing={0.75} alignItems="center">
            <Tooltip
              arrow
              title={
                `${groups.length} of the ${session?.frame_count ?? '—'} sampled frames ` +
                'carry observations. A sampled frame with none was still analysed — the ' +
                'platform suppresses a record that repeats the last one exactly, so a ' +
                'static scene goes quiet rather than restating itself. These are analysis ' +
                'frames, not the video’s own: the video is sampled, not examined frame by frame.'
              }
            >
              <Chip
                size="small"
                variant="outlined"
                label={
                  session?.frame_count
                    ? `${groups.length} of ${session.frame_count} analysis frames`
                    : `${groups.length} analysis frames`
                }
              />
            </Tooltip>
            {span ? (
              <Chip
                size="small"
                variant="outlined"
                label={`${span.first} – ${span.last}`}
                sx={{ fontFamily: mono }}
              />
            ) : null}
          </Stack>
        }
      >
        Frame by frame
      </SectionTitle>

      {/* The one case paging cannot cover, stated rather than shown as a video
          that ends early — which is the failure this page had. */}
      {feed.data?.truncated ? (
        <Alert severity="warning" variant="outlined">
          <strong>This session has more observations than one read can carry.</strong> The
          timeline below stops before the end of the video. It is not a record of the video
          ending.
        </Alert>
      ) : null}

      {session?.frame_count && groups.length < session.frame_count ? (
        <Alert severity="info" variant="outlined">
          <strong>
            {session.frame_count - groups.length} of {session.frame_count} sampled frames
            produced no new record.
          </strong>{' '}
          They were analysed. The platform suppresses an observation that repeats the
          previous one exactly, so a scene that stops changing stops emitting — an absent
          frame below is silence, not a gap in processing.
        </Alert>
      ) : null}

      {/* What the detector can name at all. Shown once, above everything that
          depends on it, because every class name on this page is downstream of
          it. A closed-set model has no way to say "not one of mine", so its
          answer is the nearest of a fixed list and must not read as an identity. */}
      {describeLabelSpace(labelSpace) ? (
        <Alert severity="info" variant="outlined">
          <strong>Names on this page come from a fixed vocabulary.</strong>{' '}
          {describeLabelSpace(labelSpace)}{' '}
          <Tooltip arrow title={labelSpace.vocabulary.join(', ')}>
            <Box component="span" sx={{ textDecoration: 'underline dotted', cursor: 'help' }}>
              See the {labelSpace.size} it knows.
            </Box>
          </Tooltip>
        </Alert>
      ) : null}

      {!imageryAvailable ? (
        <Alert severity="info" variant="outlined">
          <strong>Images are not being served.</strong> The camera's geometry and everything the
          platform recorded is shown below; the pictures themselves stay on the machine unless the
          deployment enables them (<Mono>VOSVC_SERVE_FRAMES=1</Mono> for whole frames,{' '}
          <Mono>VOSVC_ALLOW_EVIDENCE=1</Mono> for the crops a model was shown).
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
            {/* Say which of the two this deployment grants, so a reviewer knows
                what to expect before declaring a purpose rather than after. */}
            {!framesServed ? (
              <Typography variant="caption" sx={{ display: 'block', mb: 1.5, fontStyle: 'italic' }}>
                This deployment serves the retained crops a model was shown, but not whole frames.
                You will see each object's own image; the full picture stays on the machine.
              </Typography>
            ) : null}
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
                  label={frameClock(group).text}
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
          labelSpace={labelSpace}
          // Which object maps to which retained image is decided by
          // `collectFrameEvidence`, in one place and under test. This supplies
          // only the address of a crop the sink already wrote — and refuses to
          // build one until a purpose has been declared, exactly as frame
          // access does.
          cropIndex={cropIndex.data ?? null}
          cropUrl={(cropId) =>
            confirmedPurpose ? client.cropUrl(cropId, confirmedPurpose, sessionId) : null
          }
          frameUrl={
            framesServed && confirmedPurpose && focused.frameIndex !== null
              ? client.frameUrl(sessionId, focused.frameIndex, confirmedPurpose)
              : null
          }
          highlights={highlights.filter((entry) => entry.frameKey === focused.key)}
          // Findings for the objects in *this* frame, so the panel describes the
          // moment on screen rather than the whole session.
          findings={focused.objects.flatMap((object) =>
            object.objectId ? (findingsByObject.get(object.objectId) ?? []) : [],
          )}
          complianceStatus={complianceStatus.data ?? null}
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
  labelSpace,
  frameUrl,
  cropIndex,
  cropUrl,
  highlights,
  findings,
  complianceStatus,
  selectedObject,
  onSelectObject,
  showTrace,
  onToggleTrace,
}: {
  group: FrameGroup;
  fps: number;
  labelSpace: LabelSpace;
  frameUrl: string | null;
  cropIndex: CropIndex | null;
  cropUrl: (cropId: string) => string | null;
  highlights: ReturnType<typeof deriveHighlights>;
  findings: Finding[];
  complianceStatus: ComplianceStatus | null;
  selectedObject: string | null;
  onSelectObject: (id: string | null) => void;
  showTrace: boolean;
  onToggleTrace: () => void;
}) {

  
  const counts = countByClass(group);
  const clock = frameClock(group);
  const qualifier = qualifyClassClaim(labelSpace);
  const summary = describeDetections(group);
  const story = describeFrameStory(group);
  // One entry per object in the frame, always — an object with no retained
  // image appears with the platform's reason rather than dropping out.
  const evidence = collectFrameEvidence(group, cropIndex);
  const understood = group.objects.filter((object) => object.attributes.length > 0);
  const selected = group.objects.find((object) => object.objectId === selectedObject) ?? null;
  const selectedEvidence = evidence.find((entry) => entry.object === selected) ?? null;

  return (
    <Card>
      <CardContent>
        <Stack direction="row" alignItems="baseline" spacing={1.5} sx={{ mb: 1.5 }}>
          <Tooltip
            arrow
            title={
              clock.fromSource
                ? 'Where this frame sits in the video, from the timestamp the decoder read off the container.'
                : 'This frame has no ledger entry, so the platform’s capture stamp is shown instead. On a replay that measures progress through the replay, not through the video.'
            }
          >
            <Typography
              sx={{
                fontSize: '1.6rem',
                fontWeight: 700,
                fontFamily: mono,
                color: clock.fromSource ? brand.text : observability.degraded,
              }}
            >
              {clock.text}
            </Typography>
          </Tooltip>
          <Typography variant="caption">
            {group.frameIndex !== null ? `analysis frame ${group.frameIndex}` : 'no frame number recorded'}
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
            counts.map(({ classId, count }) => {
              // The best confidence the detector gave this class in this frame,
              // shown on the chip. A name without a number is where "toothbrush"
              // stopped looking like a guess and started looking like a fact.
              const strongest = group.objects
                .filter((object) => object.classId === classId)
                .reduce(
                  (best, object) => Math.max(best, object.confidence?.value ?? 0),
                  0,
                );
              return (
                <Tooltip
                  key={classId}
                  arrow
                  title={
                    qualifier
                      ? `“${humanClass(classId)}” is the closest of the ${labelSpace.size} ` +
                        'names this detector has to what it saw. It is not an ' +
                        'identification: an object outside those ' +
                        `${labelSpace.size} is still reported as one of them.` +
                        (strongest
                          ? ` The platform scores it ${(strongest * 100).toFixed(0)}%, which ` +
                            'measures how consistently this object’s evidence points at that ' +
                            'word — not whether the word is right.'
                          : '')
                      : `Detected${strongest ? ` at ${(strongest * 100).toFixed(0)}%` : ''}.`
                  }
                >
                  <Chip
                    size="small"
                    label={
                      `${ICONS[classId] ?? '•'}  ${titleCase(humanClass(classId))} × ${count}` +
                      // The number goes in the tooltip, never on the chip, when
                      // the vocabulary is closed. `Toothbrush × 1 · 100%` reads
                      // as certainty about what the object *is*; the score
                      // actually measures how consistently this object's
                      // evidence points at that word, and it reaches 100% for a
                      // track that was only ever guessed at.
                      (qualifier
                        ? ` · ${qualifier}`
                        : strongest
                          ? ` · ${(strongest * 100).toFixed(0)}%`
                          : '')
                    }
                    sx={{
                      bgcolor: brand.surfaceHigh,
                      fontSize: '0.78rem',
                      cursor: 'help',
                      border: qualifier ? `1px dashed ${brand.border}` : undefined,
                    }}
                  />
                </Tooltip>
              );
            })
          )}
        </Stack>

        {/* --- frame story ----------------------------------------------------- */}
        {/*
          The frame in a sentence, for someone who will never read an
          observation. Assembled by `describeFrameStory` from the same counts and
          recorded attribute values shown elsewhere on this card — there is no
          model call behind it, and the clauses it rests on are listed under
          Traceability so the sentence can be checked rather than believed.
        */}
        <Typography variant="caption" sx={{ display: 'block', mt: 2.5, mb: 0.75, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Frame story
        </Typography>
        <Typography sx={{ fontSize: '1.15rem', lineHeight: 1.55, fontWeight: 500 }}>
          {story.text}
        </Typography>
        {story.basis === 'presence' && group.objects.length > 0 ? (
          <Typography variant="caption" sx={{ display: 'block', mt: 0.5, fontStyle: 'italic' }}>
            No activity was recorded for these objects, so the story reports only what was
            detected.
          </Typography>
        ) : null}
        {/* The story names things using the detector's words, so it inherits the
            detector's limits. Saying so here, next to the sentence, is what stops
            a readable summary from being a more confident claim than the records
            underneath it. */}
        {qualifier && group.objects.length > 0 ? (
          <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: observability.degraded }}>
            Names above are the closest matches from a {labelSpace.size}-word vocabulary. An
            object this camera was never taught is still reported as one of those {labelSpace.size}.
          </Typography>
        ) : null}

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

        {/* --- compliance ------------------------------------------------------ */}
        {/*
          Read, never computed. The rule engine decided these on the platform
          side; this card renders the decision, the conditions behind it and the
          rule that produced it. Nothing in this bundle compares a value against
          a threshold, and nothing here can turn a missing observation into a
          violation.
        */}
        <Typography variant="caption" sx={{ display: 'block', mt: 2.5, mb: 1, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Compliance
        </Typography>
        <FrameCompliance findings={findings} status={complianceStatus} />

        {/* --- selected object detail ------------------------------------------ */}
        {selected ? (
          <ObjectDetail
            object={selected}
            frameUrl={frameUrl}
            evidence={selectedEvidence}
            cropUrl={cropUrl}
          />
        ) : null}

        {/* --- evidence ---------------------------------------------------------- */}
        {/*
          Every object in the frame, not every object that happens to have a
          picture. An object examined by the model shows the crop it was given;
          an object nothing asked about shows the frame at its detected position
          and says why no crop exists. Filtering this list to the objects with
          images is what previously made a four-object frame look like a
          two-object frame.
        */}
        {evidence.length > 0 ? (
          <>
            <Typography
              variant="caption"
              sx={{ display: 'block', mt: 2.5, mb: 1, textTransform: 'uppercase', letterSpacing: '0.08em' }}
            >
              Evidence — every object in this frame
            </Typography>
            <Stack direction="row" spacing={1.25} flexWrap="wrap" useFlexGap>
              {evidence.map((entry) => (
                <EvidenceTile
                  key={entry.object.objectId ?? entry.object.label}
                  entry={entry}
                  url={entry.cropId ? cropUrl(entry.cropId) : null}
                  frameUrl={frameUrl}
                  selected={entry.object.objectId === selectedObject}
                  onSelect={() => onSelectObject(entry.object.objectId)}
                />
              ))}
            </Stack>
          </>
        ) : null}

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
              {/* Two different clocks, never merged. `source` is where this
                  frame sits in the video; `capture` is the platform's own stamp,
                  which on a replay tracks the replay. */}
              <Trace
                label="source"
                value={
                  group.sourceMs !== null
                    ? `${(group.sourceMs / 1000).toFixed(3)} s into the video`
                    : 'not in the frame ledger'
                }
              />
              <Trace label="capture" value={`${(group.captureNs / 1e9).toFixed(3)} s (replay clock)`} />
              <Trace label="sampled at" value={`${fps} fps`} />
              <Trace
                label="label space"
                value={
                  labelSpace.kind === 'unknown'
                    ? 'not declared by the platform'
                    : `${labelSpace.kind} · ${labelSpace.space} · ${labelSpace.size} names`
                }
              />
            </Stack>

            {/* The records each clause of the frame story rests on, so the
                sentence can be checked against the JSON below rather than taken
                on trust. */}
            {story.grounds.length ? (
              <>
                <Typography variant="caption" sx={{ display: 'block', mt: 1.5, mb: 0.5 }}>
                  the frame story rests on
                </Typography>
                <Stack spacing={0.25}>
                  {story.grounds.map((ground) => (
                    <Typography key={ground} sx={{ fontFamily: mono, fontSize: '0.66rem', color: brand.textDim }}>
                      {ground}
                    </Typography>
                  ))}
                </Stack>
              </>
            ) : null}

            {/* frame_ref → object_id → evidence_ref, one row per object. */}
            <Typography variant="caption" sx={{ display: 'block', mt: 1.5, mb: 0.5 }}>
              evidence per object
            </Typography>
            <Stack spacing={0.25}>
              {evidence.map((entry) => {
                const box = entry.object.bbox;
                const confidence = entry.object.confidence;
                return (
                  <Typography
                    key={entry.object.objectId ?? entry.object.label}
                    sx={{ fontFamily: mono, fontSize: '0.66rem', color: brand.textDim }}
                  >
                    {[
                      entry.object.label,
                      entry.object.classId,
                      entry.object.objectId ?? 'no object_id',
                      entry.cropId ? `crop ${entry.cropId}` : `no crop (${entry.skipReason ?? 'none recorded'})`,
                      entry.cropFrameSeq !== null ? `from frame ${entry.cropFrameSeq}` : '',
                      box
                        ? `box ${box.x1.toFixed(3)},${box.y1.toFixed(3)}→${box.x2.toFixed(3)},${box.y2.toFixed(3)}`
                        : 'no box',
                      confidence ? `conf ${confidence.value.toFixed(3)}` : '',
                      entry.object.attributes.find((attribute) => attribute.evidenceRef)?.evidenceRef ?? '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Typography>
                );
              })}
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

/**
 * One object's evidence, in a tile the size of a thumbnail.
 *
 * Three states, captioned apart because they are three different claims:
 *
 * - **the crop** — the image the model was given, served from the archive the
 *   Flow 5 sink wrote. Captioned with the frame it came from when that is not
 *   this frame, because an object is examined once per freshness window.
 * - **the frame at the detected position** — the frame image, magnified to the
 *   recorded box by CSS. No picture is produced here and nothing is cropped:
 *   the browser is showing part of an image it already has. It is never called
 *   a crop, because the model was not shown it.
 * - **no image** — nothing was kept, and the platform's recorded reason is
 *   attached rather than the space being left blank.
 */
function EvidenceTile({
  entry,
  url,
  frameUrl,
  selected,
  onSelect,
}: {
  entry: FrameEvidence;
  url: string | null;
  frameUrl: string | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const box = entry.object.bbox;
  const isCrop = Boolean(url);
  const showRegion = !isCrop && Boolean(frameUrl) && Boolean(box);

  // A crop exists but cannot be addressed: viewing imagery is attributable, and
  // no purpose has been declared yet. Distinct from having no crop at all.
  const purposeWithheld = Boolean(entry.cropId) && !url;

  const caption = isCrop
    ? entry.kind === 'crop_from_other_frame' && entry.cropFrameSeq !== null
      ? `sent to the model · frame ${entry.cropFrameSeq}`
      : 'sent to the model'
    : purposeWithheld
      ? 'image kept — purpose needed'
      : showRegion
        ? 'this frame, at its position'
        : 'no image kept';

  const tooltip = purposeWithheld
    ? 'An image was kept for this object. Declare a purpose above to view it.'
    : entry.note || 'This is the image the model was given.';

  return (
    <Tooltip arrow title={tooltip}>
      <Box onClick={onSelect} sx={{ cursor: 'pointer', textAlign: 'center', width: 96 }}>
        <Box
          sx={{
            width: 96,
            height: 96,
            borderRadius: 1,
            bgcolor: '#05070d',
            border: `1px solid ${
              selected ? brand.accent : isCrop ? `${observability.observing}66` : brand.border
            }`,
            overflow: 'hidden',
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {url ? (
            <Box
              component="img"
              src={url}
              alt={`${entry.object.label} crop`}
              sx={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
            />
          ) : showRegion && box ? (
            <Box
              component="img"
              src={frameUrl!}
              alt={`${entry.object.label} region`}
              sx={{
                position: 'absolute',
                width: `${100 / Math.max(box.x2 - box.x1, 0.02)}%`,
                height: `${100 / Math.max(box.y2 - box.y1, 0.02)}%`,
                left: `${(-box.x1 * 100) / Math.max(box.x2 - box.x1, 0.02)}%`,
                top: `${(-box.y1 * 100) / Math.max(box.y2 - box.y1, 0.02)}%`,
                objectFit: 'fill',
                opacity: 0.85,
              }}
            />
          ) : (
            <Typography sx={{ fontSize: '1.4rem', opacity: 0.5 }}>
              {ICONS[entry.object.classId] ?? '•'}
            </Typography>
          )}
        </Box>
        <Typography variant="caption" sx={{ display: 'block', fontSize: '0.64rem', fontWeight: 600 }}>
          {entry.object.label}
        </Typography>
        <Typography
          variant="caption"
          sx={{
            display: 'block',
            fontSize: '0.56rem',
            lineHeight: 1.25,
            color: isCrop ? observability.observing : brand.textDim,
          }}
        >
          {caption}
        </Typography>
      </Box>
    </Tooltip>
  );
}

// --- compliance --------------------------------------------------------------- //
//
// Everything below RENDERS a decision. Nothing here makes one.
//
// There is no rule in this file, no threshold, no comparison between an observed
// value and an expected one. `state` arrives decided and `sentence` arrives
// written, both from the rule engine on the platform side. A verdict a browser
// computed is a verdict nobody can audit six months later, because the reasoning
// lived in a bundle that has since been redeployed.

const COMPLIANCE_TONE: Record<ComplianceState, string> = {
  compliant: observability.observing,
  violation: observability.blind,
  unknown: observability.degraded,
  not_applicable: brand.textDim,
};

const COMPLIANCE_WORD: Record<ComplianceState, string> = {
  compliant: 'COMPLIANT',
  violation: 'VIOLATION',
  unknown: 'UNKNOWN',
  not_applicable: 'NOT APPLICABLE',
};

/** Why a condition could not be established, in a reviewer's words.
 *
 *  A lookup, not a judgment: each key is a mechanism the platform reported, and
 *  the sentence beside it says what an operator would do about it. An unmapped
 *  reason renders verbatim rather than being dropped. */
const UNKNOWN_WORDING: Record<string, string> = {
  attribute_absent: 'the platform never recorded this value',
  attribute_stale: 'the value is older than this rule will rely on',
  evidence_unverified: 'the rule requires corroborating evidence that is absent or stale',
  coverage_gap: 'the camera was not fully observing this area',
  capability_gap: 'no loaded model can produce this value here',
  subject_not_observed: 'no matching subject was observed',
  value_unparseable: 'the recorded value cannot be compared against this rule',
  // The one a reviewer sees most on real footage. Worded as what happened
  // rather than as a verdict: the platform looked and the body part was not in
  // the picture, which is a different fact from the equipment being absent and
  // must never be read as one.
  not_observable: 'the platform looked and could not see this well enough to judge',
};

function ComplianceBadge({ state }: { state: ComplianceState }) {
  return (
    <Box
      component="span"
      sx={{
        px: 0.9,
        py: 0.2,
        borderRadius: 0.75,
        fontFamily: mono,
        fontSize: '0.68rem',
        letterSpacing: '0.09em',
        fontWeight: 700,
        color: COMPLIANCE_TONE[state],
        border: `1px solid ${COMPLIANCE_TONE[state]}55`,
        bgcolor: `${COMPLIANCE_TONE[state]}14`,
        whiteSpace: 'nowrap',
      }}
    >
      {COMPLIANCE_WORD[state]}
    </Box>
  );
}

/**
 * One finding, with the conditions it rests on.
 *
 * Every condition is shown, not only the failing ones. A reviewer asking "what
 * did it actually see?" should not have to re-query the platform, and a passing
 * condition on a surprising value is how a rule bug is found.
 */
function FindingCard({ finding }: { finding: Finding }) {
  return (
    <Box
      sx={{
        p: 1.25,
        borderRadius: 1.5,
        border: `1px solid ${brand.border}`,
        borderLeft: `3px solid ${COMPLIANCE_TONE[finding.state]}`,
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
        <Typography sx={{ fontWeight: 650, fontSize: '0.95rem' }}>
          {finding.subject.label || finding.subject.object_id}
        </Typography>
        <ComplianceBadge state={finding.state} />
        {finding.severity ? (
          <Typography variant="caption" sx={{ fontFamily: mono }}>
            {finding.severity}
          </Typography>
        ) : null}
      </Stack>

      {/* The end-user sentence. Assembled by the rule engine from the rule
          document's own wording — not generated by a model, which is why a
          stored finding regenerates it identically. */}
      <Typography sx={{ fontSize: '1.02rem', lineHeight: 1.5, mb: 0.75 }}>
        {finding.sentence}
      </Typography>

      <Stack spacing={0.35}>
        {finding.conditions.map((condition, index) => (
          <Stack
            key={`${condition.attribute_key}-${index}`}
            direction="row"
            spacing={1}
            alignItems="baseline"
            sx={{ flexWrap: 'wrap' }}
          >
            <Typography sx={{ fontFamily: mono, fontSize: '0.74rem', minWidth: 168 }}>
              {condition.satisfied === true ? '✓' : condition.satisfied === false ? '✗' : '?'}{' '}
              {condition.attribute_key}
            </Typography>
            <Typography variant="caption">
              {condition.satisfied === null
                ? UNKNOWN_WORDING[condition.unknown_reason ?? ''] ??
                  condition.unknown_reason ??
                  'could not be established'
                : `observed ${JSON.stringify(condition.observed)} · rule wants ${condition.operator} ${JSON.stringify(condition.expected)}`}
            </Typography>
          </Stack>
        ))}
      </Stack>

      {/* Traceability. The rule and version are what make a verdict appealable;
          the evidence handle is what makes it checkable. */}
      <Stack direction="row" spacing={2} sx={{ mt: 1, flexWrap: 'wrap' }}>
        <Trace label="rule" value={`${finding.rule_id}@${finding.rule_version}`} />
        <Trace label="ruleset" value={finding.ruleset_version} />
        <Trace label="object" value={finding.subject.object_id} />
        {finding.evidence_refs[0] ? (
          <Trace label="evidence" value={finding.evidence_refs[0]} />
        ) : null}
        {finding.coverage_fraction < 1 ? (
          <Trace label="coverage" value={finding.coverage_fraction.toFixed(3)} />
        ) : null}
      </Stack>
    </Box>
  );
}

/**
 * The compliance section of a frame card.
 *
 * Findings are filtered to the objects present in *this* frame, so the panel
 * describes the moment on screen rather than the whole session.
 */
function FrameCompliance({
  findings,
  status,
}: {
  findings: Finding[];
  status: ComplianceStatus | null;
}) {
  if (status && !status.enabled) {
    return (
      <Typography variant="caption" sx={{ fontStyle: 'italic' }}>
        No rules are loaded, so nothing was evaluated. That is different from
        finding nothing wrong — set COMPLIANCE_RULES to a rule document to
        enable evaluation.
      </Typography>
    );
  }
  if (findings.length === 0) {
    return (
      <Typography variant="caption" sx={{ fontStyle: 'italic' }}>
        No rule covers the objects in this frame. A rule applies to the subject
        classes it names, and reports nothing about anything else.
      </Typography>
    );
  }
  return (
    <Stack spacing={1}>
      {findings.map((finding) => (
        <FindingCard key={finding.finding_id} finding={finding} />
      ))}
    </Stack>
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
  evidence,
  cropUrl,
}: {
  object: FrameObject;
  frameUrl: string | null;
  evidence: FrameEvidence | null;
  cropUrl: (cropId: string) => string | null;
}) {
  const box = object.bbox;
  const evidenceRef = object.attributes.find((attribute) => attribute.evidenceRef)?.evidenceRef;
  const url = evidence?.cropId ? cropUrl(evidence.cropId) : null;

  return (
    <Box sx={{ mt: 2.5, p: 1.5, borderRadius: 1.5, border: `1px solid ${brand.accent}55` }}>
      <Typography variant="caption" sx={{ display: 'block', mb: 1, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {object.label} — detail
      </Typography>

      <Stack direction="row" spacing={2} alignItems="flex-start" flexWrap="wrap" useFlexGap>
        {/* The crop the model was actually asked about, when the deployment's
            retention policy kept it. */}
        {url ? (
          <Box sx={{ flexShrink: 0 }}>
            <Box
              component="img"
              src={url}
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
              {evidence?.kind === 'crop_from_other_frame' && evidence.cropFrameSeq !== null
                ? `the image sent to the model, taken on frame ${evidence.cropFrameSeq}`
                : 'the image sent to the model'}
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
            <Trace label="evidence" value={evidenceRef ?? 'none recorded'} />
            <Trace label="crop" value={evidence?.cropId ?? 'none retained'} />
            <Trace label="no crop because" value={evidence?.skipReason ?? ''} />
            <Trace label="records" value={object.observationIds.length.toString()} />
          </Stack>

          {/* The platform's own recorded reason, not this page's guess at one. */}
          {!url && evidence?.note ? (
            <Typography variant="caption" sx={{ display: 'block', mt: 1, color: observability.degraded }}>
              {evidence.note}
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

