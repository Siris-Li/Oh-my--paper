#!/usr/bin/env python3
"""Batch-download the ACM queue through a Chrome CDP tab.

Flow per paper:
  1. Navigate the bootstrap tab to dl.acm.org/doi/{DOI}  (session warmup)
  2. JS: fetch(/doi/pdf/{DOI}, cred:include) -> blob -> PUT http://localhost:9876/{slug}
  3. pdf_recv.py writes the blob to the paper's target_path

Sequential on purpose: parallel fetches on dl.acm.org may trigger WAF.
"""
import json
import sys
import time
import requests
from pathlib import Path


PROXY = "http://localhost:3456"
RECV = "http://localhost:9876"
DELAY_BETWEEN = 2.0  # seconds

# Post-hoc disk verify: a real PDF written by pdf_recv.py must start with "%PDF-"
# and be at least 10 KB. Some valid ACM papers are as small as 133 KB, so the
# old 200 KB "tooSmall" threshold was overly aggressive; 10 KB is the sane floor
# for "this is a real PDF file at all". Magic-bytes is the authoritative signal.
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


def proxy_eval(tid: str, js: str, timeout: int = 60) -> dict:
    r = requests.post(f"{PROXY}/eval", params={"target": tid}, data=js, timeout=timeout)
    return r.json()


def proxy_navigate(tid: str, url: str) -> dict:
    return requests.get(f"{PROXY}/navigate", params={"target": tid, "url": url}, timeout=30).json()


def open_tab(url: str) -> str:
    r = requests.get(f"{PROXY}/new", params={"url": url}, timeout=30).json()
    return r["targetId"]


def close_tab(tid: str):
    try:
        requests.get(f"{PROXY}/close", params={"target": tid}, timeout=10)
    except Exception:
        pass


def main():
    queue_path = Path(sys.argv[1])
    queue = json.load(open(queue_path, encoding="utf-8"))
    print(f"[acm] {len(queue)} papers to download", file=sys.stderr)

    # Bootstrap: open one landing page to warm the session
    first = queue[0]
    tid = open_tab(f"https://dl.acm.org/doi/{first['doi']}")
    print(f"[acm] tab {tid[:16]} opened at landing", file=sys.stderr)
    time.sleep(4)

    results = []
    paywall_retry = []  # 403s re-queued so the user can re-run after login
    for i, entry in enumerate(queue, 1):
        slug = entry["paper_slug"]
        doi = entry["doi"]
        pdf_url = entry["acm_url"]
        tgt = entry["target_path"]

        # Skip already-downloaded (disk-verify: magic + 10 KB floor).
        pre_ok, pre_size = disk_verify(tgt)
        if pre_ok:
            print(f"[acm] {i}/{len(queue)} {slug[:50]} SKIP (already on disk)", file=sys.stderr)
            results.append({
                "slug": slug,
                "status": "skipped",
                "size": pre_size,
                "post_hoc_verified": True,
            })
            continue

        # Magic-bytes first, then 10 KB floor — drop the old 200 KB tooSmall gate.
        js = f"""(async()=>{{try{{
  const r = await fetch({json.dumps(pdf_url)}, {{credentials:"include"}});
  if (r.status !== 200) return JSON.stringify({{fetchStatus: r.status}});
  const blob = await r.blob();
  const head = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
  const magic = String.fromCharCode(head[0], head[1], head[2], head[3], head[4]);
  if (magic !== "%PDF-") return JSON.stringify({{fetchStatus: r.status, type: blob.type, size: blob.size, magic, reason: "not_pdf"}});
  if (blob.size < {PDF_MIN_BYTES}) return JSON.stringify({{fetchStatus: r.status, type: blob.type, size: blob.size, magic, reason: "tooSmall"}});
  const up = await fetch({json.dumps(RECV)} + "/" + {json.dumps(slug)}, {{method:"PUT", body:blob}});
  return JSON.stringify({{fetchStatus: r.status, type: blob.type, size: blob.size, magic, upStatus: up.status, upBody: await up.text()}});
}}catch(e){{return "ERR " + e.message;}}}})()"""

        in_mem_status = "unknown"
        in_mem_detail = None
        fetch_status = None
        try:
            result = proxy_eval(tid, js, timeout=90)
            val = result.get("value") or result.get("error") or str(result)
            if isinstance(val, str) and val.startswith("{"):
                parsed = json.loads(val)
                fetch_status = parsed.get("fetchStatus")
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

        # Post-hoc disk verify: CDP eval can time out / throw while pdf_recv.py
        # already wrote a valid file. Trust the file on disk over the in-memory
        # fail classification when magic + size pass.
        disk_ok, disk_size = disk_verify(tgt)
        row = {"slug": slug, "post_hoc_verified": True}
        if in_mem_status == "ok":
            row["status"] = "ok"
            row["size"] = in_mem_detail.get("size") if isinstance(in_mem_detail, dict) else disk_size
            print(f"[acm] {i}/{len(queue)} {slug[:50]} OK ({row['size']:,} B)", file=sys.stderr)
        elif disk_ok and in_mem_status in ("fail", "error", "exception"):
            # Rescue: file is real on disk even though CDP path didn't confirm.
            row["status"] = "ok"
            row["size"] = disk_size
            row["recovered_from_cdp_timeout"] = True
            row["in_mem_detail"] = in_mem_detail
            print(
                f"[acm] {i}/{len(queue)} {slug[:50]} RECOVERED ({disk_size:,} B on disk, "
                f"in-mem was {in_mem_status})",
                file=sys.stderr,
            )
        else:
            row["status"] = in_mem_status if in_mem_status != "unknown" else "fail"
            row["detail"] = in_mem_detail
            if disk_size:
                row["disk_size"] = disk_size
            print(f"[acm] {i}/{len(queue)} {slug[:50]} FAIL: {in_mem_detail}", file=sys.stderr)
            # Queue 403 for paywall retry after user logs in.
            if fetch_status == 403:
                paywall_retry.append(entry)
        results.append(row)

        time.sleep(DELAY_BETWEEN)

        # Every 10 papers, re-navigate to refresh session (avoid stale cookies)
        if i % 10 == 0 and i < len(queue):
            next_doi = queue[i]["doi"] if i < len(queue) else doi
            proxy_navigate(tid, f"https://dl.acm.org/doi/{next_doi}")
            time.sleep(3)

    close_tab(tid)

    ok = sum(1 for r in results if r["status"] == "ok")
    skipped = sum(1 for r in results if r["status"] == "skipped")
    failed = len(results) - ok - skipped
    print(f"\n[acm] Done. ok={ok} skipped={skipped} failed={failed}", file=sys.stderr)

    # Write summary
    out = queue_path.parent / "acm_download_result.json"
    out.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[acm] summary: {out}", file=sys.stderr)

    # Emit paywall retry queue so the user can re-run after institutional login.
    if paywall_retry:
        retry_path = queue_path.parent / "paywall_retry_queue.json"
        retry_path.write_text(
            json.dumps(paywall_retry, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(
            f"[acm] {len(paywall_retry)} papers hit 403; retry queue at {retry_path}",
            file=sys.stderr,
        )


if __name__ == "__main__":
    main()
