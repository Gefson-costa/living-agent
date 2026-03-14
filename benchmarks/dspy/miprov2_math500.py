#!/usr/bin/env python3
"""
DSPy MIPROv2 optimizer on MATH-500.

Runs MIPROv2 (Mixed-Initiative Prompt Optimization v2) on MATH-500,
outputs JSON results to benchmarks/results/miprov2-math500.json.

Usage:
    pip install -r benchmarks/dspy/requirements.txt
    DEEPSEEK_API_KEY=... python benchmarks/dspy/miprov2_math500.py
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
OUTPUT_PATH = RESULTS_DIR / "miprov2-math500.json"


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

    # MATH metric for MIPROv2
    def math_metric(example, prediction, trace=None):
        gold = example.answer
        response = prediction.answer if hasattr(prediction, "answer") else str(prediction)
        extracted = extract_boxed(response)
        if extracted is None:
            return False
        return answers_match(gold, extracted)

    # ── Run MIPROv2 ──────────────────────────────────────────────────
    print("\n=== DSPy MIPROv2 (MATH-500) ===")
    start = time.time()
    results = {}

    try:
        mipro = dspy.MIPROv2(
            metric=math_metric,
            auto="medium",
            num_threads=4,
        )
        optimized_module = mipro.compile(MATHSolver(), trainset=train_examples)

        mipro_results = evaluate_module(optimized_module, eval_data)
        mipro_results["duration_s"] = time.time() - start
        results["miprov2"] = mipro_results

        print(
            f"MIPROv2 accuracy: {mipro_results['accuracy']:.1%} "
            f"({mipro_results['correct']}/{mipro_results['total']})"
        )
    except Exception as e:
        print(f"MIPROv2 failed: {e}", file=sys.stderr)
        results["miprov2"] = {
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
