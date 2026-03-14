#!/usr/bin/env python3
"""
DSPy MATH-500 Baseline — Zero-shot CoT + BootstrapFewShot.

Runs both methods on the same 250 eval problems that living-agent uses,
outputs JSON results to benchmarks/results/dspy-math500.json.

Provider auto-detection (first available wins):
    DEEPSEEK_API_KEY  -> deepseek/deepseek-chat
    OPENROUTER_API_KEY -> openrouter/anthropic/claude-3.5-haiku
    TOGETHER_API_KEY  -> together_ai/meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo

Usage:
    pip install -r benchmarks/dspy/requirements.txt
    DEEPSEEK_API_KEY=... python benchmarks/dspy/math500_baseline.py
"""

import json
import os
import re
import sys
import time
from pathlib import Path

import dspy

# ── Paths ──────────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).parent
DATA_DIR = SCRIPT_DIR.parent / "data"
RESULTS_DIR = SCRIPT_DIR.parent / "results"
RESULTS_DIR.mkdir(exist_ok=True)

TRAIN_PATH = DATA_DIR / "math500-train-250.json"
EVAL_PATH = DATA_DIR / "math500-eval-250.json"
OUTPUT_PATH = RESULTS_DIR / "dspy-math500.json"


# ── Answer extraction (mirrors TypeScript extractBoxed + normalizeLatex) ──

def extract_boxed(text: str) -> str | None:
    r"""Extract content from the last \boxed{...} in text, handling nested braces."""
    marker = r"\boxed{"
    idx = text.rfind(marker)
    if idx == -1:
        return None
    start = idx + len(marker)
    depth = 1
    i = start
    while i < len(text) and depth > 0:
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
        i += 1
    if depth != 0:
        return None
    return text[start : i - 1]


def normalize_latex(s: str) -> str:
    r"""Normalize a LaTeX answer string for comparison."""
    s = s.strip()
    s = s.replace(r"\left", "").replace(r"\right", "")
    s = s.replace(r"\,", "").replace(r"\!", "")
    s = s.replace(r"\dfrac", r"\frac").replace(r"\tfrac", r"\frac")
    s = re.sub(r"\s+", "", s)
    s = s.lower()
    return s


def try_parse_numeric(s: str) -> float | None:
    """Try to parse a LaTeX string as a number."""
    normalized = normalize_latex(s)
    # Simple fraction: \frac{a}{b}
    m = re.match(r"^\\frac\{([^{}]+)\}\{([^{}]+)\}$", normalized)
    if m:
        try:
            num = float(m.group(1))
            den = float(m.group(2))
            if den != 0:
                return num / den
        except ValueError:
            pass
    # Plain number
    cleaned = normalized.replace(",", "")
    try:
        val = float(cleaned)
        if not (val != val):  # not NaN
            return val
    except ValueError:
        pass
    return None


def answers_match(gold: str, predicted: str) -> bool:
    """Check if two MATH answers are equivalent."""
    norm_gold = normalize_latex(gold)
    norm_pred = normalize_latex(predicted)

    # Exact normalized string match
    if norm_pred == norm_gold:
        return True

    # Numeric equivalence
    gold_num = try_parse_numeric(gold)
    pred_num = try_parse_numeric(predicted)
    if gold_num is not None and pred_num is not None:
        return abs(gold_num - pred_num) < 1e-6

    return False


# ── DSPy Signature + Module ────────────────────────────────────────

class SolveMATH(dspy.Signature):
    """Solve a competition-level math problem step by step. Put your final answer in \\boxed{}."""
    problem: str = dspy.InputField(desc="A competition-level math problem")
    answer: str = dspy.OutputField(desc="Step-by-step solution with final answer in \\boxed{}")


class MATHSolver(dspy.Module):
    def __init__(self):
        super().__init__()
        self.cot = dspy.ChainOfThought(SolveMATH)

    def forward(self, problem: str):
        return self.cot(problem=problem)


# ── Evaluation ─────────────────────────────────────────────────────

def load_data(path: Path) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))


def evaluate_module(module: dspy.Module, eval_data: list[dict]) -> dict:
    """Run module on all eval problems, return accuracy + per-item results."""
    correct = 0
    total = len(eval_data)
    per_item = []

    for item in eval_data:
        try:
            result = module(problem=item["problem"])
            response_text = result.answer if hasattr(result, "answer") else str(result)
            extracted = extract_boxed(response_text)

            if extracted is not None:
                is_correct = answers_match(item["answer"], extracted)
            else:
                is_correct = False

            if is_correct:
                correct += 1
            per_item.append({
                "id": item["id"],
                "gold": item["answer"],
                "predicted": extracted,
                "correct": is_correct,
            })
        except Exception as e:
            per_item.append({
                "id": item["id"],
                "gold": item["answer"],
                "predicted": None,
                "correct": False,
                "error": str(e)[:200],
            })

        # Progress indicator
        done = len(per_item)
        if done % 25 == 0 or done == total:
            print(f"  [{done}/{total}] accuracy so far: {correct}/{done} = {correct/done:.1%}")

    return {
        "accuracy": correct / total if total > 0 else 0,
        "correct": correct,
        "total": total,
        "per_item": per_item,
    }


# ── Main ───────────────────────────────────────────────────────────

def detect_provider() -> tuple[str, str, str]:
    """Auto-detect the best available LLM provider. Returns (model, api_key, api_base)."""
    candidates = [
        ("DEEPSEEK_API_KEY", "deepseek/deepseek-chat", "https://api.deepseek.com"),
        ("OPENROUTER_API_KEY", "openrouter/anthropic/claude-3.5-haiku", "https://openrouter.ai/api/v1"),
        ("TOGETHER_API_KEY", "together_ai/meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo", "https://api.together.xyz/v1"),
    ]
    for env_key, model, api_base in candidates:
        key = os.environ.get(env_key)
        if key:
            print(f"  [DSPy] Using {env_key} -> {model}")
            return model, key, api_base

    print("ERROR: No API key found. Set one of: DEEPSEEK_API_KEY, OPENROUTER_API_KEY, TOGETHER_API_KEY", file=sys.stderr)
    sys.exit(1)


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

    results = {}

    # ── Phase 1: Zero-shot Chain of Thought ────────────────────────
    print("\n=== DSPy Zero-Shot Chain of Thought (MATH-500) ===")
    start = time.time()
    zeroshot_module = MATHSolver()
    zeroshot_results = evaluate_module(zeroshot_module, eval_data)
    zeroshot_results["duration_s"] = time.time() - start
    results["zeroshot"] = zeroshot_results

    print(f"Zero-shot accuracy: {zeroshot_results['accuracy']:.1%} "
          f"({zeroshot_results['correct']}/{zeroshot_results['total']})")

    # Checkpoint: save zero-shot results in case bootstrap fails
    OUTPUT_PATH.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(f"  (checkpointed to {OUTPUT_PATH})")

    # ── Phase 2: BootstrapFewShot ─────────────────────────────────
    print("\n=== DSPy BootstrapFewShot (MATH-500) ===")
    start = time.time()
    try:
        # Prepare training examples for bootstrap
        train_examples = []
        for item in train_data[:50]:  # Use 50 train examples
            train_examples.append(
                dspy.Example(
                    problem=item["problem"],
                    answer=item["answer"],
                ).with_inputs("problem")
            )

        # MATH metric for DSPy
        def math_metric(example, prediction, trace=None):
            gold = example.answer
            response = prediction.answer if hasattr(prediction, "answer") else str(prediction)
            extracted = extract_boxed(response)
            if extracted is None:
                return False
            return answers_match(gold, extracted)

        # Bootstrap
        bootstrap = dspy.BootstrapFewShot(
            metric=math_metric,
            max_bootstrapped_demos=8,
            max_labeled_demos=4,
        )
        optimized_module = bootstrap.compile(MATHSolver(), trainset=train_examples)

        # Evaluate optimized module
        bootstrap_results = evaluate_module(optimized_module, eval_data)
        bootstrap_results["duration_s"] = time.time() - start
        results["bootstrap"] = bootstrap_results

        print(f"Bootstrap accuracy: {bootstrap_results['accuracy']:.1%} "
              f"({bootstrap_results['correct']}/{bootstrap_results['total']})")
    except Exception as e:
        print(f"Bootstrap failed: {e}", file=sys.stderr)
        results["bootstrap"] = {
            "accuracy": 0,
            "correct": 0,
            "total": len(eval_data),
            "error": str(e)[:500],
            "duration_s": time.time() - start,
        }

    # ── Save final results ─────────────────────────────────────────
    OUTPUT_PATH.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(f"\nResults saved to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
