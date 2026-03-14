#!/usr/bin/env python3
"""
One-time utility to download SWE-bench Verified from HuggingFace and produce
swebench-train-250.json and swebench-eval-250.json.

Usage:
    pip install datasets
    python benchmarks/data/fetch-swebench.py
"""

import json
import random
import re
from pathlib import Path

from datasets import load_dataset

OUTPUT_DIR = Path(__file__).parent


def extract_files_changed(patch: str) -> list[str]:
    """Extract file paths from unified diff +++ b/path headers."""
    files = []
    for line in patch.splitlines():
        m = re.match(r"^\+\+\+ b/(.+)$", line)
        if m:
            files.append(m.group(1))
    return files


def difficulty_label(hints: str | None) -> str:
    """Map SWE-bench difficulty hints to a label."""
    if not hints:
        return "unknown"
    h = hints.lower()
    if "15 min" in h:
        return "15 min fix"
    if "1 hour" in h or "1 hr" in h:
        return "1 hour"
    if "4 hour" in h or "4 hr" in h:
        return "4 hours"
    return hints.strip()[:40]


def main():
    ds = load_dataset("princeton-nlp/SWE-bench_Verified", split="test")

    items = []
    for row in ds:
        patch = row.get("patch", "")
        files_changed = extract_files_changed(patch)
        items.append({
            "instance_id": row["instance_id"],
            "repo": row["repo"],
            "base_commit": row.get("base_commit", ""),
            "problem_statement": row["problem_statement"],
            "patch": patch,
            "files_changed": files_changed,
            "difficulty": difficulty_label(row.get("difficulty", None)),
            "hints_text": row.get("hints_text", ""),
        })

    # Deterministic shuffle
    random.seed(42)
    random.shuffle(items)

    # Split: first 250 train, next 250 eval
    train_items = items[:250]
    eval_items = items[250:500]

    # Assign split-specific IDs
    for i, item in enumerate(train_items):
        item["id"] = f"swebench_train_{i}"
    for i, item in enumerate(eval_items):
        item["id"] = f"swebench_eval_{i}"

    # Write JSON
    train_path = OUTPUT_DIR / "swebench-train-250.json"
    eval_path = OUTPUT_DIR / "swebench-eval-250.json"

    train_path.write_text(json.dumps(train_items, indent=2, ensure_ascii=False), encoding="utf-8")
    eval_path.write_text(json.dumps(eval_items, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"Wrote {len(train_items)} train items to {train_path}")
    print(f"Wrote {len(eval_items)} eval items to {eval_path}")

    # Sanity check: show distribution of repos and file counts
    repos: dict[str, int] = {}
    for item in items[:500]:
        repo = item["repo"]
        repos[repo] = repos.get(repo, 0) + 1

    print(f"\nTotal instances: {len(items)}")
    print(f"Train: {len(train_items)}, Eval: {len(eval_items)}")
    print(f"\nRepo distribution (top 10):")
    for repo, count in sorted(repos.items(), key=lambda x: -x[1])[:10]:
        print(f"  {repo}: {count}")

    avg_files = sum(len(item["files_changed"]) for item in items[:500]) / 500
    print(f"\nAvg files changed per issue: {avg_files:.1f}")

    # Sample
    print(f"\nSample items:")
    for item in train_items[:3]:
        print(f"  {item['instance_id']}: {item['repo']} ({len(item['files_changed'])} files, {item['difficulty']})")
        print(f"    Issue: {item['problem_statement'][:80]}...")


if __name__ == "__main__":
    main()
