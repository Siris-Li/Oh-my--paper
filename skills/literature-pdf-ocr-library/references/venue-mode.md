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
3. **Topic filter**: a simple substring match over `title + abstract` against the keyword
   set in `literature_lib.TOPIC_KEYWORDS`. Survivors are marked `topic_match=True`.
   Pass `--no-topic-filter` to skip this stage and keep every paper in the venue.
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

## IEEE bucket (institutional login required)

IEEE Xplore is not open access. The flow relies on the user's institutional
subscription + their logged-in Chrome. Claude does the relevance triage and the
PDF fetch; the human only logs in.

### Step 1 — Claude writes `ieee_review.md` (relevance triage)

Before downloading, annotate every IEEE entry with a one-line summary and a tier
(`HIGH` / `MED-H` / `MED` / `LOW`) so the download scope matches the research
direction. Example structure per paper:

```markdown
### N. Paper Title
DOI: 10.1109/ISCA59077.2024.00088 | kw: {matched topic keywords}
> One-line what-it-does summary.

**{HIGH|MED-H|MED|LOW}** — {why relevant / why not}. → {DOWNLOAD | SKIP}
```

A summary block at the end lists the DOWNLOAD set grouped by tier. Claude writes
this autonomously from OpenAlex abstracts — it does not need user approval per paper.

From the DOWNLOAD set, emit `ieee_download_queue.json` with the same schema as
`acm_download_queue.json` (`paper_slug / doi / target_path`).

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

## Relevance filter semantics

`TOPIC_KEYWORDS` is intentionally coarse — it is a first-pass recall filter, not a
precision filter. The downstream `ieee_review.md` / manual skim pass does the fine-
grained call. If you need to adjust keywords for a new research direction, edit
`literature_lib.TOPIC_KEYWORDS` and re-run; each kept record carries its
`topic_match_kw` field showing which keyword hit, which helps debug false positives.

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

- `search_results.json` — full run log including `mode=venues`, `bucket_counts`, errors.
- `acm_download_queue.json` — queue for the ACM batch downloader.
- `ieee_manifest.md` — human-readable IEEE list; Claude expands this into
  `ieee_review.md` + `ieee_download_queue.json` before downloading.
- `papers/<slug>/metadata.json` — per-paper record with `bucket`, `pdf_status`,
  `topic_match_kw`, DBLP + OpenAlex fields.
- `papers/<slug>/paper.pdf` — only present once that bucket's downloader has run.

After PDFs land, run the normal OCR + index pipeline over `papers/*/paper.pdf`
as with the other modes.
