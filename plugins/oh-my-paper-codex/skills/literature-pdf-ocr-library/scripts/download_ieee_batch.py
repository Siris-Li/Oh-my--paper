#!/usr/bin/env python3
"""Batch-download IEEE Xplore PDFs using Chrome CDP + institutional login.

Flow per paper:
  1. Navigate bootstrap tab to https://doi.org/{DOI} -> auto-redirects to ieeexplore
  2. Read final URL to get arnumber
  3. fetch /stampPDF/getPDF.jsp?tp=&arnumber=X&ref={base64 of landing_url}
  4. PUT blob to http://localhost:9876/{slug}
"""
import base64
import json
import sys
import time
import requests
from pathlib import Path

PROXY = "http://localhost:3456"
RECV = "http://localhost:9876"
DELAY_BETWEEN = 2.5  # IEEE is slightly more WAF-paranoid than ACM

# Post-hoc disk verify: a real PDF written by pdf_recv.py must start with "%PDF-"
# and be at least 10 KB. Magic-bytes is the authoritative signal; the old
# 100 KB / 200 KB numeric thresholds rejected valid small papers. 10 KB is the
# sane floor for "this is a real PDF file at all".
PDF_MAGIC = b"%PDF-"
PDF_MIN_BYTES = 10_000


def disk_verify(target_path: str) -> tuple[bool, int]:
    """Check target_path is an on-disk PDF (magic bytes + size floor).

    Returns (ok, size_bytes). ok=True iff file exists, starts with %PDF-,
    and is >= PDF_MIN_BYTES. On any IO error returns (False, 0).
    """
    try:
        p = Path(target_path)
        if not p.exists():
            return False, 0
        size = p.stat().st_size
        if size < PDF_MIN_BYTES:
            return False, size
        with open(p, "rb") as f:
            head = f.read(5)
        return head == PDF_MAGIC, size
    except Exception:
        return False, 0


def proxy_eval(tid: str, js: str, timeout: int = 90) -> dict:
    return requests.post(f"{PROXY}/eval", params={"target": tid}, data=js, timeout=timeout).json()


def proxy_navigate(tid: str, url: str) -> dict:
    return requests.get(f"{PROXY}/navigate", params={"target": tid, "url": url}, timeout=30).json()


def proxy_info(tid: str) -> dict:
    return requests.get(f"{PROXY}/info", params={"target": tid}, timeout=10).json()


def open_tab(url: str) -> str:
    return requests.get(f"{PROXY}/new", params={"url": url}, timeout=30).json()["targetId"]


def close_tab(tid: str):
    try:
        requests.get(f"{PROXY}/close", params={"target": tid}, timeout=10)
    except Exception:
        pass


def download_one(doi: str, slug: str, target_path: str) -> dict:
    """One fresh tab per paper -- IEEE flags tabs that do multiple PDF fetches."""
    # Step 1: fresh tab on doi.org, let it redirect to Xplore document page
    tid = open_tab(f"https://doi.org/{doi}")
    try:
        # Poll readiness: in-flight navigation causes "Failed to fetch" on
        # eval'd fetch(). Wait for ready=="complete" before proceeding, not
        # just a fixed time delay.
        import re
        arnumber = None
        info = {}
        for _ in range(15):
            time.sleep(1)
            info = proxy_info(tid)
            final_url = info.get("url", "")
            if "ieeexplore.ieee.org/document/" in final_url and info.get("ready") == "complete":
                m = re.search(r"document/(\d+)", final_url)
                if m:
                    arnumber = m.group(1)
                    break
        if arnumber is None:
            return {"status": "no_xplore_ready", "info": info}
        time.sleep(1)  # grace period for post-load JS

        # Step 2: construct PDF URL + fetch + PUT
        landing = f"https://ieeexplore.ieee.org/document/{arnumber}"
        b64ref = base64.b64encode(landing.encode()).decode()
        pdf_url = f"https://ieeexplore.ieee.org/stampPDF/getPDF.jsp?tp=&arnumber={arnumber}&ref={b64ref}"

        # Magic-bytes first, then 10 KB floor — drop numeric size gates.
        js = f"""(async()=>{{try{{
  const r = await fetch({json.dumps(pdf_url)}, {{credentials:"include", redirect:"follow"}});
  const ct = r.headers.get("content-type") || "";
  if (!ct.includes("pdf")) {{
    const txt = await r.text();
    return JSON.stringify({{fetchStatus: r.status, ct, snippet: txt.slice(0, 300)}});
  }}
  const blob = await r.blob();
  const head = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
  const magic = String.fromCharCode(head[0], head[1], head[2], head[3], head[4]);
  if (magic !== "%PDF-") return JSON.stringify({{fetchStatus: r.status, size: blob.size, magic, reason: "not_pdf"}});
  if (blob.size < {PDF_MIN_BYTES}) return JSON.stringify({{fetchStatus: r.status, size: blob.size, magic, reason: "tooSmall"}});
  const up = await fetch({json.dumps(RECV)} + "/" + {json.dumps(slug)}, {{method:"PUT", body:blob}});
  return JSON.stringify({{fetchStatus: r.status, size: blob.size, magic, upStatus: up.status, upBody: await up.text()}});
}}catch(e){{return "ERR " + e.message;}}}})()"""

        in_mem_status = "unknown"
        in_mem_detail = None
        try:
            result = proxy_eval(tid, js, timeout=120)
            val = result.get("value") or result.get("error") or str(result)
            if isinstance(val, str) and val.startswith("{"):
                parsed = json.loads(val)
                if parsed.get("upStatus") == 200 and parsed.get("size", 0) >= PDF_MIN_BYTES:
                    in_mem_status = "ok"
                    in_mem_detail = parsed
                else:
                    in_mem_status = "fail"
                    in_mem_detail = parsed
            else:
                in_mem_status = "error"
                in_mem_detail = val
        except Exception as e:
            in_mem_status = "exception"
            in_mem_detail = str(e)

        # Post-hoc disk verify: CDP eval can time out / throw (notably for
        # larger 7–13 MB PDFs — the browser doesn't wake the JS context back up
        # in time) while pdf_recv.py has already written a valid file. Trust
        # the file on disk over the in-memory fail classification.
        disk_ok, disk_size = disk_verify(target_path)
        if in_mem_status == "ok":
            size = in_mem_detail.get("size") if isinstance(in_mem_detail, dict) else disk_size
            return {
                "status": "ok",
                "size": size,
                "arnumber": arnumber,
                "post_hoc_verified": True,
            }
        if disk_ok and in_mem_status in ("fail", "error", "exception"):
            return {
                "status": "ok",
                "size": disk_size,
                "arnumber": arnumber,
                "recovered_from_cdp_timeout": True,
                "in_mem_detail": in_mem_detail,
                "post_hoc_verified": True,
            }
        row = {
            "status": in_mem_status if in_mem_status != "unknown" else "fail",
            "detail": in_mem_detail,
            "arnumber": arnumber,
            "post_hoc_verified": True,
        }
        if disk_size:
            row["disk_size"] = disk_size
        return row
    finally:
        close_tab(tid)


def main():
    queue_path = Path(sys.argv[1])
    queue = json.load(open(queue_path, encoding="utf-8"))
    print(f"[ieee] {len(queue)} papers to download (one fresh tab per paper)", file=sys.stderr)

    results = []
    for i, entry in enumerate(queue, 1):
        slug = entry["paper_slug"]
        doi = entry["doi"]
        tgt = entry["target_path"]

        # Skip already-downloaded (disk-verify: magic + 10 KB floor).
        pre_ok, pre_size = disk_verify(tgt)
        if pre_ok:
            print(f"[ieee] {i}/{len(queue)} {slug[:50]} SKIP (already on disk)", file=sys.stderr)
            results.append({
                "slug": slug,
                "status": "skipped",
                "size": pre_size,
                "post_hoc_verified": True,
            })
            continue

        try:
            r = download_one(doi, slug, tgt)
            if r["status"] == "ok" and r.get("recovered_from_cdp_timeout"):
                print(
                    f"[ieee] {i}/{len(queue)} {slug[:50]} RECOVERED ({r['size']:,} B on disk, "
                    f"in-mem was {r.get('in_mem_detail')})",
                    file=sys.stderr,
                )
            elif r["status"] == "ok":
                print(f"[ieee] {i}/{len(queue)} {slug[:50]} OK ({r['size']:,} B)", file=sys.stderr)
            else:
                print(f"[ieee] {i}/{len(queue)} {slug[:50]} FAIL: {r}", file=sys.stderr)
            results.append({"slug": slug, **r})
        except Exception as e:
            print(f"[ieee] {i}/{len(queue)} {slug[:50]} EXC: {e}", file=sys.stderr)
            results.append({"slug": slug, "status": "exception", "detail": str(e)})

        time.sleep(DELAY_BETWEEN)

    ok = sum(1 for r in results if r["status"] == "ok")
    skipped = sum(1 for r in results if r["status"] == "skipped")
    failed = len(results) - ok - skipped
    print(f"\n[ieee] Done. ok={ok} skipped={skipped} failed={failed}", file=sys.stderr)

    out = queue_path.parent / "ieee_download_result.json"
    out.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[ieee] summary: {out}", file=sys.stderr)


if __name__ == "__main__":
    main()
