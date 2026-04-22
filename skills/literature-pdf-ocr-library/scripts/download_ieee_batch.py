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

        js = f"""(async()=>{{try{{
  const r = await fetch({json.dumps(pdf_url)}, {{credentials:"include", redirect:"follow"}});
  const ct = r.headers.get("content-type") || "";
  if (!ct.includes("pdf")) {{
    const txt = await r.text();
    return JSON.stringify({{fetchStatus: r.status, ct, snippet: txt.slice(0, 300)}});
  }}
  const blob = await r.blob();
  if (blob.size < 10000) return JSON.stringify({{fetchStatus: r.status, size: blob.size, tooSmall: true}});
  const up = await fetch({json.dumps(RECV)} + "/" + {json.dumps(slug)}, {{method:"PUT", body:blob}});
  return JSON.stringify({{fetchStatus: r.status, size: blob.size, upStatus: up.status, upBody: await up.text()}});
}}catch(e){{return "ERR " + e.message;}}}})()"""

        result = proxy_eval(tid, js, timeout=120)
        val = result.get("value") or result.get("error") or str(result)
        if isinstance(val, str) and val.startswith("{"):
            parsed = json.loads(val)
            if parsed.get("upStatus") == 200 and parsed.get("size", 0) > 100_000:
                return {"status": "ok", "size": parsed["size"], "arnumber": arnumber}
            return {"status": "fail", "detail": parsed, "arnumber": arnumber}
        return {"status": "error", "detail": val, "arnumber": arnumber}
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

        if Path(tgt).exists() and Path(tgt).stat().st_size > 100_000:
            print(f"[ieee] {i}/{len(queue)} {slug[:50]} SKIP (already on disk)", file=sys.stderr)
            results.append({"slug": slug, "status": "skipped"})
            continue

        try:
            r = download_one(doi, slug, tgt)
            if r["status"] == "ok":
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
