# Optional AI reading with TypeLLM

FormFill reads bills with built-in text rules by default (CPU only, no setup). For messy photos, handwriting and
unusual layouts you can add **[TypeLLM](https://github.com/TypeLLM/TypeLLM)** (Apache-2.0): type-safe decoding on
an open model **you host yourself**, so documents never leave your infrastructure.

## What it adds
| | Built-in rules | With TypeLLM |
|---|---|---|
| Reads | OCR text | OCR text **and the photo itself** (vision model) |
| Output | regex guesses | guaranteed types: number, date text, one of the 12 document types |
| "Not printed" | may pick a wrong number | returns **null**, so the rules value (or the person) fills in |
| Speed | ~1 s / document | depends on GPU; the 7 questions share one cached context and run as a batch |

Every AI answer is **cross-checked** with the rules reading. Where both found a bill no., date or amount and they
differ, the field is highlighted for review. If the AI server is down or slow, FormFill falls back to the rules
automatically and says so.

## Setup
1. **A GPU server with SGLang** serving a compatible model. TypeLLM's README lists Qwen3.5-4B / 9B (tested) and
   larger Qwen models; a vision-capable checkpoint is needed to read photos directly.
   ```bash
   pip install sglang   # see the SGLang docs for your CUDA version
   python -m sglang.launch_server --model-path Qwen/Qwen3.5-9B --port 30000
   ```
2. **Install TypeLLM in FormFill** (pinned commit):
   ```bash
   pip install -r backend/requirements-typellm.txt            # local
   docker compose build --build-arg WITH_TYPELLM=1             # Docker image
   ```
3. **Point FormFill at it:**
   ```bash
   TYPELLM_URL=http://gpu-box:30000
   TYPELLM_MODEL=Qwen/Qwen3.5-9B
   TYPELLM_VISION=1          # send photos to the model (0 = OCR text only)
   TYPELLM_TIMEOUT=60
   ```
   `GET /api/features` then reports `"engine": "typellm"`, and the Documents window shows "Reading with AI".

## Cost and hosting
Cloud Run's scale-to-zero pricing applies to FormFill itself; a GPU model server is a separate, always-on (or
scheduled) machine and costs far more. Sensible options: a GPU box already available in the company, a small
GPU VM switched on only during claim season, or staying on the built-in rules, which handle printed bills well.

## Privacy
TypeLLM runs on your model server; nothing is sent to an AI provider. FormFill still keeps no documents: files are
read in memory for the request and discarded.

## Tests
`backend/tests/test_typellm.py` validates the questions with TypeLLM's own schema compiler and tests merging,
review flags and fallback with a stand-in client. Accuracy on a real model depends on the model you serve:
try it on a handful of your own bills before relying on it.
