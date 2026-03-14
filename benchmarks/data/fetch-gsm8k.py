#!/usr/bin/env python3
"""
One-time utility to download GSM8K from HuggingFace and produce
gsm8k-train-200.json and gsm8k-eval-200.json.

Usage:
    pip install datasets
    python benchmarks/data/fetch-gsm8k.py
"""

import json
import re
from pathlib import Path

from datasets import load_dataset

OUTPUT_DIR = Path(__file__).parent


def extract_final_answer(answer_text: str) -> str:
    """Extract the numeric answer from GSM8K '#### <number>' format."""
    match = re.search(r"####\s*(.+)", answer_text)
    if not match:
        raise ValueError(f"No #### marker found in: {answer_text[:80]}")
    # Strip commas and whitespace: "1,234" -> "1234"
    return match.group(1).strip().replace(",", "")


def main():
    ds = load_dataset("openai/gsm8k", "main")

    # Train split: first 200
    train_items = []
    for i, row in enumerate(ds["train"]):
        if i >= 200:
            break
        answer = extract_final_answer(row["answer"])
        train_items.append({
            "id": f"gsm8k_train_{i}",
            "question": row["question"],
            "answer": answer,
        })

    # Test split: first 200 (GSM8K uses "test" not "validation")
    eval_items = []
    for i, row in enumerate(ds["test"]):
        if i >= 200:
            break
        answer = extract_final_answer(row["answer"])
        eval_items.append({
            "id": f"gsm8k_eval_{i}",
            "question": row["question"],
            "answer": answer,
        })

    # Write JSON
    train_path = OUTPUT_DIR / "gsm8k-train-200.json"
    eval_path = OUTPUT_DIR / "gsm8k-eval-200.json"

    train_path.write_text(json.dumps(train_items, indent=2), encoding="utf-8")
    eval_path.write_text(json.dumps(eval_items, indent=2), encoding="utf-8")

    print(f"Wrote {len(train_items)} train items to {train_path}")
    print(f"Wrote {len(eval_items)} eval items to {eval_path}")

    # Sanity check: all answers should be integers
    for split_name, items in [("train", train_items), ("eval", eval_items)]:
        for item in items:
            try:
                int(item["answer"])
            except ValueError:
                print(f"WARNING: non-integer answer in {split_name}: {item['id']} -> {item['answer']}")


if __name__ == "__main__":
    main()
