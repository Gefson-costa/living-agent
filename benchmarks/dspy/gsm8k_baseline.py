#!/usr/bin/env python3
"""
DSPy GSM8K Baseline — Zero-shot CoT + BootstrapFewShot.

Runs both methods on the same 200 eval problems that living-agent uses,
outputs JSON results to benchmarks/results/dspy-gsm8k.json.

Provider auto-detection (first available wins):
    DEEPSEEK_API_KEY  -> deepseek/deepseek-chat
    OPENROUTER_API_KEY -> openrouter/anthropic/claude-3.5-haiku
    TOGETHER_API_KEY  -> together_ai/meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo

Usage:
    pip install -r benchmarks/dspy/requirements.txt
    DEEPSEEK_API_KEY=... python benchmarks/dspy/gsm8k_baseline.py
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

TRAIN_PATH = DATA_DIR / "gsm8k-train-200.json"
EVAL_PATH = DATA_DIR / "gsm8k-eval-200.json"
OUTPUT_PATH = RESULTS_DIR / "dspy-gsm8k.json"


# ── Answer extraction (mirrors TypeScript extractAnswer) ───────────

def extract_answer(response: str) -> int | None:
    """Extract last number from text, strip commas, round to int."""
    cleaned = re.sub(r"(\d),(\d)", r"\1\2", response)
    matches = re.findall(r"-?\d+\.?\d*", cleaned)
    if not matches:
        return None
    try:
        return round(float(matches[-1]))
    except (ValueError, OverflowError):
        return None


# ── DSPy Signature + Module ────────────────────────────────────────

class SolveGSM8K(dspy.Signature):
    """Solve a grade-school math problem step by step."""
    question: str = dspy.InputField(desc="A grade-school math word problem")
    answer: str = dspy.OutputField(desc="The final numeric answer (integer only)")


class GSM8KSolver(dspy.Module):
    def __init__(self):
        super().__init__()
        self.cot = dspy.ChainOfThought(SolveGSM8K)

    def forward(self, question: str):
        return self.cot(question=question)


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
            result = module(question=item["question"])
            response_text = result.answer if hasattr(result, "answer") else str(result)
            predicted = extract_answer(response_text)
            gold = int(item["answer"])
            is_correct = predicted == gold
            if is_correct:
                correct += 1
            per_item.append({
                "id": item["id"],
                "gold": gold,
                "predicted": predicted,
                "correct": is_correct,
            })
        except Exception as e:
            per_item.append({
                "id": item["id"],
                "gold": int(item["answer"]),
                "predicted": None,
                "correct": False,
                "error": str(e)[:200],
            })

        # Progress indicator
        done = len(per_item)
        if done % 20 == 0 or done == total:
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
    print("\n=== DSPy Zero-Shot Chain of Thought ===")
    start = time.time()
    zeroshot_module = GSM8KSolver()
    zeroshot_results = evaluate_module(zeroshot_module, eval_data)
    zeroshot_results["duration_s"] = time.time() - start
    results["zeroshot"] = zeroshot_results

    print(f"Zero-shot accuracy: {zeroshot_results['accuracy']:.1%} "
          f"({zeroshot_results['correct']}/{zeroshot_results['total']})")

    # Checkpoint: save zero-shot results in case bootstrap fails
    OUTPUT_PATH.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(f"  (checkpointed to {OUTPUT_PATH})")

    # ── Phase 2: BootstrapFewShot ─────────────────────────────────
    print("\n=== DSPy BootstrapFewShot ===")
    start = time.time()
    try:
        # Prepare training examples for bootstrap
        train_examples = []
        for item in train_data[:50]:  # Use 50 train examples
            train_examples.append(
                dspy.Example(
                    question=item["question"],
                    answer=item["answer"],
                ).with_inputs("question")
            )

        # GSM8K metric for DSPy
        def gsm8k_metric(example, prediction, trace=None):
            gold = int(example.answer)
            pred = extract_answer(prediction.answer if hasattr(prediction, "answer") else str(prediction))
            return pred == gold

        # Bootstrap
        bootstrap = dspy.BootstrapFewShot(
            metric=gsm8k_metric,
            max_bootstrapped_demos=8,
            max_labeled_demos=4,
        )
        optimized_module = bootstrap.compile(GSM8KSolver(), trainset=train_examples)

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
