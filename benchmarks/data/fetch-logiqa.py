#!/usr/bin/env python3
"""
One-time utility to download LogiQA from HuggingFace datasets-server API
and produce logiqa-train-200.json and logiqa-eval-200.json.

Usage:
    python benchmarks/data/fetch-logiqa.py
"""

import json
import urllib.request
from pathlib import Path

OUTPUT_DIR = Path(__file__).parent

API_BASE = "https://datasets-server.huggingface.co/rows"
DATASET = "lucasmccabe/logiqa"
CONFIG = "default"


def fetch_rows(split: str, offset: int, length: int) -> list[dict]:
    url = f"{API_BASE}?dataset={DATASET}&config={CONFIG}&split={split}&offset={offset}&length={length}"
    print(f"  Fetching {split} offset={offset} length={length}...")
    req = urllib.request.Request(url, headers={"User-Agent": "living-agent/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read())
    return [row["row"] for row in data["rows"]]


def main():
    # Train split: first 200
    train_rows = fetch_rows("train", 0, 100) + fetch_rows("train", 100, 100)
    train_items = []
    for i, row in enumerate(train_rows):
        train_items.append({
            "id": f"logiqa_train_{i}",
            "context": row["context"],
            "query": row["query"],
            "options": row["options"],
            "correct_option": row["correct_option"],
        })

    # Test split: first 200
    test_rows = fetch_rows("test", 0, 100) + fetch_rows("test", 100, 100)
    eval_items = []
    for i, row in enumerate(test_rows):
        eval_items.append({
            "id": f"logiqa_eval_{i}",
            "context": row["context"],
            "query": row["query"],
            "options": row["options"],
            "correct_option": row["correct_option"],
        })

    # Write JSON
    train_path = OUTPUT_DIR / "logiqa-train-200.json"
    eval_path = OUTPUT_DIR / "logiqa-eval-200.json"

    train_path.write_text(json.dumps(train_items, indent=2, ensure_ascii=False), encoding="utf-8")
    eval_path.write_text(json.dumps(eval_items, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"Wrote {len(train_items)} train items to {train_path}")
    print(f"Wrote {len(eval_items)} eval items to {eval_path}")

    # Sanity check: answer distribution
    for split_name, items in [("train", train_items), ("eval", eval_items)]:
        dist = [0, 0, 0, 0]
        for item in items:
            dist[item["correct_option"]] += 1
        print(f"{split_name} answer distribution: A={dist[0]} B={dist[1]} C={dist[2]} D={dist[3]}")


if __name__ == "__main__":
    main()
