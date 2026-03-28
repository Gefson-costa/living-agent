"""
Living-Agent Evolution Dashboard
Real-time visualization of autonomous agent evolution.
"""

import sqlite3
import json
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
    os.path.join(os.path.dirname(__file__), "..", "living-agent.sqlite"),
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
}

st.set_page_config(
    page_title="Living-Agent — Evolution Dashboard",
    page_icon="🧬",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ── Custom CSS ──────────────────────────────────────────────────────
st.markdown("""
<style>
    /* Main metrics */
    [data-testid="stMetric"] {
        background: linear-gradient(135deg, #1A1D23 0%, #252830 100%);
        border: 1px solid #2D3139;
        border-radius: 12px;
        padding: 16px 20px;
    }
    [data-testid="stMetricValue"] {
        font-size: 2rem;
        font-weight: 700;
    }
    [data-testid="stMetricLabel"] {
        font-size: 0.85rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #9CA3AF;
    }

    /* Tabs */
    .stTabs [data-baseweb="tab-list"] {
        gap: 8px;
    }
    .stTabs [data-baseweb="tab"] {
        border-radius: 8px;
        padding: 8px 16px;
    }

    /* Expanders */
    .streamlit-expanderHeader {
        font-size: 0.9rem;
    }

    /* Header gradient */
    .main-header {
        background: linear-gradient(90deg, #00D4AA 0%, #7B61FF 50%, #FF6B6B 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        font-size: 2.5rem;
        font-weight: 800;
        margin-bottom: 0;
    }
    .sub-header {
        color: #9CA3AF;
        font-size: 1.1rem;
        margin-top: -8px;
    }

    /* Section dividers */
    hr {
        border-color: #2D3139 !important;
        margin: 2rem 0 !important;
    }
</style>
""", unsafe_allow_html=True)

# ── Auto-refresh ────────────────────────────────────────────────────
refresh_rate = st.sidebar.selectbox(
    "Auto-refresh",
    options=[0, 5, 10, 30, 60],
    format_func=lambda x: "Off" if x == 0 else f"Every {x}s",
    index=2,
)
if refresh_rate > 0:
    st_autorefresh(interval=refresh_rate * 1000, key="auto_refresh")


# ── Data loading ────────────────────────────────────────────────────
@st.cache_data(ttl=3)
def load_data():
    conn = sqlite3.connect(DB_PATH)
    strategies = pd.read_sql("SELECT * FROM strategies ORDER BY fitness DESC", conn)
    experiences = pd.read_sql(
        "SELECT * FROM experiences ORDER BY created_at ASC", conn
    )
    skills = pd.read_sql("SELECT * FROM skills ORDER BY fitness DESC", conn)
    grid_rows = pd.read_sql("SELECT * FROM map_elites_grid", conn)

    metadata = {}
    for _, row in pd.read_sql("SELECT * FROM metadata", conn).iterrows():
        metadata[row["key"]] = row["value"]

    conn.close()
    return strategies, experiences, skills, grid_rows, metadata


def parse_genomes(strategies_df):
    """Parse genome JSON into structured DataFrame."""
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
    """Compute population diversity as average pairwise genome distance."""
    if len(genome_df) < 2:
        return 0.0
    gene_cols = (
        TRAIT_NAMES
        + [f"tool_{t}" for t in TOOL_NAMES]
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


strategies, experiences, skills, grid_rows, metadata = load_data()
genome_df = parse_genomes(strategies) if not strategies.empty else pd.DataFrame()

# ── Sidebar ─────────────────────────────────────────────────────────
st.sidebar.markdown("## 🧬 Living-Agent")
st.sidebar.caption("AI agents that evolve themselves")
st.sidebar.markdown("---")

st.sidebar.metric("Population", len(strategies))
st.sidebar.metric("Interactions", len(experiences))
st.sidebar.metric("Skills", len(skills))

if not grid_rows.empty:
    coverage = len(grid_rows)
    st.sidebar.metric("MAP-Elites Coverage", f"{coverage}/64")

if not genome_df.empty:
    diversity = compute_diversity(genome_df)
    st.sidebar.metric("Population Diversity", f"{diversity:.3f}")

st.sidebar.markdown("---")
if st.sidebar.button("Force Refresh", use_container_width=True):
    st.cache_data.clear()
    st.rerun()


# ── Header ──────────────────────────────────────────────────────────
st.markdown('<p class="main-header">Living-Agent Evolution</p>', unsafe_allow_html=True)
st.markdown('<p class="sub-header">Real-time visualization of autonomous agent evolution</p>', unsafe_allow_html=True)

# ── Key Metrics Row ─────────────────────────────────────────────────
if not experiences.empty:
    m1, m2, m3, m4, m5, m6 = st.columns(6)

    avg_score = experiences["score"].mean()
    best_score = experiences["score"].max()
    total_tokens = experiences["tokens_used"].sum()
    avg_latency = experiences["latency_ms"].mean()

    # Compute deltas from last 5 vs previous 5
    if len(experiences) >= 10:
        recent_5 = experiences.tail(5)["score"].mean()
        prev_5 = experiences.iloc[-10:-5]["score"].mean()
        delta = recent_5 - prev_5
        m1.metric("Avg Score", f"{avg_score:.3f}", delta=f"{delta:+.3f}")
    else:
        m1.metric("Avg Score", f"{avg_score:.3f}")

    m2.metric("Best Score", f"{best_score:.3f}")
    m3.metric("Interactions", f"{len(experiences)}")
    m4.metric("Total Tokens", f"{total_tokens:,}")
    m5.metric("Avg Latency", f"{avg_latency:.0f}ms")

    # Win rate (score > 0.5)
    win_rate = (experiences["score"] > 0.5).mean() * 100
    m6.metric("Win Rate", f"{win_rate:.0f}%")


# ═══════════════════════════════════════════════════════════════════
#  TABS
# ═══════════════════════════════════════════════════════════════════
tab_evolution, tab_strategies, tab_map, tab_interactions = st.tabs([
    "📈 Evolution", "🧬 Strategies", "🗺️ MAP-Elites", "💬 Interactions"
])


# ── TAB 1: Evolution ───────────────────────────────────────────────
with tab_evolution:

    left, right = st.columns([3, 1])

    with left:
        if not experiences.empty:
            exp_plot = experiences.copy()
            exp_plot["created_at"] = pd.to_datetime(exp_plot["created_at"])
            exp_plot["strategy_short"] = exp_plot["strategy_id"].str[:8]
            exp_plot["interaction_num"] = range(1, len(exp_plot) + 1)

            # Main fitness chart
            fig = make_subplots(
                rows=2, cols=1,
                row_heights=[0.7, 0.3],
                shared_xaxes=True,
                vertical_spacing=0.08,
                subplot_titles=("Fitness per Interaction", "Rolling Average (window=5)"),
            )

            # Individual scores
            for strat in exp_plot["strategy_short"].unique():
                mask = exp_plot["strategy_short"] == strat
                subset = exp_plot[mask]
                fig.add_trace(
                    go.Scatter(
                        x=subset["interaction_num"],
                        y=subset["score"],
                        mode="markers",
                        name=strat,
                        marker=dict(size=10, opacity=0.7),
                        hovertemplate=(
                            "<b>%{text}</b><br>"
                            "Score: %{y:.3f}<br>"
                            "Interaction: %{x}<extra></extra>"
                        ),
                        text=subset["task_type"],
                    ),
                    row=1, col=1,
                )

            # Rolling average
            sorted_exp = exp_plot.sort_values("interaction_num")
            sorted_exp["rolling"] = sorted_exp["score"].rolling(5, min_periods=1).mean()
            fig.add_trace(
                go.Scatter(
                    x=sorted_exp["interaction_num"],
                    y=sorted_exp["rolling"],
                    mode="lines",
                    name="Rolling Avg",
                    line=dict(color=COLORS["primary"], width=3),
                    fill="tozeroy",
                    fillcolor="rgba(0,212,170,0.1)",
                ),
                row=2, col=1,
            )

            fig.update_layout(
                height=500,
                showlegend=True,
                legend=dict(orientation="h", y=1.12),
                margin=dict(t=60),
            )
            fig.update_yaxes(title_text="Score", range=[0, 1], row=1, col=1)
            fig.update_yaxes(title_text="Avg", range=[0, 1], row=2, col=1)
            fig.update_xaxes(title_text="Interaction #", row=2, col=1)
            st.plotly_chart(fig, use_container_width=True)
        else:
            st.info("No interactions yet. Run the agent to see evolution data.")

    with right:
        st.markdown("#### Leaderboard")
        if not strategies.empty:
            for i, (_, row) in enumerate(strategies.head(8).iterrows()):
                rank = i + 1
                medal = {1: "🥇", 2: "🥈", 3: "🥉"}.get(rank, f"#{rank}")
                fitness_pct = row["fitness"] * 100
                bar_color = COLORS["primary"] if rank <= 3 else COLORS["muted"]
                st.markdown(
                    f"**{medal} {row['id'][:8]}** — age {row['age']}\n\n"
                    f"`{'█' * int(fitness_pct / 5)}{'░' * (20 - int(fitness_pct / 5))}` "
                    f"**{row['fitness']:.3f}**"
                )

    # Score distribution + Task performance
    st.markdown("---")
    c1, c2 = st.columns(2)

    with c1:
        st.markdown("#### Score Distribution")
        if not experiences.empty:
            fig = go.Figure()
            fig.add_trace(go.Histogram(
                x=experiences["score"],
                nbinsx=20,
                marker_color=COLORS["primary"],
                opacity=0.8,
            ))
            fig.add_vline(
                x=experiences["score"].mean(),
                line_dash="dash",
                line_color=COLORS["warning"],
                annotation_text=f"mean={experiences['score'].mean():.3f}",
            )
            fig.update_layout(
                height=300,
                xaxis_title="Score",
                yaxis_title="Count",
                margin=dict(t=20),
            )
            st.plotly_chart(fig, use_container_width=True)

    with c2:
        st.markdown("#### Performance by Task Type")
        if not experiences.empty:
            task_stats = experiences.groupby("task_type").agg(
                avg_score=("score", "mean"),
                max_score=("score", "max"),
                count=("score", "count"),
                avg_tokens=("tokens_used", "mean"),
            ).reset_index()

            fig = go.Figure()
            fig.add_trace(go.Bar(
                x=task_stats["task_type"],
                y=task_stats["avg_score"],
                name="Avg Score",
                marker_color=COLORS["primary"],
                text=task_stats["count"].apply(lambda x: f"n={x}"),
                textposition="outside",
            ))
            fig.add_trace(go.Bar(
                x=task_stats["task_type"],
                y=task_stats["max_score"],
                name="Best Score",
                marker_color=COLORS["secondary"],
                opacity=0.5,
            ))
            fig.update_layout(
                height=300,
                barmode="overlay",
                yaxis_range=[0, 1.1],
                margin=dict(t=20),
            )
            st.plotly_chart(fig, use_container_width=True)


# ── TAB 2: Strategies ─────────────────────────────────────────────
with tab_strategies:

    if not genome_df.empty:
        # Strategy selector
        selected_strat = st.selectbox(
            "Select strategy to inspect",
            options=genome_df["id"].tolist(),
            format_func=lambda x: f"{x} (fitness={genome_df[genome_df['id']==x]['fitness'].values[0]:.3f})",
        )

        top_row_left, top_row_right = st.columns(2)

        with top_row_left:
            # Radar chart — all strategies overlaid
            st.markdown("#### Personality Profiles")
            fig = go.Figure()
            for i, (_, row) in enumerate(genome_df.head(6).iterrows()):
                values = [row[t] for t in TRAIT_NAMES] + [row[TRAIT_NAMES[0]]]
                is_selected = row["id"] == selected_strat
                fig.add_trace(go.Scatterpolar(
                    r=values,
                    theta=TRAIT_NAMES + [TRAIT_NAMES[0]],
                    fill="toself",
                    name=f"{row['id']}",
                    opacity=0.8 if is_selected else 0.2,
                    line=dict(width=3 if is_selected else 1),
                ))
            fig.update_layout(
                polar=dict(
                    radialaxis=dict(range=[-1, 1], showticklabels=False),
                    bgcolor="rgba(0,0,0,0)",
                ),
                height=400,
                margin=dict(t=40),
                showlegend=True,
                legend=dict(orientation="h"),
            )
            st.plotly_chart(fig, use_container_width=True)

        with top_row_right:
            # Selected strategy detail card
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

            # Tool preferences for selected
            st.markdown("**Tool Preferences:**")
            for tool in TOOL_NAMES:
                val = sel[f"tool_{tool}"]
                bar = "█" * int(val * 20) + "░" * (20 - int(val * 20))
                st.text(f"  {tool:>10}  {bar}  {val:.2f}")

        # Individual learning curves
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
                    x=strat_exp["n"],
                    y=strat_exp["cumulative_avg"],
                    mode="lines+markers",
                    name=strat_id,
                    opacity=1.0 if is_selected else 0.3,
                    line=dict(width=3 if is_selected else 1),
                    marker=dict(size=6 if is_selected else 3),
                ))
            fig.update_layout(
                height=350,
                xaxis_title="Interaction # (per strategy)",
                yaxis_title="Cumulative Average Score",
                yaxis_range=[0, 1],
                margin=dict(t=20),
            )
            st.plotly_chart(fig, use_container_width=True)

        # Genome comparison heatmap
        st.markdown("---")
        st.markdown("#### Genome Comparison Matrix")

        gene_cols = (
            TRAIT_NAMES
            + [f"tool_{t}" for t in TOOL_NAMES]
            + ["temperature", "reasoningDepth", "mutability", "learningRate", "habitatPref"]
        )
        gene_labels = (
            TRAIT_NAMES
            + TOOL_NAMES
            + ["temp", "reasoning", "mutability", "learnRate", "habitat"]
        )
        heatmap_data = genome_df[gene_cols].values
        fig = go.Figure(go.Heatmap(
            z=heatmap_data,
            x=gene_labels,
            y=genome_df["id"].tolist(),
            colorscale="RdBu",
            zmid=0,
            text=np.round(heatmap_data, 2),
            texttemplate="%{text}",
            textfont=dict(size=9),
        ))
        fig.update_layout(
            height=max(200, len(genome_df) * 40),
            xaxis_title="Gene",
            yaxis_title="Strategy",
            margin=dict(t=20),
        )
        st.plotly_chart(fig, use_container_width=True)

    else:
        st.info("No strategies in population yet.")


# ── TAB 3: MAP-Elites ─────────────────────────────────────────────
with tab_map:

    c1, c2 = st.columns([2, 1])

    with c1:
        st.markdown("#### Behavioral Niche Grid")
        st.caption(
            "Each cell represents a behavioral niche. "
            "The grid preserves diversity by keeping the best genome per niche."
        )

        grid_matrix = np.full((8, 8), np.nan)
        if not grid_rows.empty:
            for _, row in grid_rows.iterrows():
                x, y = int(row["x"]), int(row["y"])
                if 0 <= x < 8 and 0 <= y < 8:
                    grid_matrix[y][x] = row["fitness"]

        # Custom text: show fitness or empty indicator
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
            colorscale=[
                [0, "#1a1a2e"],
                [0.25, "#16213e"],
                [0.5, "#0f3460"],
                [0.75, "#00D4AA"],
                [1, "#7B61FF"],
            ],
            showscale=True,
            colorbar=dict(title=dict(text="Fitness", side="right")),
            hoverongaps=False,
            text=text_matrix,
            texttemplate="%{text}",
            textfont=dict(size=12, color="white"),
            xgap=3,
            ygap=3,
        ))
        fig.update_layout(
            height=500,
            xaxis=dict(
                title="Behavioral Axis 1",
                dtick=1,
                showgrid=False,
            ),
            yaxis=dict(
                title="Behavioral Axis 2",
                dtick=1,
                showgrid=False,
            ),
            margin=dict(t=20),
        )
        st.plotly_chart(fig, use_container_width=True)

    with c2:
        st.markdown("#### Grid Stats")

        filled = np.count_nonzero(~np.isnan(grid_matrix))
        total = 64

        # Coverage gauge
        fig = go.Figure(go.Indicator(
            mode="gauge+number",
            value=filled / total * 100,
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
                threshold=dict(
                    line=dict(color=COLORS["accent"], width=2),
                    thickness=0.8,
                    value=filled / total * 100,
                ),
            ),
            title=dict(text="Grid Coverage"),
        ))
        fig.update_layout(height=250, margin=dict(t=60, b=20))
        st.plotly_chart(fig, use_container_width=True)

        st.metric("Cells Filled", f"{filled} / {total}")

        if not grid_rows.empty:
            st.metric("Best Niche Fitness", f"{grid_rows['fitness'].max():.3f}")
            st.metric("Avg Niche Fitness", f"{grid_rows['fitness'].mean():.3f}")
            st.metric("Fitness Range", f"{grid_rows['fitness'].max() - grid_rows['fitness'].min():.3f}")

    # Niche detail
    if not grid_rows.empty:
        st.markdown("---")
        st.markdown("#### Niche Details")
        niche_data = grid_rows.copy()
        niche_data["cell"] = niche_data.apply(lambda r: f"({int(r['x'])}, {int(r['y'])})", axis=1)

        for _, niche in niche_data.iterrows():
            genome = json.loads(niche["genome"])
            temp = genome.get("temperature", 0)
            depth = genome.get("reasoningDepth", 0)
            style = genome.get("promptStyle", [0]*8)

            # Find dominant trait
            dominant_idx = int(np.argmax([abs(s) for s in style[:len(TRAIT_NAMES)]]))
            dominant_trait = TRAIT_NAMES[dominant_idx] if dominant_idx < len(TRAIT_NAMES) else "?"

            with st.expander(
                f"Cell ({int(niche['x'])}, {int(niche['y'])}) — "
                f"fitness {niche['fitness']:.3f} — "
                f"dominant: {dominant_trait}"
            ):
                c1, c2, c3, c4 = st.columns(4)
                c1.metric("Temperature", f"{temp:.3f}")
                c2.metric("Reasoning", f"{depth:.3f}")
                c3.metric("Dominant Trait", dominant_trait)
                c4.metric("Trait Value", f"{style[dominant_idx]:.3f}" if dominant_idx < len(style) else "?")


# ── TAB 4: Interactions ────────────────────────────────────────────
with tab_interactions:

    if not experiences.empty:
        # Filters
        fc1, fc2, fc3 = st.columns(3)
        with fc1:
            filter_task = st.selectbox(
                "Task Type",
                ["All"] + experiences["task_type"].unique().tolist(),
            )
        with fc2:
            filter_min = st.slider("Min Score", 0.0, 1.0, 0.0, 0.05)
        with fc3:
            filter_strat = st.selectbox(
                "Strategy",
                ["All"] + experiences["strategy_id"].str[:8].unique().tolist(),
            )

        filtered = experiences.copy()
        if filter_task != "All":
            filtered = filtered[filtered["task_type"] == filter_task]
        if filter_min > 0:
            filtered = filtered[filtered["score"] >= filter_min]
        if filter_strat != "All":
            filtered = filtered[filtered["strategy_id"].str[:8] == filter_strat]

        st.caption(f"Showing {len(filtered)} of {len(experiences)} interactions")

        # Before/After comparison
        if len(filtered) >= 2:
            st.markdown("#### Before / After Comparison")
            ba1, ba2 = st.columns(2)

            earliest = filtered.iloc[0]
            latest = filtered.iloc[-1]

            with ba1:
                st.markdown(f"**Earliest** — Score: `{earliest['score']:.3f}`")
                st.markdown(f"*Strategy: {earliest['strategy_id'][:8]} | {earliest['task_type']}*")
                st.text_area(
                    "Prompt",
                    earliest["task_prompt"][:500],
                    height=80,
                    key="early_prompt",
                    disabled=True,
                )
                st.text_area(
                    "Response",
                    earliest["response"][:500],
                    height=150,
                    key="early_response",
                    disabled=True,
                )

            with ba2:
                st.markdown(f"**Latest** — Score: `{latest['score']:.3f}`")
                st.markdown(f"*Strategy: {latest['strategy_id'][:8]} | {latest['task_type']}*")
                st.text_area(
                    "Prompt",
                    latest["task_prompt"][:500],
                    height=80,
                    key="late_prompt",
                    disabled=True,
                )
                st.text_area(
                    "Response",
                    latest["response"][:500],
                    height=150,
                    key="late_response",
                    disabled=True,
                )

            score_delta = latest["score"] - earliest["score"]
            delta_color = "green" if score_delta > 0 else "red"
            st.markdown(
                f"**Score change:** :{delta_color}[{score_delta:+.3f}] "
                f"({earliest['score']:.3f} → {latest['score']:.3f})"
            )

        # Token efficiency
        st.markdown("---")
        st.markdown("#### Token Efficiency")
        fig = px.scatter(
            filtered,
            x="tokens_used",
            y="score",
            color="task_type",
            size="latency_ms",
            hover_data=["strategy_id"],
            opacity=0.7,
        )
        fig.update_layout(
            height=350,
            xaxis_title="Tokens Used",
            yaxis_title="Score",
            margin=dict(t=20),
        )
        st.plotly_chart(fig, use_container_width=True)

        # Interaction list
        st.markdown("---")
        st.markdown("#### Interaction Log")
        for _, exp in filtered.iloc[::-1].head(20).iterrows():
            score = exp["score"]
            if score >= 0.7:
                icon = "🟢"
            elif score >= 0.4:
                icon = "🟡"
            else:
                icon = "🔴"

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

                if exp.get("user_feedback") and not pd.isna(exp["user_feedback"]):
                    st.metric("User Feedback", f"{exp['user_feedback']:.2f}")
    else:
        st.info("No interactions recorded yet.")


# ── Skills Section (always visible at bottom) ──────────────────────
st.markdown("---")
st.markdown("### 🧠 Learned Skills")

if not skills.empty:
    skill_cols = st.columns(min(3, len(skills)))
    for i, (_, skill) in enumerate(skills.iterrows()):
        task_types = json.loads(skill["task_types"])
        with skill_cols[i % len(skill_cols)]:
            st.markdown(
                f"**{skill['type'].upper()}** — fitness: {skill['fitness']:.2f}\n\n"
                f"Tasks: {', '.join(task_types)}\n\n"
                f"Uses: {skill['successes']}/{skill['uses']}"
            )
            st.code(skill["content"][:300], language="markdown")
else:
    st.caption("No skills extracted yet. Skills emerge from high-scoring interactions (score ≥ 0.8).")


# ── Footer ──────────────────────────────────────────────────────────
st.markdown("---")
st.markdown(
    f"<div style='text-align:center; color:{COLORS['muted']}; font-size:0.8rem;'>"
    "Living-Agent — AI agents that evolve themselves<br>"
    "github.com/your-repo/living-agent"
    "</div>",
    unsafe_allow_html=True,
)
