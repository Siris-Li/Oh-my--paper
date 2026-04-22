# Venue Mode (`--venues`)

Use when the user wants an exhaustive "accepted list" for a specific conference + year
rather than a free-text relevance search. Covers the ACM/IEEE-heavy architecture/EDA
top venues that public search APIs do not return cleanly.

Supported slugs: `isca-YYYY micro-YYYY hpca-YYYY asplos-YYYY mlsys-YYYY dac-YYYY iccad-YYYY`.

## Pipeline overview

```
DBLP venue:+year:    →   OpenAlex by-DOI       →   topic keyword filter    →   bucketing
(exhaustive list)        (abstracts)                (title+abstract substr)     (arxiv/acm/ieee/other)
```

1. **DBLP** returns the authoritative list of papers in the main program. The `venue`
   field is matched *case-insensitively and exactly* (after stripping `(N)` track-number
   suffixes) — DBLP's own `q=venue:ISCA` would otherwise match ISCAS (Circuits & Systems)
   and ISCAI. Do not weaken this filter.
2. **OpenAlex by-DOI** fills in abstracts (DBLP does not carry them). Abstracts are
   reconstructed from OpenAlex's `abstract_inverted_index`. Typical coverage 95%+ for
   2024/2025 ACM/IEEE papers.
3. **Topic filter**: a simple substring match over `title + abstract` against the
   project-specific keyword list loaded from `--topic-keywords-file PATH` (JSON;
   see *Topic keywords file* below). Survivors are marked `topic_match=True`.
   There is no built-in default keyword list — venue mode will refuse to run
   without either `--topic-keywords-file` or `--no-topic-filter`.
4. **arxiv title-match** (for the arxiv bucket): tries `ti:"{title}"` on the arxiv API.
   Guarded by `min_year = target_year - 1` plus a tightened token-overlap threshold —
   earlier versions matched 2010-era arxiv preprints to 2024 titles via 4 common words.
   Do not loosen these guards.
5. **Bucketing**:
   - `arxiv`: arxiv preprint resolved → auto-downloaded inline
   - `acm`: DOI prefix `10.1145/*` → written to `acm_download_queue.json`
   - `ieee`: DOI prefix `10.1109/*` → written to `ieee_manifest.md`
   - `other`: anything else → metadata-only, `pdf_status=unavailable`

The script writes `acm_download_queue.json` and `ieee_manifest.md` even with
`--download-pdfs` — those buckets are NOT downloaded by `search_and_download_papers.py`
itself. See the sections below for how to process them.

## ACM bucket (Cloudflare — Chrome CDP required)

`curl` / `requests` with any UA is blocked by Cloudflare at `dl.acm.org`. A real Chrome
session passes. Use the `web-access` skill's CDP proxy plus the companion scripts in
this skill:

1. Ensure the web-access proxy is running:
   ```bash
   node "C:/Users/SirisLi/.claude/plugins/cache/web-access/web-access/2.4.2/skills/web-access/scripts/check-deps.mjs"
   ```
2. Launch the local HTTP PUT receiver (bypasses CDP eval's return-size limit — PDFs
   stream through a local socket, not through JSON eval results):
   ```bash
   python .claude/skills/literature-pdf-ocr-library/scripts/pdf_recv.py \
     <corpus>/acm_download_queue.json 9876 &
   ```
3. Kick off the batch. Reuses a single Chrome tab; opens the ACM landing page
   (`/doi/X`, NOT `/doi/pdf/X` — the PDF-viewer tab has a fragile JS context), then
   fetches `/doi/pdf/X` with `credentials:"include"`, PUTs the blob to `:9876/{slug}`:
   ```bash
   python .claude/skills/literature-pdf-ocr-library/scripts/download_acm_batch.py \
     <corpus>/acm_download_queue.json
   ```
4. Kill the receiver when done.

The target paths in `acm_download_queue.json` are absolute; the receiver writes each
PDF to the slug it registered at startup, so re-running after partial success is safe.

## Relevance review (all buckets)

Venue mode's topic filter is a coarse substring recall pass — any paper whose
title or abstract contains one of the keywords survives. After all downloads
finish (arxiv / acm / ieee), Claude must do a precision pass that rates every
kept paper at one of four tiers:

- **HIGH** — directly on the research direction, must read in depth
- **MED-H** — strongly related (same problem domain or same method), should read
- **MED** — related (same setting different question, or useful counter-example)
- **LOW** — weakly related or a keyword false positive; keep in `literature_bank`
  for traceability but do not read in depth

Workflow per corpus:

```bash
# 1. Emit the skeleton — lists every paper across all buckets, stable ordering.
python .claude/skills/literature-pdf-ocr-library/scripts/generate_review_template.py \
  <corpus>
# -> <corpus>/review.md (fails if already exists; use --force to overwrite)
```

Each paper block contains: title, bucket, DOI / arxiv id, matched topic
keyword, and the first 400 chars of the abstract. Claude then fills in three
placeholders per paper: **Summary** (one-line what-it-does), **Tier**
(HIGH / MED-H / MED / LOW), and **Why**. Claude also updates the Tier Summary
table at the top. This is done from OpenAlex abstracts without per-paper user
approval.

`literature_bank.md`'s `Relevance` column is populated from `review.md` tiers —
this is why arxiv/ACM/IEEE all need to go through the same pass instead of only
IEEE.

The IEEE download queue is derived from `review.md` rows whose bucket is `ieee`
and whose tier is HIGH / MED-H / MED (drop LOW). See IEEE section below.

## IEEE bucket (institutional login required)

IEEE Xplore is not open access. The flow relies on the user's institutional
subscription + their logged-in Chrome. Claude does the relevance triage via the
unified `review.md` step above; the human only logs in.

### Step 1 — derive `ieee_download_queue.json` from `review.md`

The relevance tiering happens in the cross-bucket `review.md` step (see
*Relevance review* above). For the IEEE batch downloader, filter that review
down to rows with `Bucket: ieee` and `Tier ∈ {HIGH, MED-H, MED}`, then emit
`ieee_download_queue.json` with the same schema as `acm_download_queue.json`:
`paper_slug / doi / target_path`. LOW-tier IEEE entries are skipped (kept as
metadata-only in the corpus).

### Step 2 — user logs in to Xplore

Ask the user to open `https://ieeexplore.ieee.org/` in their normal Chrome (the one
attached to the CDP proxy) and sign in via their institutional IP or OpenAthens.
One sample PDF click from the user confirms the session is good. No other manual
step is required.

### Step 3 — Claude runs the batch

```bash
python .claude/skills/literature-pdf-ocr-library/scripts/pdf_recv.py \
  <corpus>/ieee_download_queue.json 9876 &
python .claude/skills/literature-pdf-ocr-library/scripts/download_ieee_batch.py \
  <corpus>/ieee_download_queue.json
```

Key behaviors baked into `download_ieee_batch.py` (do not regress these):

- **One fresh tab per paper.** Reusing a single tab causes Xplore's APM bot-detection
  to progressively degrade and eventually return a challenge HTML instead of a PDF.
- **Navigate `https://doi.org/{doi}`**, let it redirect to `ieeexplore.ieee.org/document/{arnumber}`.
- **Poll `ready=="complete"` before fetching.** Issuing `fetch()` during an in-flight
  navigation produces `TypeError: Failed to fetch`. Fixed sleeps are fragile; poll for
  up to ~15 s then add a 1 s grace period.
- **Construct the PDF URL** as `https://ieeexplore.ieee.org/stampPDF/getPDF.jsp?tp=&arnumber={X}&ref={base64(landing_url)}`.
  The `ref` parameter must be a base64-encoded landing URL — naked `arnumber` links
  intermittently return the HTML viewer.
- **Fetch inside the browser tab** with `credentials:"include"` so session cookies
  flow, then PUT to the local receiver.
- 2.5 s between papers is polite and avoids rate-triggered challenges.

## Topic keywords file

The keyword list is **per-project**, not built-in. Venue mode is only meaningful
when a caller (typically an `omp` project) provides a `--topic-keywords-file`.
The skill no longer carries a default list.

Accepted JSON shapes for `--topic-keywords-file`:

```json
{
  "keywords": ["agent", "multi-agent", "llm serving", "kv cache", "cpu bottleneck", "tool use", "scheduling"],
  "source": "derived from project_truth.md research direction + preferredRoutes"
}
```

or a bare list:

```json
["agent", "multi-agent", "llm serving", "kv cache", "tool use"]
```

In `omp` projects the `/omp:survey` command writes this file to
`.pipeline/docs/topic_keywords.json` after the user confirms keywords extracted
from `project_truth.md` / `research_brief.json`.

### Fallback: no filter at all

Pass `--no-topic-filter` to keep every paper returned by DBLP for the venue+year
(no keyword match required). This is the only way to run venue mode without a
keywords file. There is no longer an implicit generic default — running venue
mode without either option exits with a non-zero status.

## Relevance filter semantics

The keyword list is intentionally coarse — it is a first-pass recall filter, not
a precision filter. The downstream `review.md` pass (see *Relevance review* above)
does the fine-grained call across all three buckets. Each kept record carries
its `topic_match_kw` field showing which keyword hit, which helps debug false
positives. To adjust keywords for a new research direction, edit the project's
`topic_keywords.json` and re-run.

## Known failure modes and the fixes in place

| Symptom | Root cause | Fix |
|---|---|---|
| DBLP returns 900+ for ISCA | substring match catches ISCAS/ISCAI | exact venue-string check after stripping `(N)` |
| arxiv bucket has 2010-era preprints | loose token-overlap match | `min_year = target_year - 1` + `max(4, 60% target) + max(4, 75% hit)` |
| ACM curl returns 403 Cloudflare HTML | Cloudflare bot check | CDP real-Chrome session only |
| CDP eval hangs on 3 MB base64 | eval return-size limit | local HTTP PUT receiver |
| IEEE batch first-N all `Failed to fetch` | fetch during in-flight nav | poll `ready=="complete"` |
| IEEE batch degrades after ~10 papers | Xplore APM tab fingerprinting | one fresh tab per paper |
| IEEE URL arnumber param lost | proxy URL-query parsing (`&` split) | Python `requests` uses `params=dict` (correct); curl needs `--data-urlencode` |

## Output artifacts

Per corpus under `--out-dir`:

- `search_results.json` — full run log including `mode=venues`, `bucket_counts`,
  the resolved `topic_keywords_file` path, the actual `topic_keywords` list, and errors.
- `acm_download_queue.json` — queue for the ACM batch downloader.
- `ieee_manifest.md` — human-readable IEEE list; after relevance review (below),
  Claude derives `ieee_download_queue.json` from `review.md` IEEE rows whose
  tier is HIGH / MED-H / MED.
- `review.md` — cross-bucket relevance review filled by Claude (one Tier per
  paper: HIGH / MED-H / MED / LOW). Produced from
  `scripts/generate_review_template.py`. Drives the Relevance column of
  `literature_bank.md` and the IEEE download subset.
- `papers/<slug>/metadata.json` — per-paper record with `bucket`, `pdf_status`,
  `topic_match_kw`, DBLP + OpenAlex fields.
- `papers/<slug>/paper.pdf` — only present once that bucket's downloader has run.

After PDFs land, run the normal OCR + index pipeline over `papers/*/paper.pdf`
as with the other modes.
