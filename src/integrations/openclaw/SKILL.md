---
name: living-agent
description: Adaptive strategy evolution for LLM responses. Automatically selects and evolves the best prompt strategy for each task type.
emoji: 🧬
requires:
  bins: []
  env: []
  config: []
---

# Living Agent

An adaptive strategy layer that evolves prompt configurations based on task performance.

## What it does

Living Agent maintains a population of competing strategies, each with different prompt styles, temperatures, and reasoning depths. It selects the best strategy for each task type and evolves them over time based on feedback.

## Commands

- `/evolve-status` — Show strategy population status (fitness, expertise, coverage)
- `/evolve-feedback <0-10>` — Rate the last response to improve strategy selection
- `/evolve-principles` — Show learned principles extracted from experience
- `/evolve-consolidate` — Manually trigger strategy evolution cycle

## How it works

1. Each task is classified by type (coding, research, analysis, creative, summarization, general)
2. The best strategy is selected based on task-type expertise and fitness
3. The strategy configures prompt style, temperature, and reasoning depth
4. After the response, self-evaluation and optional user feedback update fitness
5. Every 20 interactions, strategies evolve: top performers reproduce, bottom are replaced

## When to use feedback

After receiving a response, use `/evolve-feedback <score>` to rate quality on a 0-10 scale. This directly influences which strategies survive and reproduce. Without feedback, the system relies on self-evaluation alone.

## Principles

The system automatically extracts principles from high vs low-scoring interactions. These are injected into future prompts as learned knowledge. Use `/evolve-principles` to see what has been learned.
