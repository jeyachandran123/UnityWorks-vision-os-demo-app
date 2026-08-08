# UnityWorks Vision OS — Demonstration Application

### Delivery Reports 1–10

**Date:** 2026-08-06 · **Subject:** first official demonstration product
**Platform:** Vision OS v1, Flows 1–8, **unmodified** (193 files, hash-verified, git-clean)

Every figure in these reports was measured on the delivery machine — an Intel
Core 5 210H, 12 threads, 15.5 GB RAM, **no GPU**. Where a number is
disappointing it appears anyway.

---

## 1. Demo Architecture Report

Three processes, two of which already existed.

```
 CCTV .mp4                                  ┌──────────────────────────┐
     │                                      │  Ollama (localhost)      │
     ▼                                      │  qwen2.5vl:7b            │
┌──────────────────────────────┐            └────────────▲─────────────┘
│  Platform Service :8808      │                         │ HTTP, loopback
│  (validation-console harness)│                         │
│                              │   ┌─────────────────────┴──────────┐
│  ┌────────────────────────┐  │   │ QwenVisionUnderstander (P15)   │
│  │ Vision OS — UNMODIFIED │◄─┼───┤ sibling adapter, bound at      │
│  │ L0 ─────────────► L7   │  │   │ composition time               │
│  └────────────────────────┘  │   └────────────────────────────────┘
└───────────┬──────────────────┘
            │ REST + WebSocket   ← the only coupling
            ▼
┌──────────────────────────────┐
│  Demonstration App :5280     │  React · TS · Vite · MUI
│  9 pages, no reasoning       │
└──────────────────────────────┘
```

**Why the platform service is reused rather than rebuilt.** It is already the
Vision OS gateway: an HTTP/WS transport over the public `ObservationApi` plus
P1/P2 acquisition adapters, with 78 passing tests. Writing a second one would
have duplicated the only component that touches the platform, and doubled the
surface where a boundary could be broken. One gateway, two consumers — the
engineering console and this product.

**What is new in this delivery:**

| Component | Location | Purpose |
|---|---|---|
| `QwenVisionUnderstander` | `harness/vosvc_harness/adapters/qwen_vision.py` | P15 adapter over local Ollama |
| Attribute vocabulary + prompt pack | `harness/vosvc_harness/assembly.py` | 4 registered attributes, 2 prompts |
| `/api/v1/model`, `/api/v1/economy` | `harness/vosvc_harness/routes/model.py` | Model transparency + economy counters |
| Demonstration application | `vision_os_demo/` | 9-page commercial dashboard |

---

## 2. Vision OS Integration Report

**Vision OS was not modified.** Verified two independent ways, re-run at delivery:

```
$ python scripts/verify_untouched.py
[vision_os]  193 files hashed — manifest matches — git: CLEAN
[frontend]   104 files hashed — manifest matches — git: CLEAN
RESULT: PASS — nothing was modified
```

### Integration points, all public

| Seam | Mechanism | Constitutional basis |
|---|---|---|
| Model binding | `build_understanding_layer(understanders=[qwen])` | P15 — adapters are passed in, never named by string |
| Video ingress | `SourceBindings(source=…, decoder=…)` via `bindings_factory` | P1/P2 — *"sibling adapters… no platform module changes"* |
| Reads | `ObservationApi.query_state / query_observations / coverage` | M14 — the platform's only external surface |
| Live stream | `ObservationApi.subscribe` | 09_API §3 |
| Observability | Event Bus `subscribe(None).drain()`, Metrics Engine, Health Monitor | M19/M20/M21 |

Two seams are assigned through a private attribute — `tracking.runtime._sink`
and `platform.runtime._admitted_consumer`. These are the documented Flow 3/4 and
Flow 2 seams, and Vision OS's own end-to-end suite assigns them identically,
each annotated `# noqa: SLF001 - the declared seam`. Both sites are marked.

### Boundaries held

- **No write path.** `PUT`/`PATCH` appear nowhere; no mutating method exists on
  the client to call. Enforced by `tests/boundaries.test.ts`.
- **No vision reasoning in the app.** No classify, no detect, no track, no
  embedding, no IoU. Enforced by test.
- **No direct model access from the app.** The demo cannot reach Ollama — the
  string `11434` does not appear in `src/`. Enforced by test.

---

## 3. Qwen Vision Adapter Report

`understander.qwen_vl` implements P15 against `qwen2.5vl:7b` served by local
Ollama. **Everything executes on the machine**; `data_residency` is `"local"`,
which is what allows a site with a residency policy to bind it at all.

### The seven obligations

| # | Obligation | Implementation |
|---|---|---|
| U1 | Only schema-declared fields | `_split_by_schema` — extras go to `unparsed`, never dropped |
| U2 | **Never fabricates on failure** | timeout / refusal / unparseable each return an explicit result with `structured={}` |
| U3 | `raw_output` verbatim | model bytes preserved on every path |
| U4 | Self-reported confidence | `field_confidence` 0.80, surfaced as `calibrated: false` |
| U5 | Stateless | `/api/generate` with no `context`, no history |
| U6 | No business interpretation | renders the prompt it was given |
| U7 | Cost estimable pre-call | `estimate_cost` → `cost_class 1.0` |

U2 is the one that matters most. §P15 calls fabrication *"the single most
dangerous failure mode for a VLM-based system, because fabricated output is
indistinguishable from real output downstream."* A timeout returns an empty
structured map with the reason attached — never a plausible `"standing"`.

### Measured behaviour

| | |
|---|---|
| Cold start (model load) | **141 s** — measured once, excluded from percentiles |
| Warm p50 | **13.5 s** |
| Warm p95 | 15.4 s (steady state), 151.7 s when a cold call is included |
| Prompt tokens | ~1,096 per call, constant for crops ≤ 224 px |
| Determinism | identical input → identical output, verified |
| Dependencies added | **none** — PNG encoding is hand-rolled zlib |

### Verified output, real footage

From `mixkit-street-with-people-walking-at-dusk`, 1280×720:

```
carrying_object   = 'bag'       conf=0.80 uncalibrated  ev=…SBSN8XVBPQ
lower_body_colour = 'black'     conf=0.80 uncalibrated  ev=…SBSN8XVBPQ
posture           = 'standing'  conf=0.80 uncalibrated  ev=…SBSN8XVBPQ
upper_body_colour = 'blue'      conf=0.80 uncalibrated  ev=…SBSN8XVBPQ
```

All four registered attributes, with evidence references, from a real model
looking at real CCTV.

### The vocabulary, and what it excludes

Four attributes registered, each with a justification about **pixels**:
`posture`, `upper_body_colour`, `lower_body_colour`, `carrying_object`.

Deliberately absent: `is_loitering`, `is_authorised`, `looks_suspicious`. Those
would be refused by the platform's attribute registry — the Semantic Ceiling's
first gate. `carrying_object` sits closest to the line and stays on the right
side of it: *an object is visibly held* is an observation; *carrying stolen
goods* is not, and could not be registered.

---

## 4. Frontend Architecture Report

```
src/
├── api/         client · types · provider (WS + bounded ring) · hooks
├── layout/      Shell — sidebar, session control, model banner
├── pages/       9 pages
├── components/  primitives · PipelineStrip
├── insights/    the demonstration business layer
├── narrative/   deterministic observation → English
└── theme/       commercial identity + the observability palette
```

**One door.** `VisionOsClient` is the only network surface. Everything on screen
traces to a call in that file; there is no second source of truth.

**Batching.** Tap messages arrive faster than React should render, so the
provider buffers and flushes on `requestAnimationFrame`. Nothing is dropped —
every message reaches the ring before the frame fires.

**Bounded.** 4,000 messages per channel. A demo left running on stage must not
become a memory leak.

**Absence stays unambiguous.** `<EmptyState>` (the platform looked and found
nothing) and `<Unavailable>` (the platform could not be asked) are different
components with different words. That is V8, and it is the one piece of
engineering discipline that had to survive into a customer-facing product.

---

## 5. Dashboard Feature Report

| Page | Shows | Source |
|---|---|---|
| **Dashboard** | Headline metrics, the economy argument, live pipeline, business insights, coverage | state + economy + model + taps |
| **Live Cameras** | Video stage, bounding boxes, track labels, lifecycle colour | `ObjectView.spatial` (normalized) |
| **Objects** | One card per object: lifetime, region, attributes, confidence, evidence | Vision State |
| **Observations** | Live feed in **Narrative / Structured / Raw JSON** | M14 subscription |
| **Vision State** | Current world: status, lifetime, attributes, evidence count, completeness | `query_state` |
| **Timeline** | Chronological platform events, labelled not interpreted | Event Bus + observations |
| **Evidence** | Evidence IDs, attribute, object, camera, capture time, confidence | attribute `evidence_ref` |
| **Performance** | Per-module metrics from the closed vocabulary | Metrics Engine |
| **Model** | Bound adapter, latency, refusals, residency, capabilities, economy | `/api/v1/model` |

**The honesty banner.** If the bound adapter is not `understander.qwen_vl`, a
persistent warning appears app-wide stating that attributes are constants rather
than model output. A demo that displayed "Qwen Vision" while a static head
answered would be the single most dishonest thing this product could do.

---

## 6. Business Demonstration Report

The insight layer lives in `src/insights/insights.ts`, **in the frontend**,
because the platform refuses to host it.

```
Vision OS says:   person · standing · carrying bag · tracked 42.0 s · active
Demo layer says:  "Person is present in the service area and is standing,
                   carrying a bag."
                  cited: class_id · lifecycle · first_seen→last_seen ·
                         attributes.posture · attributes.carrying_object
```

Three verticals ship — Restaurant, Warehouse, Retail — differing only in
**consumer-side thresholds** (120 s / 60 s / 30 s). Those numbers are displayed
as demo parameters and labelled *"set by the vertical, not by Vision OS"*.
Surfacing them is the clearest way to show where the boundary runs: the platform
supplied the seconds, a vertical supplied the opinion about how many matter.

Four rules, each enforced by test:

1. Every insight cites the observations it came from — an insight with no
   citation cannot be constructed.
2. No thresholds invented in the layer; per-vertical values prove they are not
   platform constants.
3. Nothing asserted the platform did not report.
4. Deterministic — same objects in, same insights out, independent of arrival
   order.

A vocabulary test fails the build on `suspicious`, `violation`, `unauthorised`,
`theft`, `lazy`, `alert`, `risk`, `breach`.

---

## 7. Performance Report

Measured, CPU-only, no GPU.

| Stage | Measurement |
|---|---|
| Video decode (PyAV, 720p) | ~0.07 s/frame, lazy — on session open only |
| Media library discovery | **0.39 s** for 6 assets (header probe only) |
| Detection · tracking · registry | sub-millisecond; not the bottleneck |
| **Understanding (Qwen, warm)** | **13.5 s p50** — the bottleneck by three orders of magnitude |
| Model cold start | 141 s, one-off |
| Session open (incl. warm + conformance gate) | **387 s** — see Limitation 1 |
| Observation build → Vision State | sub-millisecond |

### Economy, measured on the delivery run

```
frames processed : 2        objects tracked : 1
naive model calls: 2        actual: 1        binding-time: 9 (excluded)
reduction        : 2.0×
```

**This number is small and the reason is stated rather than hidden.** The
reduction factor grows with frame count — it is `frames × objects ÷ actual
calls`, and only two frames had been processed when the measurement was taken.
The mechanism is real (understanding is triggered, demand-filtered,
quality-gated and deduplicated); the *demonstration* of it is weak on this
hardware because the pipeline cannot get far enough into the video. See
Limitation 2.

---

## 8. Testing Report

| Suite | Count | Covers |
|---|---|---|
| Harness — contract | 14 | Serialization; the `Instant`/`Duration` discriminator |
| Harness — faults | 20 | 11 scenarios; verdict logic; no false passes |
| Harness — HTTP | 30 | Wire contract through the real FastAPI app |
| Harness — integration | 14 | Full L0–L7 against real Vision OS |
| **Harness total** | **78 passed** | |
| Demo — insights | 11 | Citation, determinism, threshold ownership, vocabulary |
| Demo — boundaries | 11 | No backend imports, no reasoning, no model access, no writes |
| **Demo total** | **22 passed** | |
| Typecheck | clean | |
| Build | ok | |

### Defects found and fixed during this delivery

1. **Eager decode.** `MediaLibrary` decoded every discovered video at startup —
   four HD files ≈ 4 GB before a session existed, on a 15.5 GB machine also
   holding a 5.8 GB model. Now header-probe at discovery, decode on session
   open. Discovery went 1.95 s → 0.39 s.
2. **VLM blocking the API loop.** M9 calls `understand_batch` synchronously; a
   13 s HTTP call froze acquisition, detection **and** every REST route
   together. The pipeline now runs on its own thread with its own event loop.
3. **Boot paying the cold start twice.** The P15 conformance gate makes real
   inference calls; against a cold model each was 141–210 s. Warming before
   binding cut session open from 348 s to 116 s in isolation.
4. **Economy counter lying.** Conformance-gate probes were counted as perception
   spend, making the platform look *more* expensive than a naive pipeline. Now
   tracked separately as `binding_time_calls`.
5. **Prompt rejected at load.** Literal JSON braces in a template are read as
   format placeholders by the platform's validator. Rewritten without braces —
   constrained decoding is what guarantees JSON anyway.

---

## 9. Known Limitations

Stated plainly. Each is real and none is worked around silently.

**1. Session open takes ~387 s with Qwen bound.** The P15 conformance kit makes
several real inference calls to prove the adapter never fabricates. That gate is
correct and valuable — it is what catches an adapter that invents attributes
under load — but at 13.5 s per call it dominates startup. *Mitigation for a live
demo: open the session before the audience is in the room.* A proper fix is a
fast-path conformance mode for expensive adapters, which is a Vision OS change
and therefore out of scope here.

**2. Pipeline throughput is very low with the VLM in the loop.** M9 invokes the
understander synchronously on the pipeline loop, so perception advances only
between model calls. On the delivery run, 2 frames were processed in ~2 minutes.
Isolating the pipeline thread fixed API responsiveness but not pipeline
throughput. A true fix requires understanding to be genuinely asynchronous
relative to perception — Vision OS models this (M9 owns a queue and a
concurrency limit), but the adapter call itself is synchronous by protocol.
**On a GPU this largely disappears** (13.5 s → sub-second), and the architecture
is unchanged.

**3. No GPU on the delivery machine.** Every latency figure would improve by
roughly an order of magnitude with CUDA. `ollama ps` reports `100% CPU`.

**4. The detector is the reference detector, not YOLO.** Detections are
scripted, so bounding boxes are representative rather than true object
positions. Understanding runs on the crops those boxes produce, so **the model's
answers are real** — but the framing of what it looks at is not. Binding
`detector.yolo` is a configuration change that touches nothing in this delivery.

**5. Frame serving is off by default (V12).** The Live Cameras page shows
geometry without imagery unless `VOSVC_SERVE_FRAMES=1`. This is deliberate; for
a customer demo you will likely want it on, with a declared purpose.

**6. The narrative renderer is duplicated** between the validation console and
this app. Two copies of a pure function is the price of two independently
deployable products; a shared package would be better and is on the roadmap.

**7. Single camera per session.** Multi-camera partitioning is visible in the
state snapshot but has not been driven.

**8. `region` is not populated on object cards.** The brief's example shows
`Region: Entrance`. Region transitions require configured region geometry the
object actually crosses; the demo configures one full-frame region, so no
transitions fire. The field is wired and would populate with real site geometry.

---

## 10. Future Production Roadmap

**Immediate — makes the demo land better**

| Item | Effort | Impact |
|---|---|---|
| Run on a CUDA machine | config | 13.5 s → <1 s; removes Limitations 2 and 3 |
| Bind `detector.yolo` | config + weights | Real object positions; removes Limitation 4 |
| Configure real site regions | config | Region cards and dwell insights populate |
| Pre-opened demo session | ops | Hides the 387 s conformance gate |

**Near term — product hardening**

- **Fast-path conformance for expensive adapters.** A Vision OS change: allow
  the P15 kit to gate on a cached probe for adapters declaring `cost_class ≥ 1.0`.
- **Batched understanding.** Qwen accepts batches; the adapter declares
  `supports_batching: false` today because Ollama serves one instance. A batching
  server would amortise the ~1,096-token prompt overhead across objects.
- **Specialized heads for hot attributes.** 11_PERFORMANCE §7's migration:
  the VLM discovers an attribute, its evidence trains a small head, the head
  takes over. `cost_class` 1.0 → 0.01, and it is a routing change only.
- **Shared narrative package** to remove the duplication in Limitation 6.

**Medium term**

- Multi-camera sessions and cross-camera coverage reporting.
- Evidence gallery with real crop rendering, behind the existing purpose gate.
- Regression reporting across demo runs, reusing the console's diff machinery.
- Temporal understanding (Phase 3) — the P15 contract already admits crop
  sequences; `supports_temporal` is false today, honestly.

**What must never change**

The four boundaries this delivery was built to prove:

1. Vision OS stays unmodified — adapters are the extension mechanism.
2. The application performs no vision reasoning.
3. Business interpretation stays on the consumer side.
4. Absence stays explicit — "did not see" is never rendered as "nothing there".

---

## Standing verdict

The demonstration application is **functional and honest**: real CCTV footage
enters a P1 adapter, travels an unmodified Vision OS, is understood by a real
local Qwen2.5-VL through P15, and reaches a commercial dashboard as structured
observations with provenance and evidence.

It is **not yet a smooth stage demo on this hardware.** Limitations 1 and 2 are
material: a 387-second session open and a pipeline that advances a few frames
per minute will not hold a room. Both are hardware-bound rather than
architectural, and both are removed by a GPU.

**The Vision OS Constitution always wins.** Where this application and the
architecture disagree, the architecture is right and this application has a bug.
