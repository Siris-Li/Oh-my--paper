#!/usr/bin/env python3
"""Search traceable papers and optionally download open PDFs.

Three modes:
  --query     Full-text search across configured sources (arXiv, Semantic Scholar, OpenAlex).
  --arxiv-ids Resolve specific arXiv IDs via the arXiv API, confirm metadata, then download.
              Useful when you already know the IDs (e.g. from a web search) and want
              verified metadata before fetching the PDF.
  --venues    Enumerate a venue+year's accepted papers via DBLP, enrich abstracts via
              OpenAlex, apply an Agentic-CPU topic keyword filter, then bucket the
              survivors into arxiv (downloaded), acm (queued for web-access in
              acm_download_queue.json), ieee (listed in ieee_manifest.md), or other
              (skipped). Supported slugs: isca-YYYY micro-YYYY hpca-YYYY asplos-YYYY
              mlsys-YYYY dac-YYYY iccad-YYYY.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from literature_lib import (
    SUPPORTED_VENUE_SLUGS,
    discover_records,
    download_pdf,
    ensure_dir,
    fetch_arxiv_by_ids,
    fetch_venue_papers,
    slugify,
    write_json,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--query", help="Free-text search query.")
    mode.add_argument(
        "--arxiv-ids",
        nargs="+",
        metavar="ID",
        help="One or more arXiv IDs (e.g. 2502.13817) to resolve via arXiv API and download.",
    )
    mode.add_argument(
        "--venues",
        nargs="+",
        metavar="SLUG",
        help=(
            "Venue slugs like asplos-2024 isca-2025 (multiple allowed). Supported: "
            f"{'/'.join(SUPPORTED_VENUE_SLUGS)} x YYYY. Pipeline: DBLP -> OpenAlex "
            "abstracts -> topic filter -> arxiv/acm/ieee/other bucketing."
        ),
    )
    parser.add_argument("--out-dir", required=True, help="Output directory.")
    parser.add_argument("--limit", type=int, default=10, help="Final number of unique records (query mode only).")
    parser.add_argument(
        "--sources",
        nargs="+",
        default=["arxiv", "semanticscholar", "openalex"],
        choices=["arxiv", "semanticscholar", "openalex", "hf_daily"],
        help="Sources to query (query mode only).",
    )
    parser.add_argument("--download-pdfs", action="store_true", help="Download open-access PDFs when available.")
    parser.add_argument(
        "--no-download",
        action="store_true",
        help="Dry-run: emit metadata and queues but skip all PDF downloads.",
    )
    parser.add_argument(
        "--no-topic-filter",
        action="store_true",
        help="Skip the Agentic-CPU keyword filter in venue mode (download the entire venue).",
    )
    parser.add_argument("--openalex-mailto", default=None, help="Optional mailto value for OpenAlex.")
    parser.add_argument("--sort", choices=["relevance", "recent"], default="relevance", help="Sort strategy.")
    parser.add_argument("--min-year", type=int, default=None, help="Keep only records with year >= min-year.")
    return parser.parse_args()


def _write_ieee_manifest(path: Path, rows: list) -> None:
    lines = [
        "# IEEE manifest\n",
        f"{len(rows)} papers with 10.1109/* DOIs (IEEE Xplore). No arxiv preprint found.\n",
        "Xplore has no Open Access API; download via subscription or web browser.\n\n",
        "| # | Title | Year | Venue | DOI | Target path |\n",
        "|---|---|---|---|---|---|\n",
    ]
    for i, item in enumerate(rows, start=1):
        title = (item.get("title") or "").replace("|", "\\|").replace("\n", " ")[:120]
        venue = (item.get("venue") or "").replace("|", "\\|")
        doi = item.get("doi") or ""
        xplore = f"[{doi}](https://doi.org/{doi})" if doi else ""
        lines.append(
            f"| {i} | {title} | {item.get('year') or ''} | {venue} | {xplore} | `{item.get('target_path')}` |\n"
        )
    ensure_dir(path.parent)
    path.write_text("".join(lines), encoding="utf-8")


def main() -> int:
    args = parse_args()
    out_dir = Path(args.out_dir).expanduser().resolve()
    papers_dir = out_dir / "papers"
    ensure_dir(papers_dir)

    mode_name: str
    if args.arxiv_ids:
        # --arxiv-ids mode: resolve via arXiv API, confirm metadata, then optionally download
        records = fetch_arxiv_by_ids(args.arxiv_ids)
        source_errors: dict = {}
        mode_name = "arxiv_ids"
    elif args.venues:
        # --venues mode: DBLP enumeration -> abstract -> topic filter -> bucketing
        records, source_errors = fetch_venue_papers(
            args.venues,
            topic_filter=not args.no_topic_filter,
            openalex_mailto=args.openalex_mailto,
        )
        if args.min_year is not None:
            records = [r for r in records if r.get("year") is None or int(r["year"]) >= args.min_year]
        mode_name = "venues"
    else:
        # --query mode: search across configured sources
        records, source_errors = discover_records(
            query=args.query,
            limit=args.limit,
            sources=args.sources,
            openalex_mailto=args.openalex_mailto,
            sort=args.sort,
            min_year=args.min_year,
        )
        mode_name = "query"

    do_download = args.download_pdfs and not args.no_download

    saved: list = []
    acm_queue: list = []
    ieee_manifest: list = []
    bucket_counts = {"arxiv": 0, "acm": 0, "ieee": 0, "other": 0}

    for index, record in enumerate(records, start=1):
        arxiv_id = record.get("arxiv_id") or ""
        title_slug = slugify(f"{record.get('year') or 'na'}-{record.get('title') or index}")
        paper_slug = slugify(f"{arxiv_id}-{title_slug}") if arxiv_id else title_slug
        paper_dir = papers_dir / paper_slug
        ensure_dir(paper_dir)
        target_pdf = paper_dir / "paper.pdf"
        local_pdf_path = None
        pdf_status = "not_requested"
        pdf_url = record.get("pdf_url")
        bucket = record.get("bucket")  # only set in venue mode

        if args.venues:
            if bucket:
                bucket_counts[bucket] = bucket_counts.get(bucket, 0) + 1
            if bucket == "arxiv" and pdf_url:
                if do_download:
                    try:
                        download_pdf(pdf_url, target_pdf)
                        pdf_status = "downloaded"
                        local_pdf_path = target_pdf
                    except Exception as exc:  # noqa: BLE001
                        pdf_status = f"failed: {exc}"
                else:
                    pdf_status = "pending_arxiv_download"
            elif bucket == "acm":
                acm_url = f"https://dl.acm.org/doi/pdf/{record.get('doi')}"
                acm_queue.append(
                    {
                        "title": record.get("title"),
                        "doi": record.get("doi"),
                        "acm_url": acm_url,
                        "target_path": str(target_pdf),
                        "paper_slug": paper_slug,
                    }
                )
                pdf_status = "pending_acm_web_access"
            elif bucket == "ieee":
                ieee_manifest.append(
                    {
                        "title": record.get("title"),
                        "year": record.get("year"),
                        "venue": record.get("venue"),
                        "doi": record.get("doi"),
                        "target_path": str(target_pdf),
                        "paper_slug": paper_slug,
                    }
                )
                pdf_status = "pending_ieee_manual"
            else:
                pdf_status = "unavailable"
        elif do_download:
            # query / arxiv-ids mode: download when pdf_url is present
            if pdf_url:
                try:
                    download_pdf(pdf_url, target_pdf)
                    pdf_status = "downloaded"
                    local_pdf_path = target_pdf
                except Exception as exc:  # noqa: BLE001
                    pdf_status = f"failed: {exc}"
            else:
                pdf_status = "unavailable"

        paper_record = {
            **record,
            "rank": index,
            "paper_slug": paper_slug,
            "local_pdf_path": str(local_pdf_path) if local_pdf_path else None,
            "pdf_status": pdf_status,
        }
        write_json(paper_dir / "metadata.json", paper_record)
        saved.append(paper_record)

    # Venue-mode queue artifacts
    if args.venues:
        write_json(out_dir / "acm_download_queue.json", acm_queue)
        _write_ieee_manifest(out_dir / "ieee_manifest.md", ieee_manifest)

    if args.venues:
        sources_repr = ["dblp", "openalex", "arxiv"]
    elif args.arxiv_ids:
        sources_repr = ["arxiv"]
    else:
        sources_repr = args.sources
    write_json(
        out_dir / "search_results.json",
        {
            "mode": mode_name,
            "query": args.query,
            "arxiv_ids": args.arxiv_ids,
            "venues": args.venues,
            "topic_filter": (not args.no_topic_filter) if args.venues else None,
            "no_download": args.no_download,
            "limit": args.limit,
            "sources": sources_repr,
            "sort": args.sort,
            "min_year": args.min_year,
            "source_errors": source_errors,
            "bucket_counts": bucket_counts if args.venues else None,
            "acm_queue_size": len(acm_queue) if args.venues else None,
            "ieee_manifest_size": len(ieee_manifest) if args.venues else None,
            "records": saved,
        },
    )
    summary = {"saved_records": len(saved), "out_dir": str(out_dir)}
    if args.venues:
        summary["bucket_counts"] = bucket_counts
        summary["acm_queue"] = str(out_dir / "acm_download_queue.json")
        summary["ieee_manifest"] = str(out_dir / "ieee_manifest.md")
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
