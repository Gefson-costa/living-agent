#!/usr/bin/env python3
"""
One-time utility to download MATH-500 from HuggingFace and produce
math500-train-250.json and math500-eval-250.json.

The HuggingFaceH4/MATH-500 dataset has a dedicated 'answer' field
with the pre-extracted answer (no \boxed{} wrapper needed).

Usage:
    pip install datasets
    python benchmarks/data/fetch-math500.py
"""

import json
from pathlib import Path

from datasets import load_dataset

OUTPUT_DIR = Path(__file__).parent


def main():
    ds = load_dataset("HuggingFaceH4/MATH-500", split="test")

    items = []
    for i, row in enumerate(ds):
        # The 'answer' field already contains the extracted answer string
        items.append({
            "id": f"math500_{i}",
            "problem": row["problem"],
            "answer": row["answer"].strip(),
            "subject": row.get("subject", row.get("type", "unknown")),
            "level": row.get("level", "unknown"),
        })

    # Split: first 250 train, last 250 eval
    train_items = []
    for i, item in enumerate(items[:250]):
        train_items.append({**item, "id": f"math500_train_{i}"})

    eval_items = []
    for i, item in enumerate(items[250:]):
        eval_items.append({**item, "id": f"math500_eval_{i}"})

    # Write JSON
    train_path = OUTPUT_DIR / "math500-train-250.json"
    eval_path = OUTPUT_DIR / "math500-eval-250.json"

    train_path.write_text(json.dumps(train_items, indent=2, ensure_ascii=False), encoding="utf-8")
    eval_path.write_text(json.dumps(eval_items, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"Wrote {len(train_items)} train items to {train_path}")
    print(f"Wrote {len(eval_items)} eval items to {eval_path}")

    # Sanity check: show distribution of subjects and levels
    subjects = {}
    levels = {}
    for item in items:
        subjects[item["subject"]] = subjects.get(item["subject"], 0) + 1
        levels[str(item["level"])] = levels.get(str(item["level"]), 0) + 1

    print("\nSubject distribution:")
    for subj, count in sorted(subjects.items()):
        print(f"  {subj}: {count}")
    print("\nLevel distribution:")
    for level, count in sorted(levels.items()):
        print(f"  Level {level}: {count}")

    # Sanity check: verify all answers extracted successfully
    print(f"\nSample answers:")
    for item in items[:5]:
        print(f"  {item['id']}: {item['answer']}")


if __name__ == "__main__":
    main()
