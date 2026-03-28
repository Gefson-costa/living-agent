"""
Living-Agent Evolution Dashboard
Demo-first: Arena view shows evolution process accessibly.
Technical details available in secondary tabs.
"""

import sqlite3
import json
import math
import os
import numpy as np
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import streamlit as st
from streamlit_autorefresh import st_autorefresh

# ── Config ──────────────────────────────────────────────────────────
DB_PATH = os.environ.get(
    "LIVING_AGENT_DB",
    os.path.join(os.path.dirname(__file__), "..", "benchmark.sqlite"),
)

TRAIT_NAMES = [
    "precise", "creative", "concise", "thorough",
    "cautious", "bold", "analytical", "intuitive",
]
TOOL_NAMES = ["code", "search", "analyze", "summarize"]

COLORS = {
    "primary": "#00D4AA",
    "secondary": "#7B61FF",
    "accent": "#FF6B6B",
    "warning": "#FFD93D",
    "bg": "#0E1117",
    "card": "#1A1D23",
    "text": "#FAFAFA",
    "muted": "#6B7280",
    "success": "#10B981",
    "danger": "#EF4444",
}

st.set_page_config(
    page_title="Living-Agent — Evolution Arena",
    page_icon="🧬",
    layout="wide",
    initial_sidebar_state="collapsed",
)

# ── Custom CSS ──────────────────────────────────────────────────────
st.markdown("""
<style>
    /* Metrics */
    [data-testid="stMetric"] {
        background: linear-gradient(135deg, #1A1D23 0%, #252830 100%);
        border: 1px solid #2D3139;
        border-radius: 12px;
        padding: 16px 20px;
    }
    [data-testid="stMetricValue"] { font-size: 2rem; font-weight: 700; }
    [data-testid="stMetricLabel"] {
        font-size: 0.85rem; text-transform: uppercase;
        letter-spacing: 0.05em; color: #9CA3AF;
    }

    /* Tabs */
    .stTabs [data-baseweb="tab-list"] { gap: 8px; }
    .stTabs [data-baseweb="tab"] { border-radius: 8px; padding: 8px 16px; }

    /* Header gradient */
    .main-header {
        background: linear-gradient(90deg, #00D4AA 0%, #7B61FF 50%, #FF6B6B 100%);
        -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        font-size: 2.5rem; font-weight: 800; margin-bottom: 0;
    }
    .sub-header { color: #9CA3AF; font-size: 1.1rem; margin-top: -8px; }

    hr { border-color: #2D3139 !important; margin: 2rem 0 !important; }

    /* Activity feed cards */
    .feed-card {
        background: linear-gradient(135deg, #1A1D23 0%, #20232A 100%);
        border: 1px solid #2D3139; border-radius: 12px;
        padding: 16px; margin-bottom: 12px;
        transition: border-color 0.2s;
    }
    .feed-card:hover { border-color: #00D4AA; }
    .feed-card .task-type {
        font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em;
        color: #7B61FF; font-weight: 600; margin-bottom: 4px;
    }
    .feed-card .task-prompt {
        font-size: 0.9rem; color: #E5E7EB; margin-bottom: 8px;
        font-style: italic;
    }
    .feed-card .strategy-name {
        font-size: 0.75rem; color: #6B7280;
    }
    .feed-card .response-preview {
        font-size: 0.85rem; color: #D1D5DB; margin: 8px 0;
        padding: 8px 12px; background: #0E1117; border-radius: 8px;
        border-left: 3px solid #2D3139; font-family: monospace;
    }
    .feed-card .score-bar {
        margin-top: 8px; display: flex; align-items: center; gap: 8px;
    }
    .score-fill {
        height: 6px; border-radius: 3px; transition: width 0.3s;
    }
    .score-track {
        flex: 1; height: 6px; background: #2D3139; border-radius: 3px;
        overflow: hidden;
    }
    .score-value { font-weight: 700; font-size: 0.9rem; min-width: 45px; }
    .score-high { color: #10B981; }
    .score-mid { color: #FFD93D; }
    .score-low { color: #EF4444; }

    /* Evolution event */
    .evo-event {
        padding: 8px 12px; margin-bottom: 6px; border-radius: 8px;
        font-size: 0.8rem; border-left: 3px solid;
    }
    .evo-birth { background: #0D2818; border-left-color: #10B981; color: #6EE7B7; }
    .evo-death { background: #2D1215; border-left-color: #EF4444; color: #FCA5A5; }
    .evo-improve { background: #1A1D23; border-left-color: #7B61FF; color: #C4B5FD; }

    /* Leaderboard */
    .leader-row {
        display: flex; align-items: center; gap: 10px;
        padding: 10px 14px; margin-bottom: 6px;
        background: #1A1D23; border-radius: 10px;
        border: 1px solid #2D3139;
    }
    .leader-rank { font-size: 1.3rem; min-width: 32px; text-align: center; }
    .leader-name { font-weight: 600; font-size: 0.9rem; color: #E5E7EB; flex: 1; }
    .leader-fitness { font-weight: 700; font-size: 1rem; min-width: 60px; text-align: right; }
    .leader-bar-track {
        flex: 2; height: 8px; background: #2D3139; border-radius: 4px; overflow: hidden;
    }
    .leader-bar-fill { height: 100%; border-radius: 4px; }

    /* Improvement section */
    .improvement-box {
        background: linear-gradient(135deg, #0D2818 0%, #1A1D23 100%);
        border: 1px solid #10B981; border-radius: 16px;
        padding: 24px; text-align: center;
    }
    .improvement-box.negative {
        background: linear-gradient(135deg, #2D1215 0%, #1A1D23 100%);
        border-color: #EF4444;
    }
    .improvement-number {
        font-size: 3rem; font-weight: 800;
    }
    .improvement-label { color: #9CA3AF; font-size: 0.9rem; margin-top: 4px; }
</style>
""", unsafe_allow_html=True)


# ── Auto-refresh ────────────────────────────────────────────────────
refresh_rate = st.sidebar.selectbox(
    "Auto-refresh",
    options=[0, 3, 5, 10, 30],
    format_func=lambda x: "Off" if x == 0 else f"Every {x}s",
    index=2,
)
if refresh_rate > 0:
    st_autorefresh(interval=refresh_rate * 1000, key="auto_refresh")


# ── Data loading ────────────────────────────────────────────────────
@st.cache_data(ttl=2)
def load_data():
    if not os.path.exists(DB_PATH):
        return pd.DataFrame(), pd.DataFrame(), pd.DataFrame(), pd.DataFrame(), {}

    conn = sqlite3.connect(DB_PATH)

    def safe_read(query, fallback_cols=None):
        try:
            return pd.read_sql(query, conn)
        except Exception:
            if fallback_cols:
                return pd.DataFrame(columns=fallback_cols)
            return pd.DataFrame()

    strategies = safe_read("SELECT * FROM strategies ORDER BY fitness DESC")
    experiences = safe_read("SELECT * FROM experiences ORDER BY created_at ASC")
    skills = safe_read("SELECT * FROM skills ORDER BY fitness DESC")
    grid_rows = safe_read("SELECT * FROM map_elites_grid")

    metadata = {}
    try:
        for _, row in pd.read_sql("SELECT * FROM metadata", conn).iterrows():
            metadata[row["key"]] = row["value"]
    except Exception:
        pass

    conn.close()
    return strategies, experiences, skills, grid_rows, metadata


def parse_genomes(strategies_df):
    genome_data = []
    for _, row in strategies_df.iterrows():
        genome = json.loads(row["genome"])
        entry = {
            "id": row["id"][:8],
            "full_id": row["id"],
            "fitness": row["fitness"],
            "age": row["age"],
            "temperature": genome.get("temperature", 0),
            "reasoningDepth": genome.get("reasoningDepth", 0),
            "mutability": genome.get("mutability", 1),
            "learningRate": genome.get("learningRate", 0.01),
            "lamarckianRate": genome.get("lamarckianRate", 0),
            "habitatPref": genome.get("habitatPref", 0.5),
            "maxTokenBudget": genome.get("maxTokenBudget", 1000),
            "fewShotCount": genome.get("fewShotCount", 0),
        }
        style = genome.get("promptStyle", [0] * 8)
        for i, name in enumerate(TRAIT_NAMES):
            entry[name] = float(style[i]) if i < len(style) else 0.0
        tools = genome.get("toolPreferences", [0] * 4)
        for i, name in enumerate(TOOL_NAMES):
            entry[f"tool_{name}"] = float(tools[i]) if i < len(tools) else 0.0
        genome_data.append(entry)
    return pd.DataFrame(genome_data)


def compute_diversity(genome_df):
    if len(genome_df) < 2:
        return 0.0
    gene_cols = (
        TRAIT_NAMES + [f"tool_{t}" for t in TOOL_NAMES]
        + ["temperature", "reasoningDepth", "mutability", "habitatPref"]
    )
    vals = genome_df[gene_cols].values
    n = len(vals)
    total = 0.0
    count = 0
    for i in range(n):
        for j in range(i + 1, n):
            total += np.sqrt(np.mean((vals[i] - vals[j]) ** 2))
            count += 1
    return total / count if count > 0 else 0.0


def score_color_class(score):
    if score >= 0.7: return "score-high"
    if score >= 0.4: return "score-mid"
    return "score-low"


def score_color_hex(score):
    if score >= 0.7: return COLORS["success"]
    if score >= 0.4: return COLORS["warning"]
    return COLORS["danger"]


strategies, experiences, skills, grid_rows, metadata = load_data()
genome_df = parse_genomes(strategies) if not strategies.empty else pd.DataFrame()


# ── Header ──────────────────────────────────────────────────────────
st.markdown('<p class="main-header">Living-Agent Evolution Arena</p>', unsafe_allow_html=True)
st.markdown(
    '<p class="sub-header">'
    'Watch AI strategies compete, evolve, and improve in real-time'
    '</p>',
    unsafe_allow_html=True,
)


# ═══════════════════════════════════════════════════════════════════
#  TABS
# ═══════════════════════════════════════════════════════════════════
tab_arena, tab_evolution, tab_strategies, tab_map, tab_interactions = st.tabs([
    "🏟️ Arena",
    "📈 Evolution",
    "🧬 Strategies",
    "🗺️ MAP-Elites",
    "💬 Interactions",
])


# ═══════════════════════════════════════════════════════════════════
#  TAB 0: ARENA (Demo View)
# ═══════════════════════════════════════════════════════════════════
with tab_arena:

    if experiences.empty:
        st.markdown("---")
        st.markdown("### Waiting for evolution data...")
        st.markdown(
            "Start the benchmark to see the arena come alive:\n\n"
            "```bash\n"
            "npx tsx benchmarks/run.ts --real --scenario=real-llm --verbose --ollama --model=qwen3:8b\n"
            "```"
        )
        st.caption("The dashboard auto-refreshes every few seconds.")
    else:
        n_interactions = len(experiences)
        n_strategies = len(strategies)
        tasks_per_cycle = max(1, n_strategies)
        current_generation = max(1, math.ceil(n_interactions / tasks_per_cycle))

        # ── Top metrics ─────────────────────────────────────────
        m1, m2, m3, m4 = st.columns(4)

        with m1:
            st.metric("Generation", f"{current_generation}")

        best_score = experiences["score"].max()
        with m2:
            st.metric("Best Score", f"{best_score:.2f}")

        # Improvement: first third vs last third
        third = max(1, len(experiences) // 3)
        early_avg = experiences.head(third)["score"].mean()
        late_avg = experiences.tail(third)["score"].mean()
        if early_avg > 0:
            improvement_pct = ((late_avg - early_avg) / early_avg) * 100
        else:
            improvement_pct = (late_avg - early_avg) * 100
        with m3:
            color = "normal" if improvement_pct >= 0 else "inverse"
            st.metric("Improvement", f"{improvement_pct:+.0f}%",
                       delta=f"{late_avg:.3f} vs {early_avg:.3f}",
                       delta_color=color)

        win_rate = (experiences["score"] > 0.5).mean() * 100
        with m4:
            st.metric("Win Rate", f"{win_rate:.0f}%",
                       delta=f"{n_interactions} tasks completed")

        st.markdown("---")

        # ── Main content: Feed + Leaderboard ────────────────────
        feed_col, leader_col = st.columns([3, 2])

        # ── Live Activity Feed ──────────────────────────────────
        with feed_col:
            st.markdown("### Live Activity Feed")
            st.caption("Most recent task attempts — newest first")

            recent = experiences.iloc[::-1].head(15)
            for _, exp in recent.iterrows():
                score = exp["score"]
                sc_class = score_color_class(score)
                sc_hex = score_color_hex(score)
                pct = min(100, max(2, score * 100))

                task_prompt = str(exp["task_prompt"])[:120]
                response = str(exp["response"]).replace("\n", " ")[:200]
                strat_name = str(exp["strategy_id"])[:10]

                task_icon = {
                    "math": "🧮", "coding": "💻", "analysis": "📊",
                    "creative": "🎨", "research": "🔍", "general": "💬",
                    "summarization": "📝",
                }.get(exp["task_type"], "📋")

                st.markdown(f"""
                <div class="feed-card">
                    <div class="task-type">{task_icon} {exp['task_type']}</div>
                    <div class="task-prompt">"{task_prompt}"</div>
                    <div class="strategy-name">Strategy: {strat_name} &nbsp;·&nbsp; {exp['tokens_used']} tokens &nbsp;·&nbsp; {exp['latency_ms']}ms</div>
                    <div class="response-preview">{response}</div>
                    <div class="score-bar">
                        <div class="score-track">
                            <div class="score-fill" style="width:{pct}%; background:{sc_hex};"></div>
                        </div>
                        <span class="score-value {sc_class}">{score:.3f}</span>
                    </div>
                </div>
                """, unsafe_allow_html=True)

        # ── Leaderboard ─────────────────────────────────────────
        with leader_col:
            st.markdown("### Strategy Leaderboard")
            st.caption("Ranked by fitness — the fittest survive")

            if not strategies.empty:
                for i, (_, row) in enumerate(strategies.head(10).iterrows()):
                    rank = i + 1
                    medal = {1: "🥇", 2: "🥈", 3: "🥉"}.get(rank, f"#{rank}")
                    fitness = row["fitness"]
                    # Normalize fitness for bar (fitness can be negative)
                    bar_pct = min(100, max(2, (fitness + 1) * 50))  # rough -1..1 → 0..100
                    bar_color = score_color_hex(max(0, min(1, (fitness + 1) / 2)))
                    name = str(row["id"])[:10]
                    age = row["age"]

                    # Strategy's performance stats
                    strat_exp = experiences[experiences["strategy_id"] == row["id"]]
                    n_tasks = len(strat_exp)
                    avg_score = strat_exp["score"].mean() if n_tasks > 0 else 0

                    st.markdown(f"""
                    <div class="leader-row">
                        <div class="leader-rank">{medal}</div>
                        <div style="flex: 1;">
                            <div class="leader-name">{name}</div>
                            <div style="font-size:0.7rem; color:#6B7280;">
                                Age {age} · {n_tasks} tasks · avg {avg_score:.2f}
                            </div>
                        </div>
                        <div class="leader-bar-track">
                            <div class="leader-bar-fill" style="width:{bar_pct}%; background:{bar_color};"></div>
                        </div>
                        <div class="leader-fitness" style="color:{bar_color};">{fitness:.3f}</div>
                    </div>
                    """, unsafe_allow_html=True)

            # ── Evolution Progress ──────────────────────────────
            st.markdown("---")
            st.markdown("### Evolution Progress")

            # Simple improvement visualization
            if len(experiences) >= 4:
                fig = go.Figure()

                sorted_exp = experiences.sort_values("created_at").reset_index(drop=True)
                sorted_exp["n"] = range(1, len(sorted_exp) + 1)
                sorted_exp["rolling"] = sorted_exp["score"].rolling(
                    min(5, len(sorted_exp)), min_periods=1
                ).mean()

                # Individual scores as dots
                fig.add_trace(go.Scatter(
                    x=sorted_exp["n"], y=sorted_exp["score"],
                    mode="markers", name="Score",
                    marker=dict(
                        size=8, opacity=0.5,
                        color=sorted_exp["score"],
                        colorscale=[[0, COLORS["danger"]], [0.5, COLORS["warning"]], [1, COLORS["success"]]],
                    ),
                    hovertemplate="Task %{x}<br>Score: %{y:.3f}<extra></extra>",
                ))

                # Rolling average as line
                fig.add_trace(go.Scatter(
                    x=sorted_exp["n"], y=sorted_exp["rolling"],
                    mode="lines", name="Trend",
                    line=dict(color=COLORS["primary"], width=3),
                    fill="tozeroy",
                    fillcolor="rgba(0,212,170,0.08)",
                ))

                fig.update_layout(
                    height=250,
                    showlegend=False,
                    xaxis_title="Task #",
                    yaxis_title="Score",
                    yaxis_range=[0, 1.05],
                    margin=dict(t=10, b=40, l=50, r=20),
                )
                st.plotly_chart(fig, width="stretch")

        # ── Before vs After ─────────────────────────────────────
        st.markdown("---")
        st.markdown("### Before vs After — Evolution in Action")

        if len(experiences) >= 4:
            imp_col, before_col, after_col = st.columns([1, 2, 2])

            with imp_col:
                is_positive = improvement_pct >= 0
                box_class = "" if is_positive else "negative"
                pct_color = COLORS["success"] if is_positive else COLORS["danger"]
                st.markdown(f"""
                <div class="improvement-box {box_class}">
                    <div class="improvement-number" style="color:{pct_color};">
                        {improvement_pct:+.0f}%
                    </div>
                    <div class="improvement-label">Score Improvement</div>
                    <div style="margin-top:12px; font-size:0.85rem; color:#9CA3AF;">
                        Early avg: {early_avg:.3f}<br>
                        Late avg: {late_avg:.3f}
                    </div>
                </div>
                """, unsafe_allow_html=True)

            # Find best early and best late examples
            early_set = experiences.head(third)
            late_set = experiences.tail(third)

            # Pick representative examples (median score, not extremes)
            early_example = early_set.iloc[(early_set["score"] - early_set["score"].median()).abs().argsort().iloc[0]]
            late_best = late_set.loc[late_set["score"].idxmax()]

            with before_col:
                sc = score_color_hex(early_example["score"])
                st.markdown(f"""
                <div class="feed-card" style="border-left: 4px solid {COLORS['danger']};">
                    <div style="font-size:0.75rem; color:{COLORS['danger']}; font-weight:600; text-transform:uppercase;">
                        Early Generation
                    </div>
                    <div class="task-type" style="margin-top:8px;">
                        {early_example['task_type']}
                    </div>
                    <div class="task-prompt">"{str(early_example['task_prompt'])[:150]}"</div>
                    <div class="response-preview">{str(early_example['response']).replace(chr(10), ' ')[:300]}</div>
                    <div class="score-bar">
                        <div class="score-track">
                            <div class="score-fill" style="width:{early_example['score']*100}%; background:{sc};"></div>
                        </div>
                        <span class="score-value" style="color:{sc};">{early_example['score']:.3f}</span>
                    </div>
                </div>
                """, unsafe_allow_html=True)

            with after_col:
                sc = score_color_hex(late_best["score"])
                st.markdown(f"""
                <div class="feed-card" style="border-left: 4px solid {COLORS['success']};">
                    <div style="font-size:0.75rem; color:{COLORS['success']}; font-weight:600; text-transform:uppercase;">
                        Latest Generation
                    </div>
                    <div class="task-type" style="margin-top:8px;">
                        {late_best['task_type']}
                    </div>
                    <div class="task-prompt">"{str(late_best['task_prompt'])[:150]}"</div>
                    <div class="response-preview">{str(late_best['response']).replace(chr(10), ' ')[:300]}</div>
                    <div class="score-bar">
                        <div class="score-track">
                            <div class="score-fill" style="width:{late_best['score']*100}%; background:{sc};"></div>
                        </div>
                        <span class="score-value" style="color:{sc};">{late_best['score']:.3f}</span>
                    </div>
                </div>
                """, unsafe_allow_html=True)

        # ── Skills ──────────────────────────────────────────────
        if not skills.empty:
            st.markdown("---")
            st.markdown("### Learned Skills")
            st.caption("Patterns the agent discovered through evolution")

            skill_cols = st.columns(min(3, len(skills)))
            for i, (_, skill) in enumerate(skills.iterrows()):
                task_types = json.loads(skill["task_types"])
                sc = score_color_hex(skill["fitness"])
                with skill_cols[i % len(skill_cols)]:
                    st.markdown(f"""
                    <div class="feed-card">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <span style="font-weight:700; color:{sc};">
                                {skill['type'].upper()}
                            </span>
                            <span style="font-size:0.8rem; color:#6B7280;">
                                fitness: {skill['fitness']:.2f}
                            </span>
                        </div>
                        <div style="font-size:0.75rem; color:#7B61FF; margin:4px 0;">
                            {', '.join(task_types)}
                        </div>
                        <div style="font-size:0.75rem; color:#6B7280;">
                            Used {skill['successes']}/{skill['uses']} times successfully
                        </div>
                    </div>
                    """, unsafe_allow_html=True)
                    st.code(skill["content"][:300], language="text")


# ═══════════════════════════════════════════════════════════════════
#  TAB 1: Evolution (Technical)
# ═══════════════════════════════════════════════════════════════════
with tab_evolution:

    st.caption("Detailed fitness charts and performance breakdown")

    if not experiences.empty:
        left, right = st.columns([3, 1])

        with left:
            exp_plot = experiences.copy()
            exp_plot["created_at"] = pd.to_datetime(exp_plot["created_at"])
            exp_plot["strategy_short"] = exp_plot["strategy_id"].str[:8]
            exp_plot["interaction_num"] = range(1, len(exp_plot) + 1)

            fig = make_subplots(
                rows=2, cols=1, row_heights=[0.7, 0.3],
                shared_xaxes=True, vertical_spacing=0.08,
                subplot_titles=("Fitness per Interaction", "Rolling Average (window=5)"),
            )

            for strat in exp_plot["strategy_short"].unique():
                mask = exp_plot["strategy_short"] == strat
                subset = exp_plot[mask]
                fig.add_trace(go.Scatter(
                    x=subset["interaction_num"], y=subset["score"],
                    mode="markers", name=strat,
                    marker=dict(size=10, opacity=0.7),
                    hovertemplate="<b>%{text}</b><br>Score: %{y:.3f}<br>Interaction: %{x}<extra></extra>",
                    text=subset["task_type"],
                ), row=1, col=1)

            sorted_exp = exp_plot.sort_values("interaction_num")
            sorted_exp["rolling"] = sorted_exp["score"].rolling(5, min_periods=1).mean()
            fig.add_trace(go.Scatter(
                x=sorted_exp["interaction_num"], y=sorted_exp["rolling"],
                mode="lines", name="Rolling Avg",
                line=dict(color=COLORS["primary"], width=3),
                fill="tozeroy", fillcolor="rgba(0,212,170,0.1)",
            ), row=2, col=1)

            fig.update_layout(height=500, showlegend=True,
                              legend=dict(orientation="h", y=1.12), margin=dict(t=60))
            fig.update_yaxes(title_text="Score", range=[0, 1], row=1, col=1)
            fig.update_yaxes(title_text="Avg", range=[0, 1], row=2, col=1)
            fig.update_xaxes(title_text="Interaction #", row=2, col=1)
            st.plotly_chart(fig, width="stretch")

        with right:
            st.markdown("#### Leaderboard")
            if not strategies.empty:
                for i, (_, row) in enumerate(strategies.head(8).iterrows()):
                    rank = i + 1
                    medal = {1: "🥇", 2: "🥈", 3: "🥉"}.get(rank, f"#{rank}")
                    fitness_pct = max(0, row["fitness"]) * 100
                    st.markdown(
                        f"**{medal} {row['id'][:8]}** — age {row['age']}\n\n"
                        f"`{'█' * int(fitness_pct / 5)}{'░' * (20 - int(fitness_pct / 5))}` "
                        f"**{row['fitness']:.3f}**"
                    )

        st.markdown("---")
        c1, c2 = st.columns(2)

        with c1:
            st.markdown("#### Score Distribution")
            fig = go.Figure()
            fig.add_trace(go.Histogram(
                x=experiences["score"], nbinsx=20,
                marker_color=COLORS["primary"], opacity=0.8,
            ))
            fig.add_vline(x=experiences["score"].mean(), line_dash="dash",
                          line_color=COLORS["warning"],
                          annotation_text=f"mean={experiences['score'].mean():.3f}")
            fig.update_layout(height=300, xaxis_title="Score",
                              yaxis_title="Count", margin=dict(t=20))
            st.plotly_chart(fig, width="stretch")

        with c2:
            st.markdown("#### Performance by Task Type")
            task_stats = experiences.groupby("task_type").agg(
                avg_score=("score", "mean"), max_score=("score", "max"),
                count=("score", "count"), avg_tokens=("tokens_used", "mean"),
            ).reset_index()

            fig = go.Figure()
            fig.add_trace(go.Bar(
                x=task_stats["task_type"], y=task_stats["avg_score"],
                name="Avg Score", marker_color=COLORS["primary"],
                text=task_stats["count"].apply(lambda x: f"n={x}"),
                textposition="outside",
            ))
            fig.add_trace(go.Bar(
                x=task_stats["task_type"], y=task_stats["max_score"],
                name="Best Score", marker_color=COLORS["secondary"], opacity=0.5,
            ))
            fig.update_layout(height=300, barmode="overlay",
                              yaxis_range=[0, 1.1], margin=dict(t=20))
            st.plotly_chart(fig, width="stretch")
    else:
        st.info("No interactions yet. Run the agent to see evolution data.")


# ═══════════════════════════════════════════════════════════════════
#  TAB 2: Strategies (Technical)
# ═══════════════════════════════════════════════════════════════════
with tab_strategies:

    if not genome_df.empty:
        selected_strat = st.selectbox(
            "Select strategy to inspect",
            options=genome_df["id"].tolist(),
            format_func=lambda x: f"{x} (fitness={genome_df[genome_df['id']==x]['fitness'].values[0]:.3f})",
        )

        top_left, top_right = st.columns(2)

        with top_left:
            st.markdown("#### Personality Profiles")
            fig = go.Figure()
            for i, (_, row) in enumerate(genome_df.head(6).iterrows()):
                values = [row[t] for t in TRAIT_NAMES] + [row[TRAIT_NAMES[0]]]
                is_selected = row["id"] == selected_strat
                fig.add_trace(go.Scatterpolar(
                    r=values, theta=TRAIT_NAMES + [TRAIT_NAMES[0]],
                    fill="toself", name=f"{row['id']}",
                    opacity=0.8 if is_selected else 0.2,
                    line=dict(width=3 if is_selected else 1),
                ))
            fig.update_layout(
                polar=dict(radialaxis=dict(range=[-1, 1], showticklabels=False),
                           bgcolor="rgba(0,0,0,0)"),
                height=400, margin=dict(t=40),
                showlegend=True, legend=dict(orientation="h"),
            )
            st.plotly_chart(fig, width="stretch")

        with top_right:
            st.markdown("#### Strategy Inspector")
            sel = genome_df[genome_df["id"] == selected_strat].iloc[0]

            g1, g2 = st.columns(2)
            g1.metric("Fitness", f"{sel['fitness']:.4f}")
            g2.metric("Age", f"{sel['age']} cycles")

            g1, g2, g3 = st.columns(3)
            g1.metric("Temperature", f"{sel['temperature']:.3f}")
            g2.metric("Reasoning Depth", f"{sel['reasoningDepth']:.3f}")
            g3.metric("Mutability", f"{sel['mutability']:.3f}")

            g1, g2, g3 = st.columns(3)
            g1.metric("Learning Rate", f"{sel['learningRate']:.4f}")
            g2.metric("Lamarckian Rate", f"{sel['lamarckianRate']:.3f}")
            g3.metric("Few-Shot Count", f"{int(sel['fewShotCount'])}")

            g1, g2 = st.columns(2)
            g1.metric("Habitat Pref", f"{sel['habitatPref']:.3f}")
            g2.metric("Token Budget", f"{int(sel['maxTokenBudget'])}")

            st.markdown("**Tool Preferences:**")
            for tool in TOOL_NAMES:
                val = sel[f"tool_{tool}"]
                bar = "█" * int(max(0, val) * 20) + "░" * (20 - int(max(0, val) * 20))
                st.text(f"  {tool:>10}  {bar}  {val:.2f}")

        st.markdown("---")
        st.markdown("#### Individual Learning Curves")
        if not experiences.empty:
            fig = go.Figure()
            for strat_id in genome_df["id"].tolist():
                full_id = genome_df[genome_df["id"] == strat_id]["full_id"].values[0]
                strat_exp = experiences[experiences["strategy_id"] == full_id].copy()
                if strat_exp.empty:
                    continue
                strat_exp = strat_exp.sort_values("created_at").reset_index(drop=True)
                strat_exp["cumulative_avg"] = strat_exp["score"].expanding().mean()
                strat_exp["n"] = range(1, len(strat_exp) + 1)
                is_selected = strat_id == selected_strat
                fig.add_trace(go.Scatter(
                    x=strat_exp["n"], y=strat_exp["cumulative_avg"],
                    mode="lines+markers", name=strat_id,
                    opacity=1.0 if is_selected else 0.3,
                    line=dict(width=3 if is_selected else 1),
                    marker=dict(size=6 if is_selected else 3),
                ))
            fig.update_layout(height=350, xaxis_title="Interaction # (per strategy)",
                              yaxis_title="Cumulative Average Score",
                              yaxis_range=[0, 1], margin=dict(t=20))
            st.plotly_chart(fig, width="stretch")

        st.markdown("---")
        st.markdown("#### Genome Comparison Matrix")
        gene_cols = (
            TRAIT_NAMES + [f"tool_{t}" for t in TOOL_NAMES]
            + ["temperature", "reasoningDepth", "mutability", "learningRate", "habitatPref"]
        )
        gene_labels = (
            TRAIT_NAMES + TOOL_NAMES
            + ["temp", "reasoning", "mutability", "learnRate", "habitat"]
        )
        heatmap_data = genome_df[gene_cols].values
        fig = go.Figure(go.Heatmap(
            z=heatmap_data, x=gene_labels, y=genome_df["id"].tolist(),
            colorscale="RdBu", zmid=0,
            text=np.round(heatmap_data, 2), texttemplate="%{text}",
            textfont=dict(size=9),
        ))
        fig.update_layout(height=max(200, len(genome_df) * 40),
                          xaxis_title="Gene", yaxis_title="Strategy",
                          margin=dict(t=20))
        st.plotly_chart(fig, width="stretch")
    else:
        st.info("No strategies in population yet.")


# ═══════════════════════════════════════════════════════════════════
#  TAB 3: MAP-Elites (Technical)
# ═══════════════════════════════════════════════════════════════════
with tab_map:

    c1, c2 = st.columns([2, 1])

    with c1:
        st.markdown("#### Behavioral Niche Grid")
        st.caption(
            "Each cell = a behavioral niche. "
            "The grid keeps the best genome per niche, preserving diversity."
        )

        grid_matrix = np.full((8, 8), np.nan)
        if not grid_rows.empty:
            for _, row in grid_rows.iterrows():
                x, y = int(row["x"]), int(row["y"])
                if 0 <= x < 8 and 0 <= y < 8:
                    grid_matrix[y][x] = row["fitness"]

        text_matrix = []
        for r in range(8):
            text_row = []
            for c in range(8):
                if np.isnan(grid_matrix[r][c]):
                    text_row.append("·")
                else:
                    text_row.append(f"{grid_matrix[r][c]:.3f}")
            text_matrix.append(text_row)

        fig = go.Figure(go.Heatmap(
            z=grid_matrix,
            colorscale=[[0, "#1a1a2e"], [0.25, "#16213e"],
                        [0.5, "#0f3460"], [0.75, "#00D4AA"], [1, "#7B61FF"]],
            showscale=True,
            colorbar=dict(title=dict(text="Fitness", side="right")),
            hoverongaps=False, text=text_matrix, texttemplate="%{text}",
            textfont=dict(size=12, color="white"), xgap=3, ygap=3,
        ))
        fig.update_layout(height=500,
                          xaxis=dict(title="Behavioral Axis 1", dtick=1, showgrid=False),
                          yaxis=dict(title="Behavioral Axis 2", dtick=1, showgrid=False),
                          margin=dict(t=20))
        st.plotly_chart(fig, width="stretch")

    with c2:
        st.markdown("#### Grid Stats")
        filled = np.count_nonzero(~np.isnan(grid_matrix))
        total = 64

        fig = go.Figure(go.Indicator(
            mode="gauge+number", value=filled / total * 100,
            number=dict(suffix="%"),
            gauge=dict(
                axis=dict(range=[0, 100]),
                bar=dict(color=COLORS["primary"]),
                steps=[
                    dict(range=[0, 25], color="#1a1a2e"),
                    dict(range=[25, 50], color="#16213e"),
                    dict(range=[50, 75], color="#0f3460"),
                    dict(range=[75, 100], color="#1a3a5c"),
                ],
                threshold=dict(line=dict(color=COLORS["accent"], width=2),
                               thickness=0.8, value=filled / total * 100),
            ),
            title=dict(text="Grid Coverage"),
        ))
        fig.update_layout(height=250, margin=dict(t=60, b=20))
        st.plotly_chart(fig, width="stretch")

        st.metric("Cells Filled", f"{filled} / {total}")
        if not grid_rows.empty:
            st.metric("Best Niche Fitness", f"{grid_rows['fitness'].max():.3f}")
            st.metric("Avg Niche Fitness", f"{grid_rows['fitness'].mean():.3f}")
            st.metric("Fitness Range", f"{grid_rows['fitness'].max() - grid_rows['fitness'].min():.3f}")

    if not grid_rows.empty:
        st.markdown("---")
        st.markdown("#### Niche Details")
        niche_data = grid_rows.copy()
        for _, niche in niche_data.iterrows():
            genome = json.loads(niche["genome"])
            temp = genome.get("temperature", 0)
            depth = genome.get("reasoningDepth", 0)
            style = genome.get("promptStyle", [0] * 8)
            dominant_idx = int(np.argmax([abs(s) for s in style[:len(TRAIT_NAMES)]]))
            dominant_trait = TRAIT_NAMES[dominant_idx] if dominant_idx < len(TRAIT_NAMES) else "?"

            with st.expander(
                f"Cell ({int(niche['x'])}, {int(niche['y'])}) — "
                f"fitness {niche['fitness']:.3f} — dominant: {dominant_trait}"
            ):
                c1, c2, c3, c4 = st.columns(4)
                c1.metric("Temperature", f"{temp:.3f}")
                c2.metric("Reasoning", f"{depth:.3f}")
                c3.metric("Dominant Trait", dominant_trait)
                c4.metric("Trait Value", f"{style[dominant_idx]:.3f}" if dominant_idx < len(style) else "?")


# ═══════════════════════════════════════════════════════════════════
#  TAB 4: Interactions (Technical)
# ═══════════════════════════════════════════════════════════════════
with tab_interactions:

    if not experiences.empty:
        fc1, fc2, fc3 = st.columns(3)
        with fc1:
            filter_task = st.selectbox("Task Type",
                                       ["All"] + experiences["task_type"].unique().tolist())
        with fc2:
            filter_min = st.slider("Min Score", 0.0, 1.0, 0.0, 0.05)
        with fc3:
            filter_strat = st.selectbox("Strategy",
                                        ["All"] + experiences["strategy_id"].str[:8].unique().tolist())

        filtered = experiences.copy()
        if filter_task != "All":
            filtered = filtered[filtered["task_type"] == filter_task]
        if filter_min > 0:
            filtered = filtered[filtered["score"] >= filter_min]
        if filter_strat != "All":
            filtered = filtered[filtered["strategy_id"].str[:8] == filter_strat]

        st.caption(f"Showing {len(filtered)} of {len(experiences)} interactions")

        st.markdown("---")
        st.markdown("#### Token Efficiency")
        fig = px.scatter(
            filtered, x="tokens_used", y="score",
            color="task_type", size="latency_ms",
            hover_data=["strategy_id"], opacity=0.7,
        )
        fig.update_layout(height=350, xaxis_title="Tokens Used",
                          yaxis_title="Score", margin=dict(t=20))
        st.plotly_chart(fig, width="stretch")

        st.markdown("---")
        st.markdown("#### Interaction Log")
        for _, exp in filtered.iloc[::-1].head(20).iterrows():
            score = exp["score"]
            icon = "🟢" if score >= 0.7 else ("🟡" if score >= 0.4 else "🔴")

            with st.expander(
                f"{icon} [{exp['task_type']}] "
                f"Score: {score:.3f} — "
                f"Strategy: {exp['strategy_id'][:8]} — "
                f"{exp['tokens_used']} tokens — "
                f"{exp['latency_ms']}ms"
            ):
                st.markdown("**Prompt:**")
                st.code(exp["task_prompt"][:800], language="text")
                st.markdown("**Response:**")
                st.code(exp["response"][:800], language="text")
                mc1, mc2, mc3 = st.columns(3)
                mc1.metric("Score", f"{score:.3f}")
                mc2.metric("Tokens", f"{exp['tokens_used']}")
                mc3.metric("Latency", f"{exp['latency_ms']}ms")
    else:
        st.info("No interactions recorded yet.")


# ── Sidebar info ────────────────────────────────────────────────────
st.sidebar.markdown("## 🧬 Living-Agent")
st.sidebar.caption("AI that evolves itself")
st.sidebar.markdown("---")
st.sidebar.metric("Population", len(strategies))
st.sidebar.metric("Interactions", len(experiences))
st.sidebar.metric("Skills", len(skills))
if not grid_rows.empty:
    st.sidebar.metric("MAP-Elites", f"{len(grid_rows)}/64 niches")
if not genome_df.empty:
    diversity = compute_diversity(genome_df)
    st.sidebar.metric("Diversity", f"{diversity:.3f}")
st.sidebar.markdown("---")
if st.sidebar.button("Force Refresh", width="stretch"):
    st.cache_data.clear()
    st.rerun()


# ── Footer ──────────────────────────────────────────────────────────
st.markdown("---")
st.markdown(
    f"<div style='text-align:center; color:{COLORS['muted']}; font-size:0.8rem;'>"
    "Living-Agent — AI that evolves itself"
    "</div>",
    unsafe_allow_html=True,
)
