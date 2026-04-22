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
    for i, entry in enumerate(queue, 1):
        slug = entry["paper_slug"]
        doi = entry["doi"]
        pdf_url = entry["acm_url"]
        tgt = entry["target_path"]

        # Skip already-downloaded
        if Path(tgt).exists() and Path(tgt).stat().st_size > 100_000:
            print(f"[acm] {i}/{len(queue)} {slug[:50]} SKIP (already on disk)", file=sys.stderr)
            results.append({"slug": slug, "status": "skipped", "size": Path(tgt).stat().st_size})
            continue

        js = f"""(async()=>{{try{{
  const r = await fetch({json.dumps(pdf_url)}, {{credentials:"include"}});
  if (r.status !== 200) return JSON.stringify({{fetchStatus: r.status}});
  const blob = await r.blob();
  if (!blob.type.includes("pdf")) return JSON.stringify({{fetchStatus: r.status, type: blob.type, size: blob.size}});
  const up = await fetch({json.dumps(RECV)} + "/" + {json.dumps(slug)}, {{method:"PUT", body:blob}});
  return JSON.stringify({{fetchStatus: r.status, type: blob.type, size: blob.size, upStatus: up.status, upBody: await up.text()}});
}}catch(e){{return "ERR " + e.message;}}}})()"""

        try:
            result = proxy_eval(tid, js, timeout=90)
            val = result.get("value") or result.get("error") or str(result)
            if isinstance(val, str) and val.startswith("{"):
                parsed = json.loads(val)
                if parsed.get("upStatus") == 200 and parsed.get("size", 0) > 100_000:
                    print(f"[acm] {i}/{len(queue)} {slug[:50]} OK ({parsed['size']:,} B)", file=sys.stderr)
                    results.append({"slug": slug, "status": "ok", "size": parsed["size"]})
                else:
                    print(f"[acm] {i}/{len(queue)} {slug[:50]} FAIL: {parsed}", file=sys.stderr)
                    results.append({"slug": slug, "status": "fail", "detail": parsed})
            else:
                print(f"[acm] {i}/{len(queue)} {slug[:50]} ERR: {val}", file=sys.stderr)
                results.append({"slug": slug, "status": "error", "detail": val})
        except Exception as e:
            print(f"[acm] {i}/{len(queue)} {slug[:50]} EXC: {e}", file=sys.stderr)
            results.append({"slug": slug, "status": "exception", "detail": str(e)})

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


if __name__ == "__main__":
    main()
