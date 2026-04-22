#!/usr/bin/env python3
"""Generate a per-corpus review.md skeleton covering every bucket.

Venue-mode's topic filter is only a substring recall filter. After downloads
finish, Claude must rate every kept paper (arxiv / acm / ieee / other) at one
of four tiers — HIGH / MED-H / MED / LOW — so that `literature_bank.md`'s
Relevance column is uniformly populated. This helper emits the skeleton.

Input:
    <corpus_dir>/
        search_results.json         (for topic_keywords + bucket_counts)
        papers/<slug>/metadata.json (one per paper)

Output:
    <corpus_dir>/review.md          (skeleton; existing file => error unless --force)

Claude fills in the per-paper Summary / Tier / Why, then edits the Tier Summary
table at the top.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

ABSTRACT_TRUNCATE = 400
BUCKET_ORDER = ("arxiv", "acm", "ieee", "other")


def _load_json(path: Path) -> Optional[object]:
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def _load_metadata(papers_dir: Path) -> List[Dict]:
    if not papers_dir.is_dir():
        return []
    records: List[Dict] = []
    for paper_dir in sorted(papers_dir.iterdir()):
        if not paper_dir.is_dir():
            continue
        meta = _load_json(paper_dir / "metadata.json")
        if isinstance(meta, dict):
            records.append(meta)
    return records


def _bucket_sort_key(rec: Dict) -> Tuple[int, str]:
    bucket = (rec.get("bucket") or "other").lower()
    try:
        bucket_idx = BUCKET_ORDER.index(bucket)
    except ValueError:
        bucket_idx = len(BUCKET_ORDER)
    title = (rec.get("title") or "").strip().lower()
    return (bucket_idx, title)


def _truncate_abstract(raw: Optional[str]) -> str:
    if not raw:
        return "(no abstract)"
    clean = " ".join(str(raw).split())
    if len(clean) <= ABSTRACT_TRUNCATE:
        return clean
    return clean[:ABSTRACT_TRUNCATE].rstrip() + "…"


def _paper_identifier(rec: Dict) -> str:
    """Best-effort stable identifier for a paper: prefer DOI, fall back to arxiv id."""
    doi = rec.get("doi")
    if doi:
        doi_str = str(doi).strip()
        if doi_str:
            if doi_str.startswith("http"):
                return doi_str
            return f"https://doi.org/{doi_str}"
    arxiv_id = rec.get("arxiv_id")
    if arxiv_id:
        aid = str(arxiv_id).strip()
        if aid:
            if aid.startswith("http"):
                return aid
            return f"https://arxiv.org/abs/{aid}"
    url = rec.get("url") or rec.get("landing_url")
    if url:
        return str(url).strip()
    return "(no identifier)"


def _derive_counts(records: List[Dict]) -> Dict[str, int]:
    counts: Dict[str, int] = {b: 0 for b in BUCKET_ORDER}
    for rec in records:
        b = (rec.get("bucket") or "other").lower()
        if b not in counts:
            counts[b] = 0
        counts[b] += 1
    return counts


def _derive_venue_year(search_results: Optional[Dict], records: List[Dict]) -> str:
    if isinstance(search_results, dict):
        venues = search_results.get("venues")
        if isinstance(venues, list) and venues:
            return " + ".join(str(v) for v in venues)
    if records:
        rec = records[0]
        venue = rec.get("venue") or ""
        year = rec.get("year")
        if venue and year:
            return f"{venue} {year}"
        if venue:
            return str(venue)
    return "(unknown corpus)"


def _derive_topic_keywords(search_results: Optional[Dict], records: List[Dict]) -> List[str]:
    if isinstance(search_results, dict):
        kws = search_results.get("topic_keywords")
        if isinstance(kws, list):
            return [str(k) for k in kws if k]
    # fallback: unique matched-kw values across records
    seen: List[str] = []
    for rec in records:
        kw = rec.get("topic_match_kw") or rec.get("topic_keyword")
        if not kw:
            continue
        # topic_match_kw may be a single string or a list in different corpora
        if isinstance(kw, list):
            for k in kw:
                if k and k not in seen:
                    seen.append(str(k))
        else:
            if kw not in seen:
                seen.append(str(kw))
    return seen


def _derive_bucket_counts(search_results: Optional[Dict], records: List[Dict]) -> Dict[str, int]:
    if isinstance(search_results, dict):
        bc = search_results.get("bucket_counts")
        if isinstance(bc, dict) and bc:
            # Normalise & fill zeros for missing buckets
            out = {b: 0 for b in BUCKET_ORDER}
            for k, v in bc.items():
                key = str(k).lower()
                try:
                    out[key] = int(v)
                except (TypeError, ValueError):
                    pass
                else:
                    if key not in out:
                        out[key] = int(v)
            return out
    return _derive_counts(records)


def _render_paper_block(idx: int, rec: Dict) -> str:
    title = (rec.get("title") or "(untitled)").strip()
    bucket = (rec.get("bucket") or "other").strip() or "other"
    ident = _paper_identifier(rec)
    matched_kw = rec.get("topic_match_kw") or rec.get("topic_keyword") or "(none)"
    if isinstance(matched_kw, list):
        matched_kw = ", ".join(str(k) for k in matched_kw if k) or "(none)"
    abstract = _truncate_abstract(rec.get("abstract"))

    return (
        f"### {idx}. {title}\n"
        f"- **Bucket**: {bucket}\n"
        f"- **DOI / arxiv**: {ident}\n"
        f"- **Matched kw**: {matched_kw}\n"
        f"- **Abstract**:\n"
        f"  > {abstract}\n"
        f"- **Summary**: _(Claude fills: one-line what-it-does)_\n"
        f"- **Tier**: _(HIGH / MED-H / MED / LOW)_\n"
        f"- **Why**: _(Claude fills: one-line why-this-tier)_\n"
    )


def _render_skeleton(
    venue_year: str,
    total: int,
    topic_keywords: List[str],
    bucket_counts: Dict[str, int],
    records: List[Dict],
) -> str:
    kw_display = ", ".join(topic_keywords) if topic_keywords else "(none / --no-topic-filter)"
    bucket_display = "  ".join(
        f"{b}={bucket_counts.get(b, 0)}" for b in BUCKET_ORDER
    )

    lines: List[str] = []
    lines.append(f"# Review — {venue_year}  ({total} papers kept after topic filter)")
    lines.append("")
    lines.append(f"**Source**: DBLP {venue_year}  ")
    lines.append(f"**Topic keywords**: {kw_display}  ")
    lines.append(f"**Buckets**: {bucket_display}")
    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("## Tier Summary")
    lines.append("")
    lines.append("| Tier | Count | Papers |")
    lines.append("|---|---|---|")
    lines.append("| HIGH    | ? | _(to be filled)_ |")
    lines.append("| MED-H   | ? | _(to be filled)_ |")
    lines.append("| MED     | ? | _(to be filled)_ |")
    lines.append("| LOW     | ? | _(to be filled)_ |")
    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("## Papers")
    lines.append("")

    if not records:
        lines.append("_(no papers — corpus is empty after topic filter)_")
        lines.append("")
        return "\n".join(lines)

    for i, rec in enumerate(records, start=1):
        lines.append(_render_paper_block(i, rec))
        lines.append("---")
        lines.append("")

    return "\n".join(lines)


def generate_review(corpus_dir: Path, out_path: Path, force: bool) -> int:
    if not corpus_dir.is_dir():
        print(f"error: corpus dir not found: {corpus_dir}", file=sys.stderr)
        return 2

    if out_path.exists() and not force:
        print(
            f"error: {out_path} already exists (pass --force to overwrite)",
            file=sys.stderr,
        )
        return 1

    search_results = _load_json(corpus_dir / "search_results.json")
    if not isinstance(search_results, dict):
        search_results = None

    papers_dir = corpus_dir / "papers"
    records = _load_metadata(papers_dir)
    records.sort(key=_bucket_sort_key)

    venue_year = _derive_venue_year(search_results, records)
    topic_keywords = _derive_topic_keywords(search_results, records)
    bucket_counts = _derive_bucket_counts(search_results, records)

    skeleton = _render_skeleton(
        venue_year=venue_year,
        total=len(records),
        topic_keywords=topic_keywords,
        bucket_counts=bucket_counts,
        records=records,
    )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(skeleton, encoding="utf-8")

    summary = {
        "corpus_dir": str(corpus_dir),
        "review_path": str(out_path),
        "papers": len(records),
        "bucket_counts": bucket_counts,
        "topic_keywords": topic_keywords,
    }
    print(json.dumps(summary, ensure_ascii=False))
    return 0


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Emit a review.md skeleton for a venue-mode corpus so Claude can "
            "rate every paper (HIGH / MED-H / MED / LOW) across arxiv / acm / "
            "ieee / other buckets."
        )
    )
    parser.add_argument(
        "corpus_dir",
        type=Path,
        help="Corpus directory, e.g. .pipeline/literature/venues/arch/asplos-2024",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help="Output review.md path (default: <corpus_dir>/review.md).",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite an existing review.md instead of aborting.",
    )
    args = parser.parse_args(argv)

    corpus_dir: Path = args.corpus_dir.expanduser().resolve()
    out_path: Path = (
        args.out.expanduser().resolve()
        if args.out is not None
        else corpus_dir / "review.md"
    )
    return generate_review(corpus_dir, out_path, args.force)


if __name__ == "__main__":
    raise SystemExit(main())
