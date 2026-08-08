# UnityWorks Vision OS — Demonstration Application

### The first official demonstration product for UnityWorks Vision OS

Real CCTV footage enters an unmodified Vision OS, is understood by a **local
Qwen2.5-VL**, and reaches a commercial dashboard as structured observations with
provenance and evidence.

```
 CCTV video  →  Vision OS (unmodified)  →  Qwen2.5-VL (local)  →  Observations
                                                                       ↓
                                                            Vision State → Insights
```

| | |
|---|---|
| **Vision OS** | v1, Flows 1–8, **not modified** — 193 files hash-verified, git-clean |
| **Model** | `qwen2.5vl:7b` via local Ollama. No cloud service is contacted. |
| **Coupling** | REST + WebSocket only. The app imports no backend code. |
| **Writes to Vision State** | None. There is no write path to disable. |

---

## Run it

Three processes.

```bash
# 1. Ollama with the vision model
ollama serve
ollama pull qwen2.5vl:7b

# 2. Platform service (Vision OS gateway + Qwen adapter)
cd ../vision_os_validation_console/harness
pip install -e ".[dev,av]"
python -m vosvc_harness                 # http://127.0.0.1:8808

# 3. This application
npm install
npm run dev                             # http://localhost:5280
```

Pick footage in the header, press **Start**, then **▶**.

> **First session takes several minutes.** The P15 conformance gate makes real
> inference calls to prove the adapter never fabricates, and on CPU each is
> ~13 s. Open the session before your audience is in the room. See
> [Known Limitations](docs/REPORTS.md#9-known-limitations).

To run without a model — CI, or a laptop without Ollama:

```bash
VOSVC_UNDERSTANDER=static python -m vosvc_harness
```

The app then shows a persistent banner saying attributes are constants, not
model output. It will not pretend otherwise.

---

## What the audience sees

| Page | Answers |
|---|---|
| **Dashboard** | What is happening, and *why not just send every frame to an LLM?* |
| **Live Cameras** | What the camera sees, with Vision OS geometry overlaid |
| **Objects** | One card per tracked object — attributes, confidence, evidence |
| **Observations** | The raw output, in Narrative / Structured / JSON |
| **Vision State** | The platform's current belief about the world |
| **Timeline** | Chronological events, labelled but never interpreted |
| **Evidence** | The justification behind each attribute |
| **Performance** | Per-module metrics from the platform's own vocabulary |
| **Model** | Which adapter is *actually* bound, and what it costs |

---

## The four boundaries this product exists to prove

**1. Vision OS was not modified.** Qwen is bound as a P15 sibling adapter through
`build_understanding_layer`. 06_PORTS is explicit that the platform is
*"genuinely indifferent to whether a 7-billion-parameter generalist or a
2-megabyte specialist answered."*

**2. The application performs no vision reasoning.** No classify, no detect, no
track, no embedding. It cannot even reach the model — `11434` does not appear in
`src/`. Enforced by `tests/boundaries.test.ts`.

**3. Business interpretation stays on the consumer side.** The insight layer
lives in this repo because the platform refuses to host it. Its thresholds are
labelled *"set by the vertical, not by Vision OS"*.

**4. Absence stays explicit.** "The platform looked and found nothing" and "the
platform could not be asked" are different components with different words.

---

## Verify it yourself

```bash
npm test                                            # 22 boundary + insight tests
npm run typecheck && npm run build
cd ../vision_os_validation_console/harness && pytest # 78 platform tests
cd .. && python scripts/verify_untouched.py          # proves Vision OS unchanged
```

---

## Reports

All ten delivery reports are in **[docs/REPORTS.md](docs/REPORTS.md)** —
architecture, integration, the Qwen adapter, frontend, features, business
demonstration, performance, testing, known limitations, and the production
roadmap.

The limitations section is worth reading before a customer demo. It is honest
about what this hardware cannot do.
