/**
 * The demo's only door to Vision OS.
 *
 * Everything on screen arrives through one of these calls. There is no other
 * source of truth in the application — no local model, no cached inference, no
 * derived facts.
 *
 * Note what is absent, as in the Validation Console: no `updateObject`, no
 * `setAttribute`, no `deleteObservation`. Not disabled — never written, because
 * the Observation API exposes nothing to call. A demonstration application that
 * could write to Vision State would be demonstrating a platform that does not
 * exist.
 */

import type {
  ArchitectureReport,
  ComplianceResult,
  ComplianceStatus,
  CropIndex,
  EconomyReport,
  EvidenceView,
  FrameLedgerEntry,
  HealthReport,
  MediaAsset,
  MetricsResponse,
  ModelPanel,
  Observation,
  ObjectView,
  SessionDescription,
  StateResult,
} from './types';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The harness is unreachable — no platform was contacted at all. */
export const UNREACHABLE = 'PLATFORM_UNREACHABLE';

/**
 * Records per observation page, and how many pages will be drained.
 *
 * 1000 is the platform's own `max_page_size`, so this asks for the largest page
 * it will serve. The ceiling then bounds a pathological session rather than a
 * normal one: 40 pages is 40,000 observations, far beyond any replay this
 * application opens, and reaching it is reported rather than assumed away.
 */
export const OBSERVATION_PAGE_SIZE = 1000;
export const MAX_OBSERVATION_PAGES = 40;

export function isUnreachable(error: unknown): boolean {
  return error instanceof ApiError && error.code === UNREACHABLE;
}

export class VisionOsClient {
  constructor(
    private readonly baseUrl = '',
    private readonly fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/v1${path}`, {
        ...init,
        headers: {
          'X-VOS-Accept-Major': '1',
          ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
          ...(init.headers ?? {}),
        },
      });
    } catch (cause) {
      throw new ApiError(
        UNREACHABLE,
        'Vision OS platform service is not responding. Start the harness with ' +
          '`python -m vosvc_harness`.',
        true,
        0,
      );
    }

    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }

    if (!response.ok) {
      // A failure with no platform envelope did not come from the platform. The
      // dev proxy answers 500 with an empty body when the harness is down, and
      // that is a connection failure, not a Vision OS failure.
      if (body === null && response.status >= 500) {
        throw new ApiError(
          UNREACHABLE,
          'Vision OS platform service is not responding.',
          true,
          response.status,
        );
      }
      const envelope = body as { code?: string; message?: string; retryable?: boolean } | null;
      throw new ApiError(
        envelope?.code ?? 'INTERNAL',
        envelope?.message ?? `HTTP ${response.status}`,
        envelope?.retryable ?? false,
        response.status,
      );
    }

    // The harness answers 200 with an error envelope for "no session yet",
    // which is a state rather than a failure. Surfacing it as typed keeps it
    // distinguishable from an empty result.
    const envelope = body as { code?: string; message?: string; retryable?: boolean } | null;
    if (envelope && typeof envelope.code === 'string' && typeof envelope.retryable === 'boolean') {
      throw new ApiError(envelope.code, envelope.message ?? '', envelope.retryable, 200);
    }

    return body as T;
  }

  private get<T>(path: string): Promise<T> {
    return this.call<T>(path, { method: 'GET' });
  }

  private post<T>(path: string, body?: unknown): Promise<T> {
    return this.call<T>(path, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  // --- platform ----------------------------------------------------------- //

  health(): Promise<HealthReport> {
    return this.get('/health');
  }

  architecture(sessionId?: string): Promise<ArchitectureReport> {
    return this.get(`/architecture${qs({ session_id: sessionId })}`);
  }

  metrics(sessionId?: string): Promise<MetricsResponse> {
    return this.get(`/metrics${qs({ session_id: sessionId })}`);
  }

  model(sessionId?: string): Promise<ModelPanel> {
    return this.get(`/model${qs({ session_id: sessionId })}`);
  }

  economy(sessionId?: string): Promise<EconomyReport> {
    return this.get(`/economy${qs({ session_id: sessionId })}`);
  }

  // --- media and sessions -------------------------------------------------- //

  listMedia(): Promise<{ media: MediaAsset[]; capabilities: HealthReport['media'] }> {
    return this.get('/media');
  }

  uploadMedia(file: File): Promise<MediaAsset> {
    const form = new FormData();
    form.append('file', file);
    return this.call('/media', { method: 'POST', body: form });
  }

  listSessions(): Promise<{ sessions: SessionDescription[] }> {
    return this.get('/sessions');
  }

  getSession(id: string): Promise<SessionDescription> {
    return this.get(`/sessions/${encodeURIComponent(id)}`);
  }

  createSession(body: {
    media_id: string;
    target_fps?: number;
    semantics?: 'archival' | 'realtime';
    autostart?: boolean;
    max_frames?: number;
  }): Promise<SessionDescription> {
    return this.post('/sessions', body);
  }

  transport(
    id: string,
    action: 'play' | 'pause' | 'step' | 'seek' | 'speed' | 'restart',
    detail: Record<string, unknown> = {},
  ): Promise<SessionDescription> {
    return this.post(`/sessions/${encodeURIComponent(id)}/transport`, { action, ...detail });
  }

  /**
   * Close a session and release the Vision OS instance behind it.
   *
   * Note what this is not. It deletes a *replay session* — a video source and
   * the platform instance reading it — and touches no observation, no object
   * and no attribute. The Observation API still exposes nothing to write; a
   * session is the harness's own transport lifecycle, and the counterpart of
   * `createSession` rather than an exception to the rule above.
   *
   * It exists because the alternative is worse: each session holds its own
   * booted platform, and understanding is served by one model instance. Left
   * open, abandoned sessions go on asking that model, and a new session queues
   * behind every one of them until its calls time out.
   */
  closeSession(id: string): Promise<unknown> {
    return this.call(`/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  frameLedger(id: string, limit = 2000): Promise<{ entries: FrameLedgerEntry[]; total: number }> {
    return this.get(`/sessions/${encodeURIComponent(id)}/frames${qs({ limit })}`);
  }

  /** Off unless the deployment enables it. Requires a declared purpose. */
  frameUrl(id: string, index: number, purpose: string): string {
    return `${this.baseUrl}/api/v1/sessions/${encodeURIComponent(id)}/frames/${index}${qs({ purpose })}`;
  }

  // --- retained crops -------------------------------------------------------- //
  //
  // The image a model was actually asked about, when the deployment's retention
  // policy allowed it to be kept. `ephemeral` and `never_persist` crops are not
  // written at all, so an empty index is a policy outcome rather than a fault —
  // which is why the index reports what it refused.

  crops(sessionId: string): Promise<CropIndex> {
    return this.get(`/crops${qs({ session_id: sessionId })}`);
  }

  /** Requires a declared purpose, exactly as frame access does. */
  cropUrl(cropId: string, purpose: string, sessionId?: string): string {
    return `${this.baseUrl}/api/v1/crops/${encodeURIComponent(cropId)}${qs({
      purpose,
      session_id: sessionId,
    })}`;
  }

  // --- the Observation API ------------------------------------------------- //
  //
  // There was a `startNarration`/`narration` pair here that asked the platform
  // service to caption whole frames with the VLM. It has been removed, and the
  // methods below are what replaced it: every sentence the UI shows is now
  // rendered from observations the platform recorded, so there is exactly one
  // way for a model answer to reach the screen and it runs through P15.

  queryState(sessionId: string | null): Promise<StateResult> {
    return this.post('/state/query', {
      session_id: sessionId,
      filter: { lifecycle: ['active', 'occluded', 'provisional'] },
      options: { include_trajectory: true, include_provenance: true, limit: 200 },
    });
  }

  /**
   * Every observation in the window, following the platform's cursor.
   *
   * **The page is not the answer.** `query_observations` orders by `t_capture`
   * and returns the first `limit` records with a cursor for the rest, and this
   * method used to ask for 500 and ignore the cursor entirely. That is not a
   * partial read that degrades gracefully — it is a *chronological* truncation.
   * The 500 oldest observations of a session are the opening seconds of the
   * video, so a viewer built on this saw a timeline that simply stopped, at a
   * point determined by how talkative the first few frames happened to be.
   *
   * Paging to exhaustion is what makes "the timeline covers the video" a
   * property of the data rather than a coincidence of its size.
   *
   * `truncated` reports the one case that remains: a session so long it exceeds
   * `MAX_OBSERVATION_PAGES`. The caller can say so. It is never silent, because
   * silence here is the bug being fixed.
   */
  async queryObservations(
    sessionId: string | null,
    window: { start_ns: number; end_ns: number },
  ): Promise<{
    observations: Observation[];
    window_fully_observable: boolean;
    truncated: boolean;
  }> {
    const observations: Observation[] = [];
    let cursor: string | null = null;
    let fullyObservable = true;
    let truncated = true;

    for (let page = 0; page < MAX_OBSERVATION_PAGES; page += 1) {
      const body: {
        observations?: Observation[];
        cursor?: string | null;
        window_fully_observable?: boolean;
      } = await this.post('/observations/query', {
        session_id: sessionId,
        window,
        limit: OBSERVATION_PAGE_SIZE,
        ...(cursor ? { cursor } : {}),
      });

      observations.push(...(body.observations ?? []));
      fullyObservable = fullyObservable && body.window_fully_observable !== false;
      cursor = body.cursor ?? null;
      if (!cursor) {
        truncated = false;
        break;
      }
    }

    return { observations, window_fully_observable: fullyObservable, truncated };
  }

  getObject(objectId: string, sessionId?: string): Promise<ObjectView> {
    return this.get(`/objects/${encodeURIComponent(objectId)}${qs({ session_id: sessionId })}`);
  }

  getEvidence(blobRef: string, purpose: string, sessionId?: string): Promise<EvidenceView> {
    return this.get(
      `/evidence/${encodeURIComponent(blobRef)}${qs({ purpose, session_id: sessionId })}`,
    );
  }

  verifyReplay(sessionId?: string): Promise<Record<string, unknown>> {
    return this.post('/replay/verify', { session_id: sessionId });
  }

  /**
   * Whether this session can evaluate rules, and what they depend on.
   *
   * Worth reading before the findings themselves: an empty finding list means
   * "nothing is wrong" only when rules are actually loaded, and means "nothing
   * was evaluated" when they are not. Those are opposite facts.
   */
  complianceStatus(sessionId?: string): Promise<ComplianceStatus> {
    return this.get(`/compliance/status${qs({ session_id: sessionId })}`);
  }

  /**
   * Evaluate every rule against current Vision State.
   *
   * The evaluation happens on the platform side. This method sends a session id
   * and receives decided findings — it passes no rule, no threshold and no
   * observation, because the browser holds none of those and must not.
   */
  compliance(sessionId?: string, limit = 200): Promise<ComplianceResult> {
    return this.post('/compliance/evaluate', { session_id: sessionId, limit });
  }
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

export const client = new VisionOsClient();
