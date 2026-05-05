#!/usr/bin/env python3
"""Shared helpers for the literature PDF OCR library skill."""

from __future__ import annotations

import html
import json
import re
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import requests

USER_AGENT = "Codex literature-pdf-ocr-library/1.0"
TIMEOUT = 45
ARXIV_ATOM_NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "arxiv": "http://arxiv.org/schemas/atom",
}
PDF_EXTENSIONS = {".pdf"}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".webp"}


def slugify(text: str, limit: int = 80) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    text = re.sub(r"-{2,}", "-", text).strip("-")
    return text[:limit] or "paper"


def normalize_title(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip().lower()


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def write_json(path: Path, data: object) -> None:
    ensure_dir(path.parent)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_jsonl(path: Path, rows: Iterable[Dict]) -> None:
    ensure_dir(path.parent)
    with path.open("w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")


def safe_request(
    url: str,
    *,
    params: Optional[Dict] = None,
    headers: Optional[Dict] = None,
    timeout: int = TIMEOUT,
) -> requests.Response:
    merged_headers = {"User-Agent": USER_AGENT}
    if headers:
        merged_headers.update(headers)
    response = requests.get(url, params=params, headers=merged_headers, timeout=timeout)
    response.raise_for_status()
    return response


def choose_best_pdf_url(record: Dict) -> Optional[str]:
    candidates = [
        record.get("pdf_url"),
        record.get("open_access_pdf_url"),
        record.get("oa_url"),
        record.get("primary_pdf_url"),
    ]
    for url in candidates:
        if isinstance(url, str) and url.strip():
            return url.strip()
    return None


def dedupe_records(records: List[Dict], limit: Optional[int] = None) -> List[Dict]:
    source_priority = {"arxiv": 0, "semanticscholar": 1, "openalex": 2, "hf_daily": 3}
    chosen: Dict[str, Dict] = {}

    def key_for(record: Dict) -> str:
        for field in ("doi", "arxiv_id"):
            value = record.get(field)
            if value:
                return f"{field}:{str(value).lower()}"
        return f"title:{normalize_title(record.get('title', ''))}"

    ordered = sorted(records, key=lambda row: source_priority.get(row.get("source", ""), 99))
    for record in ordered:
        key = key_for(record)
        if key not in chosen:
            chosen[key] = dict(record)
            continue
        existing = chosen[key]
        for field in (
            "abstract",
            "pdf_url",
            "landing_page",
            "open_access_pdf_url",
            "oa_url",
            "primary_pdf_url",
            "doi",
            "arxiv_id",
            "venue",
            "year",
        ):
            if not existing.get(field) and record.get(field):
                existing[field] = record[field]
        merged_sources = list(dict.fromkeys(existing.get("merged_sources", [existing.get("source")]) + [record.get("source")]))
        existing["merged_sources"] = [item for item in merged_sources if item]
        existing["pdf_url"] = choose_best_pdf_url(existing)

    results = list(chosen.values())
    if limit is not None:
        return results[:limit]
    return results


def _text(node: Optional[ET.Element]) -> str:
    return node.text.strip() if node is not None and node.text else ""


def _parse_arxiv_id(entry_id: str) -> str:
    value = entry_id.rsplit("/", 1)[-1]
    return value.replace("v", "v") if value else ""


def _arxiv_pdf_url(entry_id: str) -> str:
    arxiv_id = entry_id.rsplit("/", 1)[-1]
    if arxiv_id.endswith(".pdf"):
        return f"https://arxiv.org/pdf/{arxiv_id}"
    return f"https://arxiv.org/pdf/{arxiv_id}.pdf"


def search_arxiv(query: str, limit: int, sort: str = "relevance") -> List[Dict]:
    sort_by = "submittedDate" if sort == "recent" else "relevance"
    response = safe_request(
        "https://export.arxiv.org/api/query",
        params={
            "search_query": f"all:{query}",
            "start": 0,
            "max_results": limit,
            "sortBy": sort_by,
            "sortOrder": "descending",
        },
    )
    root = ET.fromstring(response.text)
    rows: List[Dict] = []
    for entry in root.findall("atom:entry", ARXIV_ATOM_NS):
        entry_id = _text(entry.find("atom:id", ARXIV_ATOM_NS))
        doi = _text(entry.find("arxiv:doi", ARXIV_ATOM_NS))
        published = _text(entry.find("atom:published", ARXIV_ATOM_NS))
        rows.append(
            {
                "source": "arxiv",
                "title": _text(entry.find("atom:title", ARXIV_ATOM_NS)),
                "authors": [_text(author.find("atom:name", ARXIV_ATOM_NS)) for author in entry.findall("atom:author", ARXIV_ATOM_NS)],
                "abstract": _text(entry.find("atom:summary", ARXIV_ATOM_NS)),
                "year": int(published[:4]) if published[:4].isdigit() else None,
                "published": published,
                "landing_page": entry_id.replace("http://", "https://"),
                "pdf_url": _arxiv_pdf_url(entry_id),
                "doi": doi or None,
                "arxiv_id": _parse_arxiv_id(entry_id),
                "venue": "arXiv",
            }
        )
    return rows


def fetch_arxiv_by_ids(arxiv_ids: List[str]) -> List[Dict]:
    """Fetch paper metadata from arXiv API for a specific list of arXiv IDs.

    Uses the arXiv export API with id_list to retrieve confirmed metadata (title,
    authors, abstract, year) before downloading.  IDs may be bare (``2502.13817``)
    or versioned (``2502.13817v2``).
    """
    id_list = ",".join(arxiv_ids)
    response = safe_request(
        "https://export.arxiv.org/api/query",
        params={"id_list": id_list, "max_results": len(arxiv_ids)},
    )
    root = ET.fromstring(response.text)
    rows: List[Dict] = []
    for entry in root.findall("atom:entry", ARXIV_ATOM_NS):
        entry_id = _text(entry.find("atom:id", ARXIV_ATOM_NS))
        doi = _text(entry.find("arxiv:doi", ARXIV_ATOM_NS))
        published = _text(entry.find("atom:published", ARXIV_ATOM_NS))
        rows.append(
            {
                "source": "arxiv",
                "title": _text(entry.find("atom:title", ARXIV_ATOM_NS)),
                "authors": [
                    _text(author.find("atom:name", ARXIV_ATOM_NS))
                    for author in entry.findall("atom:author", ARXIV_ATOM_NS)
                ],
                "abstract": _text(entry.find("atom:summary", ARXIV_ATOM_NS)),
                "year": int(published[:4]) if (published or "")[:4].isdigit() else None,
                "published": published,
                "landing_page": entry_id.replace("http://", "https://"),
                "pdf_url": _arxiv_pdf_url(entry_id),
                "doi": doi or None,
                "arxiv_id": _parse_arxiv_id(entry_id),
                "venue": "arXiv",
            }
        )
    return rows


def search_semanticscholar(query: str, limit: int, sort: str = "relevance") -> List[Dict]:
    del sort
    response = safe_request(
        "https://api.semanticscholar.org/graph/v1/paper/search",
        params={
            "query": query,
            "limit": limit,
            "fields": "title,year,authors,abstract,url,openAccessPdf,isOpenAccess,externalIds,venue",
        },
    )
    body = response.json()
    rows: List[Dict] = []
    for item in body.get("data", []):
        external_ids = item.get("externalIds") or {}
        open_pdf = item.get("openAccessPdf") or {}
        rows.append(
            {
                "source": "semanticscholar",
                "title": item.get("title"),
                "authors": [author.get("name") for author in item.get("authors", []) if author.get("name")],
                "abstract": item.get("abstract"),
                "year": item.get("year"),
                "landing_page": item.get("url"),
                "pdf_url": open_pdf.get("url"),
                "open_access_pdf_url": open_pdf.get("url"),
                "doi": external_ids.get("DOI"),
                "arxiv_id": external_ids.get("ArXiv"),
                "venue": item.get("venue"),
                "is_open_access": item.get("isOpenAccess"),
            }
        )
    return rows


def search_openalex(query: str, limit: int, mailto: Optional[str] = None, sort: str = "relevance") -> List[Dict]:
    params = {"search": query, "per-page": limit}
    if sort == "recent":
        params["sort"] = "publication_date:desc"
    headers: Dict[str, str] = {}
    if mailto:
        params["mailto"] = mailto
        headers["User-Agent"] = f"{USER_AGENT} ({mailto})"
    response = safe_request("https://api.openalex.org/works", params=params, headers=headers)
    body = response.json()
    rows: List[Dict] = []
    for item in body.get("results", []):
        primary_location = item.get("primary_location") or {}
        open_access = item.get("open_access") or {}
        ids = item.get("ids") or {}
        doi = item.get("doi") or ids.get("doi")
        if doi and doi.startswith("https://doi.org/"):
            doi = doi[len("https://doi.org/") :]
        rows.append(
            {
                "source": "openalex",
                "title": item.get("display_name") or item.get("title"),
                "authors": [author.get("author", {}).get("display_name") for author in item.get("authorships", []) if author.get("author", {}).get("display_name")],
                "abstract": None,
                "year": item.get("publication_year"),
                "landing_page": primary_location.get("landing_page_url") or item.get("id"),
                "pdf_url": primary_location.get("pdf_url") or open_access.get("oa_url"),
                "primary_pdf_url": primary_location.get("pdf_url"),
                "oa_url": open_access.get("oa_url"),
                "doi": doi,
                "arxiv_id": None,
                "venue": (primary_location.get("source") or {}).get("display_name"),
                "is_open_access": open_access.get("is_oa"),
            }
        )
    return rows


def search_hf_daily_papers(query: str, limit: int, sort: str = "relevance") -> List[Dict]:
    del sort
    response = safe_request("https://huggingface.co/api/daily_papers")
    body = response.json()
    items = body if isinstance(body, list) else [body]
    terms = [term.lower() for term in re.findall(r"[a-zA-Z0-9_-]+", query) if term.strip()]
    rows: List[Dict] = []
    for item in items:
        paper = item.get("paper") or {}
        haystack = f"{paper.get('title', '')} {paper.get('summary', '')}".lower()
        if terms and not all(term in haystack for term in terms[:3]):
            continue
        paper_id = str(paper.get("id") or "").strip()
        pdf_url = f"https://arxiv.org/pdf/{paper_id}.pdf" if re.fullmatch(r"\d{4}\.\d{4,5}", paper_id) else None
        rows.append(
            {
                "source": "hf_daily",
                "title": paper.get("title"),
                "authors": [author.get("name") for author in paper.get("authors", []) if author.get("name")],
                "abstract": paper.get("summary"),
                "year": int(str(paper.get("publishedAt", ""))[:4]) if str(paper.get("publishedAt", ""))[:4].isdigit() else None,
                "landing_page": f"https://huggingface.co/papers/{paper_id}" if paper_id else None,
                "pdf_url": pdf_url,
                "doi": None,
                "arxiv_id": paper_id if pdf_url else None,
                "venue": "Hugging Face daily papers",
            }
        )
        if len(rows) >= limit:
            break
    return rows


def discover_records(
    query: str,
    limit: int,
    sources: List[str],
    openalex_mailto: Optional[str] = None,
    sort: str = "relevance",
    min_year: Optional[int] = None,
) -> tuple[List[Dict], Dict[str, str]]:
    rows: List[Dict] = []
    errors: Dict[str, str] = {}
    for source in sources:
        try:
            if source == "arxiv":
                rows.extend(search_arxiv(query, limit, sort=sort))
            elif source == "semanticscholar":
                rows.extend(search_semanticscholar(query, limit, sort=sort))
            elif source == "openalex":
                rows.extend(search_openalex(query, limit, mailto=openalex_mailto, sort=sort))
            elif source == "hf_daily":
                rows.extend(search_hf_daily_papers(query, limit, sort=sort))
            else:
                raise ValueError(f"Unsupported source: {source}")
        except Exception as exc:  # noqa: BLE001
            errors[source] = str(exc)
            print(f"[warn] source failed: {source}: {exc}", file=sys.stderr)

    if min_year is not None:
        rows = [row for row in rows if row.get("year") is None or int(row["year"]) >= min_year]
    deduped = dedupe_records(rows, limit=limit)
    for record in deduped:
        record["pdf_url"] = choose_best_pdf_url(record)
    return deduped, errors


def download_pdf(url: str, destination: Path) -> None:
    ensure_dir(destination.parent)
    with requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT, stream=True) as response:
        response.raise_for_status()
        with destination.open("wb") as fh:
            for chunk in response.iter_content(chunk_size=1024 * 64):
                if chunk:
                    fh.write(chunk)


def discover_input_files(paths: Iterable[Path], recursive: bool = False) -> List[Path]:
    discovered: List[Path] = []
    for path in paths:
        if path.is_file():
            discovered.append(path)
            continue
        pattern = "**/*" if recursive else "*"
        for candidate in sorted(path.glob(pattern)):
            if not candidate.is_file():
                continue
            if candidate.suffix.lower() in PDF_EXTENSIONS | IMAGE_EXTENSIONS:
                discovered.append(candidate)
    return discovered


# ============================================================================
# Venue-mode helpers (DBLP -> OpenAlex abstract -> topic filter -> bucketing)
# ============================================================================

VENUE_SLUG_TO_DBLP = {
    "isca": "ISCA",
    "micro": "MICRO",
    "hpca": "HPCA",
    "asplos": "ASPLOS",
    "mlsys": "MLSys",
    "dac": "DAC",
    "iccad": "ICCAD",
}
SUPPORTED_VENUE_SLUGS = sorted(VENUE_SLUG_TO_DBLP.keys())

_ARXIV_ABS_OR_PDF_RE = re.compile(
    r"arxiv\.org/(?:abs|pdf)/([0-9]{4}\.[0-9]{4,5})(?:v\d+)?(?:\.pdf)?", re.IGNORECASE
)

_TITLE_STOPWORDS = {
    "for", "and", "the", "with", "via", "using", "from", "into", "over",
    "under", "of", "on", "in", "to", "a", "an", "by",
}


def parse_venue_slug(slug: str) -> Tuple[str, int]:
    """'isca-2024' -> ('ISCA', 2024). Raises ValueError on unknown / malformed."""
    match = re.fullmatch(r"([a-zA-Z]+)-(\d{4})", slug.strip())
    if not match:
        raise ValueError(f"Invalid venue slug: {slug!r} (expected e.g. isca-2024)")
    name, year_str = match.group(1).lower(), match.group(2)
    if name not in VENUE_SLUG_TO_DBLP:
        raise ValueError(
            f"Unsupported venue {name!r}. Supported: {', '.join(SUPPORTED_VENUE_SLUGS)}"
        )
    return VENUE_SLUG_TO_DBLP[name], int(year_str)


def _dblp_extract_authors(raw: object) -> List[str]:
    if not isinstance(raw, dict):
        return []
    author = raw.get("author")
    if isinstance(author, dict):
        author = [author]
    if not isinstance(author, list):
        return []
    names: List[str] = []
    for item in author:
        text = item.get("text") if isinstance(item, dict) else item
        if isinstance(text, str) and text.strip():
            names.append(text.strip())
    return names


def _dblp_extract_ee(raw: object) -> List[str]:
    if not raw:
        return []
    if isinstance(raw, str):
        return [raw]
    if isinstance(raw, dict):
        t = raw.get("text") or raw.get("@href")
        return [t] if isinstance(t, str) else []
    if isinstance(raw, list):
        out: List[str] = []
        for item in raw:
            if isinstance(item, str):
                out.append(item)
            elif isinstance(item, dict):
                t = item.get("text") or item.get("@href")
                if isinstance(t, str):
                    out.append(t)
        return out
    return []


def search_dblp_venue(venue: str, year: int, limit: int = 1000) -> List[Dict]:
    """Fetch all accepted papers for a venue+year from DBLP."""
    response = safe_request(
        "https://dblp.org/search/publ/api",
        params={"q": f"venue:{venue} year:{year}", "format": "json", "h": limit},
    )
    body = response.json()
    hits = body.get("result", {}).get("hits", {}).get("hit", [])
    if isinstance(hits, dict):
        hits = [hits]

    rows: List[Dict] = []
    for hit in hits:
        info = hit.get("info") or {}
        if info.get("type") not in ("Conference and Workshop Papers", "Journal Articles"):
            continue
        # DBLP's venue: query does prefix/substring matching, so venue:ISCA
        # matches ISCAS (Circuits and Systems) and ISCAI too. Filter by exact
        # venue match (after stripping "(N)" track-number suffix).
        v_raw = info.get("venue")
        if isinstance(v_raw, list) and v_raw:
            v_raw = v_raw[0]
        if not isinstance(v_raw, str):
            continue
        v_clean = re.sub(r"\s*\(\d+\)\s*$", "", v_raw).strip()
        if v_clean.lower() != venue.lower():
            continue
        title = (info.get("title") or "").strip().rstrip(".").strip()
        authors = _dblp_extract_authors(info.get("authors"))
        ee_urls = _dblp_extract_ee(info.get("ee"))
        doi = info.get("doi")
        year_int: Optional[int] = None
        yr = info.get("year")
        if yr is not None:
            try:
                year_int = int(str(yr))
            except (TypeError, ValueError):
                pass
        venue_raw = info.get("venue")
        if isinstance(venue_raw, list) and venue_raw:
            venue_raw = venue_raw[0]
        if isinstance(venue_raw, str):
            venue_clean = re.sub(r"\s*\(\d+\)\s*$", "", venue_raw).strip()
        else:
            venue_clean = venue
        venue_display = f"{venue_clean} {year_int}" if year_int else venue_clean
        landing = info.get("url") or (ee_urls[0] if ee_urls else None)
        rows.append(
            {
                "source": "dblp",
                "title": title,
                "authors": authors,
                "abstract": None,
                "year": year_int,
                "published": None,
                "landing_page": landing,
                "pdf_url": None,
                "doi": doi,
                "arxiv_id": None,
                "venue": venue_display,
                "dblp_ee": ee_urls,
                "dblp_key": info.get("key"),
            }
        )
    return rows


def _reconstruct_inverted_index(inv: object) -> Optional[str]:
    """OpenAlex abstract is {word: [positions]}; return reconstructed text."""
    if not isinstance(inv, dict):
        return None
    positions: List[Tuple[int, str]] = []
    for word, poses in inv.items():
        if not isinstance(poses, list):
            continue
        for p in poses:
            if isinstance(p, int):
                positions.append((p, word))
    if not positions:
        return None
    positions.sort(key=lambda x: x[0])
    return " ".join(w for _, w in positions)


def fetch_openalex_abstract(doi: str, mailto: Optional[str] = None) -> Optional[str]:
    """Fetch a single work's abstract from OpenAlex by DOI."""
    if not doi:
        return None
    params: Dict[str, str] = {}
    headers: Dict[str, str] = {}
    if mailto:
        params["mailto"] = mailto
        headers["User-Agent"] = f"{USER_AGENT} ({mailto})"
    try:
        response = safe_request(
            f"https://api.openalex.org/works/https://doi.org/{doi}",
            params=params or None,
            headers=headers or None,
        )
    except Exception:  # noqa: BLE001
        return None
    try:
        body = response.json()
    except Exception:  # noqa: BLE001
        return None
    return _reconstruct_inverted_index(body.get("abstract_inverted_index"))


def topic_matches(
    title: Optional[str],
    abstract: Optional[str],
    keywords: List[str],
) -> Tuple[bool, Optional[str]]:
    """Return (matched, first-keyword-hit) for case-insensitive substring search.

    `keywords` is the caller-supplied list (typically from a project-level file);
    keywords are lowercased before matching. Empty lists always return (False, None).
    """
    text = ((title or "") + " " + (abstract or "")).lower()
    if not text.strip() or not keywords:
        return False, None
    for kw in keywords:
        if not isinstance(kw, str):
            continue
        needle = kw.strip().lower()
        if needle and needle in text:
            return True, kw
    return False, None


def _title_tokens(title: str) -> set:
    text = html.unescape(title or "").lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return {t for t in text.split() if len(t) >= 3 and t not in _TITLE_STOPWORDS}


def search_arxiv_by_title(
    title: str,
    max_results: int = 10,
    max_retries: int = 3,
    min_year: Optional[int] = None,
) -> Optional[Dict]:
    """Return arxiv record matching `title` by token-overlap + year, or None.

    `min_year` rejects arxiv hits published before that year. Pass
    `target_year - 1` to allow late preprints while filtering coincidental old
    matches -- without it, 2012-2019 arxiv papers that share 4 common tokens
    (e.g. {tree, efficient, high, performance}) get mis-matched to 2024 venue
    papers and their PDFs get "successfully" downloaded -- silently wrong.

    Retries with exponential backoff on 429 (arxiv rate limit).
    """
    target = _title_tokens(title)
    if not target:
        return None
    toks = sorted(target, key=lambda t: (-len(t), t))[:6]
    query = " OR ".join(f"ti:{t}" for t in toks)
    response = None
    for attempt in range(max_retries):
        try:
            response = safe_request(
                "https://export.arxiv.org/api/query",
                params={
                    "search_query": query,
                    "max_results": max_results,
                    "sortBy": "relevance",
                    "sortOrder": "descending",
                },
            )
            break
        except requests.HTTPError as exc:
            status = getattr(exc.response, "status_code", None)
            if status == 429 and attempt + 1 < max_retries:
                time.sleep(5 * (attempt + 1))
                continue
            return None
        except Exception:  # noqa: BLE001
            return None
    if response is None:
        return None
    try:
        root = ET.fromstring(response.text)
    except ET.ParseError:
        return None
    # Tighter: require 60% of target tokens, minimum 4.  Weak threshold led
    # to false-positive matches like ASPLOS 2024 paper -> 2012 arxiv via 4
    # common tokens ({tree, efficient, high, performance}).
    required = max(4, int(0.6 * len(target)))
    for entry in root.findall("atom:entry", ARXIV_ATOM_NS):
        entry_id = _text(entry.find("atom:id", ARXIV_ATOM_NS))
        if not entry_id:
            continue
        published = _text(entry.find("atom:published", ARXIV_ATOM_NS))
        hit_year = int(published[:4]) if (published or "")[:4].isdigit() else None
        if min_year is not None and hit_year is not None and hit_year < min_year:
            continue
        hit_title = _text(entry.find("atom:title", ARXIV_ATOM_NS))
        hit_tok = _title_tokens(hit_title)
        if not hit_tok:
            continue
        overlap = target & hit_tok
        if (
            hit_tok == target
            or len(overlap) >= required
            or len(overlap) >= max(4, int(0.75 * len(hit_tok)))
        ):
            return {
                "arxiv_id": _parse_arxiv_id(entry_id),
                "pdf_url": _arxiv_pdf_url(entry_id),
                "landing_page": entry_id.replace("http://", "https://"),
                "abstract": _text(entry.find("atom:summary", ARXIV_ATOM_NS)),
                "year": hit_year,
            }
    return None


def bucket_record(record: Dict, *, try_arxiv_title_match: bool = True) -> str:
    """Assign a record to arxiv | acm | ieee | other. Mutates `record` to fill
    arxiv_id / pdf_url when a preprint is found. Pauses briefly when it hits arxiv."""
    # 1. ee points to arxiv directly
    for ee in record.get("dblp_ee") or []:
        if not isinstance(ee, str):
            continue
        m = _ARXIV_ABS_OR_PDF_RE.search(ee)
        if m:
            record["arxiv_id"] = m.group(1)
            record["pdf_url"] = f"https://arxiv.org/pdf/{m.group(1)}.pdf"
            return "arxiv"
    # 2. arxiv title-match fallback (with year filter to reject coincidental old matches)
    if try_arxiv_title_match and record.get("title"):
        target_year = record.get("year")
        arxiv_min_year = (int(target_year) - 1) if target_year else None
        hit = search_arxiv_by_title(record["title"], min_year=arxiv_min_year)
        if hit:
            record["arxiv_id"] = hit["arxiv_id"]
            record["pdf_url"] = hit["pdf_url"]
            if not record.get("abstract"):
                record["abstract"] = hit.get("abstract")
            return "arxiv"
    # 3. publisher DOI prefix
    doi = record.get("doi") or ""
    if isinstance(doi, str):
        if doi.startswith("10.1145/"):
            return "acm"
        if doi.startswith("10.1109/"):
            return "ieee"
    return "other"


def fetch_venue_papers(
    venue_slugs: List[str],
    *,
    topic_keywords: Optional[List[str]] = None,
    topic_filter: bool = True,
    openalex_mailto: Optional[str] = None,
    openalex_delay: float = 0.15,
    arxiv_delay: float = 3.0,
) -> Tuple[List[Dict], Dict[str, str]]:
    """End-to-end venue pipeline. Returns (records, slug-level errors).

    Every returned record carries a `bucket` field: "arxiv" | "acm" | "ieee" | "other".

    When ``topic_filter`` is True the caller MUST supply a non-empty
    ``topic_keywords`` list -- there is no hardcoded default. When
    ``topic_filter`` is False, ``topic_keywords`` is ignored and every DBLP
    paper passes through.
    """
    # Normalize + validate keywords up front so we fail before making any network
    # calls if the caller asked for filtering without supplying words.
    clean_keywords: List[str] = []
    if topic_keywords:
        clean_keywords = [
            kw.strip() for kw in topic_keywords if isinstance(kw, str) and kw.strip()
        ]
    if topic_filter and not clean_keywords:
        raise ValueError(
            "venue mode with topic filter enabled requires a non-empty "
            "topic_keywords list (typically loaded from --topic-keywords-file). "
            "Pass topic_filter=False to download every paper in the venue."
        )

    all_rows: List[Dict] = []
    errors: Dict[str, str] = {}
    for slug in venue_slugs:
        try:
            venue, year = parse_venue_slug(slug)
        except ValueError as exc:
            errors[slug] = str(exc)
            print(f"[warn] {exc}", file=sys.stderr)
            continue
        try:
            rows = search_dblp_venue(venue, year)
        except Exception as exc:  # noqa: BLE001
            errors[slug] = f"dblp: {exc}"
            print(f"[warn] dblp failed for {slug}: {exc}", file=sys.stderr)
            continue
        print(f"[info] {slug}: {len(rows)} DBLP hits; enriching abstracts ...", file=sys.stderr)

        # Stage 1: OpenAlex abstract enrichment
        for i, row in enumerate(rows):
            if row.get("doi"):
                abs_text = fetch_openalex_abstract(row["doi"], mailto=openalex_mailto)
                if abs_text:
                    row["abstract"] = abs_text
                if openalex_delay > 0:
                    time.sleep(openalex_delay)
            if (i + 1) % 25 == 0:
                print(f"[info] {slug}: enriched {i + 1}/{len(rows)}", file=sys.stderr)

        # Stage 2: topic filter
        if topic_filter:
            kept: List[Dict] = []
            for r in rows:
                ok, kw = topic_matches(r.get("title"), r.get("abstract"), clean_keywords)
                if ok:
                    r["topic_keyword"] = kw
                    kept.append(r)
            print(
                f"[info] {slug}: topic filter kept {len(kept)}/{len(rows)}",
                file=sys.stderr,
            )
            rows = kept

        # Stage 3: bucketing (may hit arxiv API)
        print(f"[info] {slug}: bucketing {len(rows)} papers ...", file=sys.stderr)
        for r in rows:
            had_arxiv_ee = any(
                isinstance(ee, str) and _ARXIV_ABS_OR_PDF_RE.search(ee)
                for ee in (r.get("dblp_ee") or [])
            )
            r["bucket"] = bucket_record(r)
            # sleep only when the bucketing made a title-search API call
            if not had_arxiv_ee and arxiv_delay > 0:
                time.sleep(arxiv_delay)

        all_rows.extend(rows)
    return all_rows, errors
