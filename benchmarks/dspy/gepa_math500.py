#!/usr/bin/env python3
"""
DSPy GEPA optimizer on MATH-500.

Runs GEPA (Genetic Prompt Adaptation) budget-matched against Living-Agent,
outputs JSON results to benchmarks/results/gepa-math500.json.

Usage:
    pip install -r benchmarks/dspy/requirements.txt
    DEEPSEEK_API_KEY=... python benchmarks/dspy/gepa_math500.py
"""

import json
import os
import sys
import time
from pathlib import Path

# Import shared utilities from math500_baseline
sys.path.insert(0, str(Path(__file__).parent))
from math500_baseline import (
    detect_provider,
    evaluate_module,
    extract_boxed,
    answers_match,
    MATHSolver,
    SolveMATH,
)

import dspy

# ── Paths ──────────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).parent
DATA_DIR = SCRIPT_DIR.parent / "data"
RESULTS_DIR = SCRIPT_DIR.parent / "results"
RESULTS_DIR.mkdir(exist_ok=True)

TRAIN_PATH = DATA_DIR / "math500-train-250.json"
EVAL_PATH = DATA_DIR / "math500-eval-250.json"
OUTPUT_PATH = RESULTS_DIR / "gepa-math500.json"


def load_data(path: Path) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))


def main():
    model, api_key, api_base = detect_provider()

    lm = dspy.LM(
        model=model,
        api_key=api_key,
        api_base=api_base,
        temperature=0.0,
        max_tokens=2048,
    )
    dspy.configure(lm=lm)

    train_data = load_data(TRAIN_PATH)
    eval_data = load_data(EVAL_PATH)

    # Prepare training examples
    train_examples = []
    for item in train_data[:50]:
        train_examples.append(
            dspy.Example(
                problem=item["problem"],
                answer=item["answer"],
            ).with_inputs("problem")
        )

    # MATH metric for GEPA
    def math_metric(example, prediction, trace=None):
        gold = example.answer
        response = prediction.answer if hasattr(prediction, "answer") else str(prediction)
        extracted = extract_boxed(response)
        if extracted is None:
            return False
        return answers_match(gold, extracted)

    # ── Run GEPA ─────────────────────────────────────────────────────
    print("\n=== DSPy GEPA (MATH-500) ===")
    start = time.time()
    results = {}

    try:
        gepa = dspy.GEPA(
            metric=math_metric,
            max_iterations=20,  # Budget-matched to Living-Agent cycles
        )
        optimized_module = gepa.compile(MATHSolver(), trainset=train_examples)

        gepa_results = evaluate_module(optimized_module, eval_data)
        gepa_results["duration_s"] = time.time() - start
        results["gepa"] = gepa_results

        print(
            f"GEPA accuracy: {gepa_results['accuracy']:.1%} "
            f"({gepa_results['correct']}/{gepa_results['total']})"
        )
    except Exception as e:
        print(f"GEPA failed: {e}", file=sys.stderr)
        results["gepa"] = {
            "accuracy": 0,
            "correct": 0,
            "total": len(eval_data),
            "error": str(e)[:500],
            "duration_s": time.time() - start,
        }

    # ── Save results ──────────────────────────────────────────────────
    OUTPUT_PATH.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(f"\nResults saved to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
