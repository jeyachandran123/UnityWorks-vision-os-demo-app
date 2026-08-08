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

  frameLedger(id: string, limit = 2000): Promise<{ entries: FrameLedgerEntry[]; total: number }> {
    return this.get(`/sessions/${encodeURIComponent(id)}/frames${qs({ limit })}`);
  }

  /** Off unless the deployment enables it. Requires a declared purpose. */
  frameUrl(id: string, index: number, purpose: string): string {
    return `${this.baseUrl}/api/v1/sessions/${encodeURIComponent(id)}/frames/${index}${qs({ purpose })}`;
  }

  // --- the Observation API ------------------------------------------------- //

  queryState(sessionId: string | null): Promise<StateResult> {
    return this.post('/state/query', {
      session_id: sessionId,
      filter: { lifecycle: ['active', 'occluded', 'provisional'] },
      options: { include_trajectory: true, include_provenance: true, limit: 200 },
    });
  }

  queryObservations(
    sessionId: string | null,
    window: { start_ns: number; end_ns: number },
  ): Promise<{ observations: Observation[]; window_fully_observable: boolean }> {
    return this.post('/observations/query', { session_id: sessionId, window, limit: 500 });
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
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

export const client = new VisionOsClient();
