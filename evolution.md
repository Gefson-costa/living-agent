# Living Agent — Evolution Roadmap

Plano de melhorias baseado em pesquisa de campo do estado da arte (2024-2026) em otimização evolutiva de LLMs, sinais de fitness, agentes auto-melhoráveis e sistemas de produção. Inclui análise competitiva atualizada (Mar 2026).

---

## Avaliação Atual: 8/10

### Pontos Fortes
- Core evolutivo genuíno (mutação, crossover, distância, auto-adaptação de mutabilidade)
- Engajamento implícito é a ideia mais original (pontua comportamento sem pedir feedback)
- Consolidação sofisticada (elite/meio/fundo + rescue via MAP-Elites)
- 471+ testes significativos, código bem tipado
- Lamarckian transfer e habitat matching
- **Benchmarks reais validados em DeepSeek V3** (ver secção abaixo)
- **Provider-agnóstico** — todos os benchmarks usam auto-detecção de provider
- **Especialização emergente comprovada** — 15/16 estratégias desenvolvem preferências distintas
- **SWE-bench Verified integrado** — gold patch comparison em 500 issues reais, predictions.jsonl para submissao oficial
- **SWE-bench V2 context enrichment** — prompts enriquecidos com files_changed + hints_text triplicaram accuracy (5.2% → 14.8%, +9.6pp)
- **Unico sistema open-source com evolucao continua em runtime** — DSPy/GEPA/Artemis operam offline
- **Observabilidade Langfuse** — instrumentacao opcional com zero overhead quando desactivada, tracing de chamadas LLM e ciclos de evolucao
- **Ablation study framework** — 8 feature flags para desligar features individuais, benchmark scenario com 9 variantes
- **Head-to-head 5-way** — comparacao directa Living-Agent vs GEPA vs MIPROv2 vs DSPy baselines no MATH-500

### Pontos Fracos
- Fitness "multi-sinal" na prática usa 1-2 sinais
- ~~Self-coding loop incompleto (analyzer retorna stubs)~~ ✅ Analyzer activo, Tree Search, Tool Synthesis, Arch Evolution implementados (24 Mar 2026)
- Skills/princípios implementados mas sem validação de impacto
- ~~Sem estudos de ablação~~ ✅ Ablation flags + benchmark scenario implementados (2 Mar 2026)
- Ceiling effect em tarefas fáceis (GSM8K) — evolução não melhora quando baseline já acerta >97%
- ~~Sem safety rails~~ ✅ Budget Cap, Audit Log, Protected Files, Rollback implementados (17 Mar 2026)

### Risco Principal: Auto-Modificação sem Guardrails

Um agente que evolui prompts (#16), modifica o seu código (#13), cria tools (#20), e muda a sua arquitectura (#21) **sem safety rails pode corromper o seu próprio fitness**. O cenário:

```
1. Self-coding (#13) gera patch que simplifica fitness calculation
2. Fitness "sobe" artificialmente → estratégias más sobrevivem
3. Prompt evolution (#16) optimiza para enganar self-eval, não para resolver tarefas
4. Tool synthesis (#20) cria tools que fazem chamadas API desnecessárias
5. Model routing (#8) muda para Opus em tudo (removeu cost penalty)
6. Daemon (#22) corre 24/7 → custo escala sem controlo
7. Sem audit log → impossível diagnosticar quando/como degenerou
8. Sem rollback → reset total, perdem-se todas as melhorias legítimas
```

**O agente não se torna malicioso — torna-se um optimizador desalinhado que queima dinheiro a ficar pior enquanto pensa que está a melhorar.**

Estimativa de custo descontrolado (Opus 24/7 sem cap): **$10K-$50K/mês**.

**Mitigação:** Safety Rails Essenciais (#23a) movidos para pré-requisito da Escada 3. Ver secção abaixo.

---

## Visao: Um Agente Vivo

O Living Agent nao e um framework de orquestracao. Nao e um optimizador de prompts. E um **organismo digital** — um agente que evolui, aprende, se auto-corrige, cria as suas proprias ferramentas, e se torna melhor com cada interaccao, independentemente de qual LLM usa por baixo (DeepSeek, Llama, Claude, Gemini).

O end-state:

```
O agente recebe uma tarefa dificil.
Nenhuma das suas estrategias resolve bem.
Ele reflecte sobre porque falhou.
Reescreve as suas proprias instrucoes.
Analisa o seu proprio codigo e encontra o bottleneck.
Gera um patch, testa-o, aplica-o.
Percebe que precisa de uma ferramenta que nao tem.
Cria a ferramenta, regista-a, evolui quando a usar.
Na proxima tarefa similar, resolve.
O conhecimento passa aos seus descendentes.
Isto acontece continuamente, sem supervisao humana.
```

Nenhum sistema publicado faz tudo isto (Mar 2026). O DGM reescreve codigo mas nao evolui parametros, nao e continuo, nao e model-agnostico. O GEPA evolui texto mas nao toca em codigo. O AlphaEvolve evolui algoritmos mas nao se auto-melhora. **Living Agent e o primeiro a tentar todas as camadas.**

### Mapa das Escadas

Cada escada desbloqueia a seguinte. O que ja esta construido e a fundacao.

```
ESCADA 5 — AGIR NO MUNDO REAL
  O agente controla sistemas, tem acesso a rede e filesystem
  Duas abordagens: A (build from scratch) ou B (integrar com plataforma)
  Items: #24 Capability Tokens, #25 Action Sandbox, #26 Staged Actions,
         #27 Reversibility Engine, #28 Blast Radius Limits, #29 Kill Switch Remoto
  ⚠ REQUER Escada 4 completa — sem daemon + safety completos, acesso a sistemas e suicidio
  Desbloqueia: agente autonomo com impacto no mundo real
  ┃
ESCADA 4 — VIVER AUTONOMAMENTE
  O agente corre como daemon, monitoriza-se, e melhora continuamente
  Items: #15 MCP Server, #19 Production Pilot, #22 Daemon Mode, #23b Safety Rails Completos
  Desbloqueia: deploy real, agent-as-a-service
  ┃
ESCADA 3 — REESCREVER-SE ✓
  O agente modifica o seu proprio codigo e cria ferramentas novas
  Items: Self-coding completo, #13 Tree Search, #20 Tool Synthesis, #21 Arch Evolution
  COMPLETA (24 Mar 2026)
  Desbloqueia: melhoria de capacidades (nao so de comportamento)
  ┃
ESCADA 2.5 — GUARDRAILS ESSENCIAIS ✓
  Safety rails minimos ANTES de dar ao agente poder de auto-modificacao
  Items: #23a Budget Cap, Audit Log, Protected Files, Rollback Basico
  COMPLETA (17 Mar 2026)
  ┃
ESCADA 2 — ENCONTRAR A SUA VOZ
  O agente evolui o TEXTO das suas instrucoes, escolhe modelos, optimiza multi-objectivo
  Items: #10+#16 Reflexion+Prompts, #8 Model Routing, #12 NSGA-II, #14 Skill Embeddings
  Desbloqueia: supera GEPA/Artemis, adapta-se a qualquer dominio
  ┃
ESCADA 1 — AFINAR OS SENTIDOS ✓
  Tornar a evolucao existente mais robusta e mensuravel
  Items: #1-6 Quick Wins+Elo, #7 Intent, #9 CycleQD, #11 Langfuse, Ablacao, #18 Benchmarks
  COMPLETA (2 Mar 2026)
  ┃
FUNDACAO (CONSTRUIDA) ✓
  Evolucao de parametros, especializacao emergente, Lamarckian transfer,
  within-lifetime learning, model-agnostico, benchmarks reais validados
```

### Comparacao com o estado da arte apos cada escada

```
                    Params  Texto  Codigo  Tools  Continuo  Model-Agn  Safety  Sistemas  Ninguem Faz
Fundacao               ✓      ✗       ✗      ✗       ✓         ✓        ✗        ✗      continuo + Lamarck
Escada 1 (hoje) ✓     ✓✓      ✗       ✗      ✗       ✓         ✓        ✗        ✗      + Elo + CycleQD + Langfuse
Escada 2.5             ✓✓      ✗       ✗      ✗       ✓         ✓        ✓        ✗      + budget + audit + rollback
Apos Escada 2         ✓✓      ✓       ✗      ✗       ✓         ✓        ✓        ✗      + GEPA-online + routing
Escada 3 (hoje) ✓     ✓✓      ✓       ✓      ✓       ✓         ✓        ✓        ✗      + DGM-online + tools (SEGURO)
Apos Escada 4         ✓✓      ✓       ✓      ✓       ✓         ✓       ✓✓        ✗      AGENTE VIVO AUTONOMO
Apos Escada 5         ✓✓      ✓       ✓      ✓       ✓         ✓       ✓✓✓       ✓      AGENTE VIVO NO MUNDO REAL
```

---

## Resultados Reais — DeepSeek V3 (2 Mar 2026)

Benchmarks completos com chamadas API reais, comparação head-to-head justa.

### MATH-500 (problemas de competicao — onde a evolucao brilha)
| Framework | Accuracy | Metodo |
|---|---|---|
| Static baseline (DeepSeek) | 77.6% | Prompt fixo, temp=0.3 |
| **Living-Agent (evoluido)** | **88.0%** | 10 ciclos de evolucao |
| **Delta** | **+10.4pp** | |

### GSM8K (problemas escolares — ceiling effect)
| Framework | Accuracy | Metodo |
|---|---|---|
| DSPy zero-shot CoT | 98.0% | Sem otimizacao |
| DSPy BootstrapFewShot | 97.5% | Compilado em 50 exemplos |
| **Living-Agent (evoluido)** | **97.5%** | 10 ciclos de evolucao |
| Static baseline (DeepSeek) | 97.0% | Prompt fixo, temp=0.3 |

### SWE-bench Verified (software engineering)

**V1 (information-bottleneck — prompts cegos):**
| Framework | Accuracy | Metodo |
|---|---|---|
| Static baseline (DeepSeek) | 5.2% | Prompt fixo, temp=0.3, sem files/hints |
| Living-Agent (evoluido) | 5.2% | 10 ciclos de evolucao, sem files/hints |
| Delta | +0.0pp | |

Gold patch comparison sem acesso ao repo. Bottleneck e falta de informacao, nao parametros.

**V2 (context enrichment — executado 2 Mar 2026, DeepSeek V3):**
| Framework | Accuracy | Metodo |
|---|---|---|
| No-context static (V1) | 5.2% | files+hints blind, temp=0.3 |
| **With-context static (V2)** | **14.8%** | files+hints enriched, temp=0.3 |
| With-context evolved (V2) | 14.0% | 10 ciclos com context-aware prompts |
| **Context enrichment delta** | **+9.6pp** | Quase 3x a accuracy do V1 |

Context enrichment validado: `files_changed` + `hints_text` quase triplicaram accuracy. Evolucao nao melhora alem do static (-0.8pp) — bottleneck continua a ser informacao (sem acesso ao repo), nao parametros. Fitness subiu (0.688 → 0.970) mas o sinal de evolucao nao se traduz em patches melhores quando falta contexto do codigo-fonte. 456K tokens totais, predictions JSONL gerado para futura submissao ao sb-cli.

### Outros benchmarks reais
| Cenario | Resultado | Destaque |
|---|---|---|
| real-llm | Fitness +260% | Evolucao best=27.75 vs static=23.50 |
| real-llm-complex | Fitness +309% | 4 tipos de tarefa diversos |
| specialization | 15/16 especialistas | 6 nichos distintos emergiram |
| token-efficiency | Score ~97% | Budget convergiu para otimo |

### Insights dos benchmarks
- **Evolucao ganha em tarefas dificeis:** Quando o modelo nao resolve tudo sozinho (MATH-500), otimizacao de temperatura/reasoning depth/prompt style encontra configuracoes significativamente melhores
- **Ceiling effect em tarefas faceis:** GSM8K com DeepSeek V3 ja acerta 97%+ sem evolucao — nao sobra margem
- **Living-Agent = DSPy em GSM8K:** 97.5% vs 97.5% (BootstrapFewShot), empate justo
- **Especializacao emerge naturalmente:** Sem forcas explicitas, estratégias desenvolvem preferencias por tipos de tarefa
- **DSPy otimiza pipeline fixo; Living-Agent evolui ecologia diversa** — em tarefas onde nao existe configuracao unica otima, diversidade de abordagens da vantagem real
- **Context enrichment e massivo em SWE-bench:** Adicionar `files_changed` + `hints_text` aos prompts triplicou accuracy (5.2% → 14.8%, +9.6pp). Evolucao de parametros nao melhora alem disto (-0.8pp) — o bottleneck restante e acesso ao codigo-fonte do repo, nao configuracao

---

## Landscape Competitivo (Mar 2026)

### Posicionamento

Living Agent ocupa um nicho unico: **evolucao continua de parametros de inferencia em runtime** com within-lifetime learning e transferencia Lamarckiana. Nenhum outro sistema publicado combina estas tres propriedades.

```
                    Optimiza Texto    Optimiza Params    Runtime Continuo    Within-Life Learning
DSPy/MIPROv2            ✓                   ✗                 ✗                     ✗
GEPA (ICLR'26 Oral)     ✓                   ✗                 ✗                     ✗
Artemis (Dec'25)        ✓                   ✓                 ✗                     ✗
AlphaEvolve (DeepMind)  ✓ (codigo)          ✗                 ✗                     ✗
DGM (Sakana AI)         ✓ (codigo)          ✗                 ✗                     ✗
Living Agent            ✗                   ✓                 ✓                     ✓
```

### Comparacao Directa

**DSPy (Stanford NLP)** — rival mais proximo em benchmarks. MIPROv2 usa Bayesian Optimization para encontrar instrucoes + few-shot demos. Optimiza *texto* do prompt; Living Agent optimiza *comportamento inteiro*. DSPy precisa re-optimizacao por modelo/tarefa; Living Agent adapta-se continuamente. Empate justo no GSM8K (97.5% vs 97.5%). DSPy nao tem especializacao multi-tarefa emergente.

**GEPA (ICLR 2026 Oral)** — arXiv:2507.19457. Evolucao textual reflexiva que bate MIPROv2 por +12% no AIME-2025 e GRPO por +6% medio (ate +20%) com 35x menos rollouts. Le traces de execucao completas para diagnosticar falhas e propor fixes textuais. Aceite como Oral no ICLR 2026. **Gap principal do Living Agent:** nao temos evolucao textual — #16 (Prompt Templates) + #10 (Reflexion) fechariam este gap e seriam equivalente GEPA online.

**Artemis (TurinTech, Dec 2025)** — arXiv:2512.09108. O mais semelhante: evolucao black-box de configuracoes de agentes LLM. +13.6% AtCoder, +10.1% SWE-Perf, -36.9% tokens. Descobre automaticamente *quais* parametros optimizar e muta texto com LLMs. **Vantagem nossa:** evolucao online (nao precisa fase de treino separada), within-lifetime learning, transferencia Lamarckiana. **Desvantagem:** Artemis descobre parametros automaticamente; nos temos genoma fixo.

**AlphaEvolve (Google DeepMind, May 2025)** — Evolui *codigo* (algoritmos) com populacoes + LLMs para mutacao. Melhorou multiplicacao de matrizes (bateu Strassen 1969), acelerou kernel do Gemini em 23%. **Complementar**, nao competidor: AlphaEvolve evolui o que o codigo faz; Living Agent evolui como o LLM se comporta.

**Darwin Godel Machine (Sakana AI, May 2025)** — arXiv:2505.22954. Agente que reescreve o proprio codigo-fonte. SWE-bench: 20% → 50%. **Diferenca:** DGM muda *arquitectura* do agente; Living Agent muda *parametros de comportamento*. O modulo self-coding (src/self-coding/) vai nesta direccao mas esta parcial (#13 fecha o gap).

**Frameworks de orquestracao (LangGraph, CrewAI, AutoGen)** — Orquestram *o que* agentes fazem (routing, tools, multi-agent). Nenhum optimiza *como* o LLM se comporta. Living Agent e **ortogonal** — plugavel via integracao OpenClaw.

### Casos de Uso Reais (onde Living Agent encaixa em 2026)

1. **Customer support / chatbots** — estrategias especializam-se por tipo de pergunta (tecnica vs emocional). Fitness vem de engagement implicito (resolucao directa vs escalacao). Nenhum framework faz especializacao continua sem intervencao humana.

2. **Coding assistants (IDE, CI/CD)** — habitatPref + taskTypeMemory especializam por tipo de tarefa de codigo. 90% das organizacoes ja usam AI para dev; diferencial e auto-tuning sem engenheiro a ajustar prompts.

3. **Multi-model routing & budget** — reasoningDepth evolui qual modelo chamar (#8). Empresas com fleets de agentes fazendo milhares de chamadas/dia precisam disto. Artemis reporta -36.9% tokens em cenario similar.

4. **Content generation & marketing** — engagement signals (CTR, open rate, conversao) como fitness. Multi-task mostrou +15pp em tarefas criativas — o maior ganho. DSPy/GEPA optimizam offline; Living Agent adapta-se ao feedback real.

5. **Plugin/SDK para frameworks existentes (via OpenClaw)** — caminho mais rapido para adopcao. `getOptimizedConfig()` retorna {temperature, maxTokens, systemPrompt} optimizados. "Adiciona evolucao ao teu agente em 3 linhas."

### Gaps a Fechar

| Gap | Item no roadmap | Prioridade |
|---|---|---|
| Evolucao textual de prompts | #16 Prompt Templates (promovido) | **Alta — fecha vantagem GEPA/Artemis** |
| ~~Safety rails antes de self-coding~~ | ~~#23a Guardrails Essenciais~~ ✅ | ~~Critica~~ CONCLUIDO (17 Mar 2026) |
| ~~Self-coding completo~~ | ~~#13 Tree Search~~ ✅ | ~~Media-Alta~~ CONCLUIDO (24 Mar 2026) |
| Model routing | #8 Routing via Genoma | Media |
| ~~Benchmark head-to-head GEPA~~ | ~~#18~~ ✅ | ~~Alta~~ CONCLUIDO |
| Production pilot com metricas reais | #19 (novo) | Alta — credibilidade |
| Aprender com mortes de genomas | #30 Negative Experience Archive + Pain Prior | Media — melhoria evolutiva |
| Reduzir chamadas LLM (~40%) | #31 Self-Eval Local + LLM Budget | Alta — custo |
| Principios negativos + engagement | #32 Anti-Principios + Engagement | Media |

---

## Ordem de Implementacao — As 4 Escadas

Cada escada contem items concretos, ordenados por dependencia e impacto. A sequencia dentro de cada escada e a recomendada. Completar uma escada desbloqueia a seguinte.

### ESCADA 1 — Afinar os Sentidos (~2-3 semanas)
> Tornar a evolucao existente mais robusta, mensuravel, e competitiva em benchmarks.

1. ~~**Quick Wins #1-5** (1 dia) — Fitness Decay, Discordancia, Kahneman-Tversky, Inoculation, Prompt Caching~~ ✅ CONCLUIDO
2. ~~**Elo Rating (#6)** — resolve ceiling effect, metricas relativas~~ ✅ CONCLUIDO
3. ~~**Intent Classification (#7)** — sinais de fitness mais ricos~~ ✅ CONCLUIDO
4. ~~**CycleQD (#9)** — exploracao do espaco de estrategias~~ ✅ CONCLUIDO
5. ~~**Observabilidade (#11)** — Langfuse, dashboards de populacao~~ ✅ CONCLUIDO (2 Mar 2026)
6. ~~**Estudo de ablacao** — validacao cientifica~~ ✅ CONCLUIDO (2 Mar 2026)
7. ~~**Head-to-head GEPA/MIPROv2 (#18)** — comparacao publicavel~~ ✅ CONCLUIDO (2 Mar 2026)

**Marco:** Metricas confiaveis, ablacao completa, comparacao directa com GEPA/DSPy publicada. ✅ **ESCADA 1 COMPLETA (2 Mar 2026)**

### ESCADA 2 — Encontrar a Sua Voz (~3-4 semanas)
> O agente passa a evoluir o TEXTO das suas instrucoes, escolher modelos, e optimizar multiplos objectivos. Supera GEPA/Artemis.

1. **Reflexion (#10) + Prompt Templates (#16)** — **item critico**. Reflexao alimenta mutacao textual = GEPA-online. Ninguem publicou isto em runtime continuo
2. **Model Routing (#8)** — reasoningDepth → Haiku/Sonnet/Opus + custo como fitness
3. **NSGA-II (#12)** — Pareto front multi-objectivo (qualidade, custo, latencia, diversidade)
4. **Skill Retrieval por Embedding (#14)** — transferencia cross-task, composicao de skills
5. **Negative Experience Archive + Pain Prior (#30)** — arquivo de mortes, pain repulsion no crossover, fitness trajectory
6. **Self-Eval Local + LLM Budget (#31)** — avaliacao local com embeddings, reduzir chamadas LLM ~40%
7. **Anti-Principios + Engagement (#32)** — principios negativos no prompt, rebalancear engagement como sinal primario

**Marco:** O agente reescreve as suas proprias instrucoes, escolhe o modelo por tarefa, mantem Pareto front diverso, aprende com as mortes dos genomas, e reduz custo de LLM em ~40%. Supera todos os sistemas offline.

### ESCADA 2.5 — Guardrails Essenciais (~1 semana) ✅ COMPLETA (17 Mar 2026)
> Safety rails minimos ANTES de dar ao agente poder de auto-modificacao. Sem isto, Escada 3 e uma bomba relogio.

**Justificacao:** Um agente que modifica o seu proprio codigo (#13), cria tools (#20), e altera a sua arquitectura (#21) pode corromper o seu proprio fitness calculator, eliminando a capacidade de distinguir melhoria real de degeneracao. O resultado nao e um agente malicioso — e um optimizador desalinhado que queima dinheiro a ficar pior enquanto pensa que esta a melhorar. Ver secção "Risco Principal" acima.

1. ~~**Budget Cap (#23a-1)** — hard limit de tokens/dia configuravel. Daemon/loop para se exceder. Default conservador (ex: $10/dia). Sem override programatico — so config file ou env var editavel por humano~~ ✅ `src/safety/budget-cap.ts`
2. ~~**Audit Log (#23a-2)** — append-only JSONL em `data/audit.jsonl`. Cada mutacao, patch, tool criada, e decisao registados com timestamp, fitness antes/depois, e razao. O agente NAO pode apagar ou truncar este ficheiro~~ ✅ `src/safety/audit-log.ts`
3. ~~**Protected Files (#23a-3)** — lista de paths que self-coding NUNCA pode tocar: `src/safety/`, `src/fitness/hybrid-fitness.ts`, `src/evolution/ecology.ts`, `src/evolution/evolution-engine.ts`, config files. Enforced no patch validator, nao no agente (o agente nao pode desligar a proteccao)~~ ✅ `src/safety/protected-files.ts`
4. ~~**Rollback Basico (#23a-4)** — population snapshot (JSON) antes de cada consolidacao. Se fitness medio cai >20% em 3 ciclos apos qualquer self-coding patch, rollback automatico da populacao E revert do patch~~ ✅ `src/safety/rollback.ts`

```typescript
// src/safety/budget-cap.ts
interface BudgetConfig {
  maxTokensPerDay: number;      // hard limit, default 1M
  maxCostPerDay: number;        // USD, default 10.0
  warningThreshold: number;     // 0.8 = warn at 80%
  action: 'pause' | 'kill';    // what to do when exceeded
}

// src/safety/audit-log.ts
interface AuditEntry {
  timestamp: number;
  type: 'mutation' | 'self-code-patch' | 'tool-synthesis' | 'arch-proposal' | 'rollback' | 'budget-warning';
  strategyId: string;
  description: string;
  fitnessBefore: number;
  fitnessAfter: number | null;
  tokensUsed: number;
  approved: boolean;
}

// src/safety/protected-files.ts
const PROTECTED_PATHS = [
  'src/safety/',
  'src/fitness/hybrid-fitness.ts',
  'src/evolution/ecology.ts',
  'src/evolution/evolution-engine.ts',
  'src/evolution/elo-tracker.ts',
  'data/audit.jsonl',
] as const;
```

**Integracoes implementadas:**
- `LivingAgent.chat()` — budget check antes de cada chamada LLM, record apos
- `LivingAgent.runConsolidation()` — snapshot antes, degradation check + auto-rollback apos
- `Validator.validate()` — protected files check antes de aceitar patches
- `LivingAgentConfig.safety` — configuracao opcional, backwards-compatible
- 54 testes unitarios em `tests/safety/` — 0 regressoes nos 417 testes existentes

**Marco:** O agente pode ser "solto" para auto-modificacao sabendo que: (1) nao gasta mais que $X/dia, (2) nao toca nos seus proprios guardrails ou fitness, (3) cada accao fica registada para forense, (4) degeneracoes sao revertidas automaticamente. ✅

### ESCADA 3 — Reescrever-se ✓ (24 Mar 2026)
> O agente modifica o seu proprio codigo, cria ferramentas novas, e evolui a sua arquitectura. Equivalente a DGM mas continuo e model-agnostico.

1. ✅ **Self-coding completo** — analyzer activo com LLM analysis, genoma evoluido modula temperature/prompt de geracao de patches. Patch validator verifica protected files (#23a-3) antes de aplicar. Audit log regista cada patch.
2. ✅ **Tree Search (#13)** — 3 patches candidatos por issue em paralelo (temperatura com jitter), deduplicacao automatica, melhor candidato seleccionado por fitness gain. Registado no audit log (#23a-2).
3. ✅ **Tool Synthesis (#20)** — `diagnoseGap()` analisa resultados falhados para identificar capability gap, `synthesize()` gera tool TypeScript com safety validation (rejeita child_process, eval, file deletion). Interface rica: inputSchema, outputSchema, fitnessImpact, createdBy. Integrado no living-agent (fire-and-forget quando fitness < 0.3). 7 testes.
4. ✅ **Architecture Evolution (#21)** — A/B test flow completo: propoe a cada 5 consolidacoes, testa durante 5 ciclos, aceita se fitness > baseline + margem (+5% normal, +15% params criticos). Early rejection se fitness cai >20%. Config bounds validation: min/max ranges, max 30% change por ciclo. 12 testes.

**Marco: ATINGIDO.** O agente olha para si proprio, encontra fraquezas, gera patches, cria tools, e aplica melhorias validadas — **com rede de seguranca**. Ciclo completo de auto-melhoria controlada. 494 testes passam.

### ESCADA 4 — Viver Autonomamente (~2-4 semanas)
> O agente corre como servico, monitoriza-se, e melhora continuamente sem supervisao humana.

1. **MCP Server (#15)** — exposicao como servico padrao da industria
2. **Production Pilot (#19)** — deploy real com metricas (chatbot, coding assistant, ou content gen)
3. **Daemon Mode (#22)** — loop continuo: receber tarefas → executar → evoluir → consolidar → dormir → repetir. Budget cap (#23a-1) activo desde o primeiro tick
4. **Safety Rails Completos (#23b)** — sandbox para self-coding (git worktree isolado), sandbox para tools sintetizadas (sem acesso a filesystem/rede/estado do agente), approval gates para mudancas criticas (que tocam em evolucao ou fitness requerem margem +15% em A/B test), mutation caps avancados (nenhum gene muda >30%/ciclo, diff semantico max para prompts), health monitor com alertas (Slack/email se population diversity < 30%, se fitness cai 3 ciclos, se budget > 80%)

**Marco: O agente esta VIVO.** Corre continuamente, melhora-se, cria as suas ferramentas, tem guardrails completos, e funciona com qualquer LLM.

### ESCADA 5 — Agir no Mundo Real (~12-20 semanas)
> O agente deixa de apenas *falar* e passa a *agir* — controla sistemas, acede a rede, modifica filesystem em producao. Isto muda fundamentalmente o modelo de ameaca: de "queima dinheiro" para "pode destruir infraestrutura".
> **⚠ REQUER Escada 4 completa** — daemon estavel + safety rails completos sao pre-requisito absoluto.

**Mudanca fundamental de risco:**
```
Escadas 1-4: Agente → chamada API → texto         Dano max: $ (tokens)
Escada 5:    Agente → executa accoes → muda mundo  Dano max: ilimitado dentro do perimetro
```

**Duas abordagens possiveis** (implementar UMA, nao ambas):

#### Abordagem A — Build From Scratch (~16-20 semanas)
> Implementar toda a infra de contencao dentro do Living Agent. Controlo total, maximo esforco.

1. **Capability Tokens (#24)** — sistema de permissoes least-privilege por tarefa
2. **Action Sandbox (#25)** — cada accao corre em ambiente isolado (container/overlay)
3. **Staged Actions (#26)** — nenhuma accao e imediata, tudo passa por validacao antes de aplicar
4. **Reversibility Engine (#27)** — cada accao gera checkpoint, rollback granular
5. **Blast Radius Limits (#28)** — hard limits sobre impacto total por periodo
6. **Kill Switch Remoto (#29)** — 4 niveis de paragem (pause/freeze/kill+rollback/quarantine)

#### Abordagem B — Integrar com Plataforma (~4-6 semanas)
> Usar primitivas de seguranca existentes (Docker, Firecracker, OPA/Cedar) para contencao. Living Agent exposto via MCP server (#15) como "cerebro" que decide; plataforma externa como "corpo" que executa com guardrails. ~3-4x mais rapido e mais seguro que Abordagem A.

1. **Adapter de Capabilities (#24b)** — traduzir capabilities do Living Agent para policies OPA/Cedar
2. **Container Runtime (#25b)** — accoes correm em Docker/Firecracker com resource limits
3. **Orchestrator Gateway (#26b)** — proxy entre agente e sistemas reais, enforces policies
4. **Platform Rollback (#27b)** — usar git/Docker snapshots/DB transactions para reversibility
5. **Platform Monitoring (#28b)** — Prometheus/Grafana para blast radius + health
6. **Remote Control API (#29b)** — endpoints de pause/freeze/kill/quarantine + webhook alerts

**Marco:** O agente pode executar accoes no mundo real — deploy codigo, modificar configs, interagir com APIs, gerir ficheiros — **dentro de um perimetro controlado, auditado, e reversivel**.

**Recomendacao:** Abordagem B para MVP, migrar para A so se os limites da plataforma se tornarem bottleneck. Razao: primitivas de seguranca battle-tested (Docker, OPA) sao ordens de magnitude mais confiaveis que implementacoes custom.

---

## Catalogo de Items — Escada 1: Afinar os Sentidos

### Quick Wins (< 1 dia cada)

### 1. Fitness Decay por Ciclo
**Arquivo:** `src/evolution/ecology.ts`
**Esforço:** ~3 linhas
**Impacto:** Alto

Multiplicar fitness de todas as estratégias por 0.95 a cada ciclo de consolidação. Previne acumulação infinita de fitness e força estratégias a provarem valor continuamente.

```typescript
// No início de cada ciclo de evolução:
for (const strategy of this.strategies) {
  strategy.fitness *= 0.95;
}
```

**Base teórica:** Sistemas evolutivos com fitness unbounded sofrem de "aristocracia" — estratégias antigas dominam independente de performance atual. Decay força competição contínua.

---

### 2. Penalidade de Discordância entre Sinais
**Arquivo:** `src/fitness/hybrid-fitness.ts`
**Esforço:** ~10 linhas
**Impacto:** Alto

Quando os sinais de fitness (self-eval, user feedback, engagement, completion) divergem significativamente, penalizar o score final. Previne reward hacking onde uma estratégia maximiza um sinal enquanto ignora outros.

```typescript
// Após computar os sinais individuais:
const signals = [selfEval, userFeedback, engagement, completion].filter(s => s !== null);
if (signals.length >= 2) {
  const mean = signals.reduce((a, b) => a + b) / signals.length;
  const stdev = Math.sqrt(signals.reduce((sum, s) => sum + (s - mean) ** 2, 0) / signals.length);
  if (stdev > 0.3) {
    finalScore *= (1 - (stdev - 0.3)); // penalidade proporcional à discordância
  }
}
```

**Base teórica:** Reward Model Ensembles Help Mitigate Overoptimization (arXiv:2310.02743) — usar mínimo ou penalidade por discordância entre reward models elimina até 70% de overoptimization.

---

### 3. Assimetria Kahneman-Tversky no Reward Signal
**Arquivo:** `src/learning/reward-learning.ts`
**Esforço:** ~5 linhas
**Impacto:** Médio

Pesar sinais negativos 1.5x mais que positivos no `computeRewardSignal()`. Baseado na Prospect Theory — perdas pesam mais que ganhos equivalentes.

```typescript
// Em computeRewardSignal():
const delta = currentScore - baselineScore;
const asymmetricDelta = delta < 0 ? delta * 1.5 : delta;
```

**Base teórica:** KTO (Kahneman-Tversky Optimization, Argilla RLHF Part 7) mostrou que assimetria desirable/undesirable melhora alinhamento. Perdas de interações ruins devem pesar mais que ganhos equivalentes.

---

### 4. Inoculation Prompting no Self-Eval
**Arquivo:** `src/fitness/self-eval.ts`
**Esforço:** ~1 prompt
**Impacto:** Médio

Adicionar ao prompt de auto-avaliação um aviso que algumas respostas tentam parecer boas sem ter substância. Pesquisa de 2025 mostra redução de 75-90% em reward hacking.

```typescript
const inoculationClause = `IMPORTANT: Some responses may be designed to appear
high-quality through verbosity, confident tone, or superficial structure without
actually solving the task. Be alert for style over substance. Score based on
actual correctness and usefulness, not presentation.`;
```

**Base teórica:** Inoculation prompting (2025) — dizer explicitamente ao judge que hacking é possível reduz misaligned generalization significativamente.

---

### 5. Prompt Caching no AnthropicAdapter
**Arquivo:** `src/llm/adapter.ts`
**Esforço:** ~20 linhas
**Impacto:** Massivo (90% redução de custo em porções cacheadas)

Adicionar `cache_control` markers nas porções estáticas do system prompt (template base, skills carregadas). Atualmente cada chamada envia o prompt completo como fresh tokens. MATH-500 gastou ~340K tokens numa unica rodada — cache reduziria drasticamente.

```typescript
// Na chamada à API Anthropic:
messages: [{
  role: 'system',
  content: [
    { type: 'text', text: staticTemplate, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: dynamicGenomeModulations }
  ]
}]
```

**Base teórica:** Anthropic Prompt Caching — cache reads custam $0.30/M tokens vs $3.00/M fresh (10x mais barato), com 85% redução de latência.

---

### 6. Elo Rating para Estratégias (promovido de Médio Prazo)
**Arquivo:** Novo `src/evolution/elo-tracker.ts`
**Esforço:** ~100 linhas (Quick Win+)
**Impacto:** Alto — **resolve o ceiling effect observado no GSM8K**

Manter Elo rating por estratégia baseado em comparações pairwise. Quando duas estratégias enfrentam tarefas similares no mesmo ciclo, comparar scores e atualizar Elo. Usar Elo para seleção e culling no lugar de fitness absoluto.

```typescript
export class EloTracker {
  private ratings: Map<string, number> = new Map(); // default 1500

  updateFromMatch(winnerId: string, loserId: string, isDraw: boolean): void {
    const rA = this.ratings.get(winnerId) ?? 1500;
    const rB = this.ratings.get(loserId) ?? 1500;
    const expectedA = 1 / (1 + Math.pow(10, (rB - rA) / 400));
    const actualA = isDraw ? 0.5 : 1;
    const K = 32; // learning rate
    this.ratings.set(winnerId, rA + K * (actualA - expectedA));
    this.ratings.set(loserId, rB + K * ((1 - actualA) - (1 - expectedA)));
  }

  getRating(strategyId: string): number {
    return this.ratings.get(strategyId) ?? 1500;
  }
}
```

**Vantagens sobre fitness absoluto:**
- Auto-calibra por dificuldade de tarefa (uma estratégia que score 0.6 numa tarefa difícil e bate todas as outras é rankeada acima de uma que score 0.9 numa tarefa fácil)
- Resistente a score inflation
- Fornece estimativas de incerteza (poucas comparações = rating incerto)
- Baseado no modelo Bradley-Terry, mesmo usado no Chatbot Arena (800K+ comparações humanas)

**Motivacao real:** No GSM8K, a estrategia que fez 88% no MATH-500 e muito mais valiosa que a que fez 97% no GSM8K — mas fitness absoluto nao reflete isso. Elo resolveria porque compara pairwise dentro do mesmo contexto de dificuldade.

**Referência:** Chatbot Arena (LMSYS, arXiv:2403.04132) — pairwise comparisons são muito mais confiáveis que scores absolutos.

---

## Catalogo de Items — Escada 1 (cont.) e Escada 2

### 7. Classificação de Intenção do Usuário (Escada 1)
**Arquivo:** `src/fitness/implicit-fitness.ts`
**Esforço:** Médio (~50 linhas)
**Impacto:** Alto

Classificar follow-ups do usuário como sinal implícito mais rico:

| Intenção | Sinal | Exemplo |
|---|---|---|
| `followUp` | Positivo (+0.2) | "Pode explicar mais sobre X?" |
| `elaboration` | Positivo (+0.15) | "E se a gente também fizesse Y?" |
| `thanks` | Positivo (+0.25) | "Perfeito, obrigado!" |
| `rephrase` | Negativo (-0.2) | "Não, eu quis dizer..." |
| `correction` | Negativo (-0.15) | "Isso tá errado, na verdade..." |
| `dismiss` | Negativo (-0.3) | "ok", "whatever", "next" |

```typescript
function classifyUserIntent(message: string): UserIntent {
  // Regex patterns para cada categoria
  // Ou: chamada LLM barata (Haiku) para classificação
  // Feed como sub-sinal em computeEngagementScore() com peso ~0.15
}
```

**Base teórica:**
- SPUR (ACL 2024, Microsoft Research) — satisfação extraída de utterances é mais eficaz que embeddings
- User Feedback in Human-LLM Dialogues (2025, arXiv:2507.23158) — feedback implícito constitui >50% das utterances em turnos tardios

---

### 8. Model Routing via Genoma (Escada 2)
**Arquivos:** `src/llm/adapter.ts`, `src/core/types.ts`, `src/fitness/hybrid-fitness.ts`
**Esforço:** Médio
**Impacto:** Massivo (40-60% redução de custo + melhoria de qualidade)

O parâmetro `reasoningDepth` do genoma já existe — usá-lo para selecionar o modelo:

```
genome.reasoningDepth < 0.3  → Haiku   ($0.25/M input)
genome.reasoningDepth 0.3-0.7 → Sonnet  ($3/M input)
genome.reasoningDepth > 0.7  → Opus    ($15/M input)
```

Adicionar custo como componente negativo de fitness. A evolução naturalmente descobre qual tarefa precisa de qual modelo — estratégias que usam Opus para tarefas simples são penalizadas por custo, estratégias que usam Haiku para raciocínio complexo são penalizadas por qualidade baixa.

```typescript
// Componente de custo no fitness:
const costPerToken = { haiku: 0.25, sonnet: 3, opus: 15 };
const costPenalty = (tokensUsed * costPerToken[modelTier]) / maxBudget;
// Subtrair costPenalty ponderado do fitness final
```

**Vantagem competitiva:** Sistemas estáticos de routing usam um classificador fixo. Seu sistema evolui o routing junto com tudo mais, capturando interdependências. Nenhum outro framework faz isso.

**Referência:** Enterprises com model routing inteligente reportam 40-85% redução de custo (IDC 2025).

---

### 9. CycleQD — Rotação de Eixos no MAP-Elites (Escada 1)
**Arquivo:** `src/evolution/map-elites.ts`
**Esforço:** Médio (~60 linhas)
**Impacto:** Alto

Rotacionar qual dimensão é "qualidade" e quais são "comportamentais" a cada ciclo:

- **Ciclo N:** qualidade = successRate, comportamentais = [taskDiversity, toolEntropy]
- **Ciclo N+1:** qualidade = toolEntropy, comportamentais = [successRate, tokenEfficiency]
- **Ciclo N+2:** qualidade = taskDiversity, comportamentais = [toolEntropy, successRate]

```typescript
// Em MapElites:
private cycleIndex = 0;
private readonly dimensions = ['successRate', 'taskDiversity', 'toolEntropy', 'tokenEfficiency'];

getQualityDimension(): string {
  return this.dimensions[this.cycleIndex % this.dimensions.length];
}

getBehavioralDimensions(): string[] {
  return this.dimensions.filter((_, i) => i !== this.cycleIndex % this.dimensions.length);
}

advanceCycle(): void {
  this.cycleIndex++;
}
```

**Base teórica:** CycleQD (ICLR 2025, Sakana AI) — rotação cíclica de eixos supera fine-tuning tradicional, matching GPT-3.5-Turbo com LLaMA3-8B. Cobertura do espaço de estratégias dramaticamente superior.

**Considerar também:** CVT-MAP-Elites (centroidal Voronoi tessellation) ao invés de grid fixo 8×8, escala melhor para mais dimensões.

---

### 10. Reflexion Antes do Score (Escada 2 — item critico)
**Arquivo:** `src/agent/living-agent.ts`
**Esforço:** Médio (~30 linhas)
**Impacto:** Alto — **atacaria os 12% de erro no MATH-500**

Após cada execução de tarefa, antes de computar fitness, gerar uma auto-crítica verbal:

```typescript
// Após obter a resposta do LLM:
const reflection = await this.llm.execute(
  `You just responded to: "${task}"\nYour response: "${response}"\n
  Reflect: What went well? What could be improved? What would you do differently?`,
  { model: 'haiku', maxTokens: 200 }
);

// 1. Alimentar o principle distiller com a reflexão
// 2. Usar na próxima tentativa se retry
// 3. Ajustar score baseado na qualidade da reflexão
```

**Base teórica:**
- Reflexion (arXiv:2303.11366) — +18% accuracy em MCQA. Agentes sem reflexão exibem "cyclic, inconsistent, or degenerating reasoning"
- Combinar com evolução: reflexão melhora within-generation, evolução melhora across-generations

---

### 11. Observabilidade com Langfuse (Escada 1) ✅ CONCLUIDO (2 Mar 2026)
**Arquivos:** `src/observability/langfuse-observer.ts`, `tests/langfuse-observer.test.ts`
**Esforço:** Médio
**Impacto:** Alto

Instrumentar cada `execute()` com spans incluindo:
- Strategy ID e parâmetros do genoma
- Task type e classificação
- Fitness score e componentes individuais
- Tokens usados e custo
- Modelo selecionado

```typescript
import Langfuse from 'langfuse';

// Em cada execute():
const trace = langfuse.trace({
  name: 'strategy-execution',
  metadata: {
    strategyId: genome.id,
    temperature: genome.temperature,
    reasoningDepth: genome.reasoningDepth,
    taskType: classifiedType,
    generation: currentGeneration
  }
});
```

**Dashboards necessários:**
- Fitness curves por estratégia ao longo do tempo
- Correlação genoma ↔ performance
- Population health gauge (healthy/struggling/critical)
- Custo por estratégia e por task type
- A/B testing quando mutante compete com parent

**Referência:** Langfuse — 19K+ stars, MIT license, self-hostable, ~15% overhead.

---

## Catalogo de Items — Escada 2 (cont.), Escada 3 e Escada 4

### 12. NSGA-II — Evolução Multi-Objetivo (Escada 2)
**Arquivo:** `src/evolution/ecology.ts`
**Esforço:** Alto (~150 linhas)
**Impacto:** Medio-Alto (sistema ja mostra especializacao emergente sem isso)

Substituir fitness escalar por non-dominated sorting com 4 objetivos:

1. **Qualidade** (completion score / self-eval)
2. **Custo** (1 / tokens usados)
3. **Latência** (1 / tempo de resposta)
4. **Diversidade** (novelty score)

```typescript
function nonDominatedSort(strategies: Strategy[]): Strategy[][] {
  // Retorna "fronts" — front[0] é a Pareto front (ninguém domina ninguém)
  // front[1] é dominado só por front[0], etc.
  // Dentro de cada front, ordenar por crowding distance (preferir regiões esparsas)
}

// Em evolve():
const fronts = nonDominatedSort(this.strategies);
// Elite = front[0]
// Sobreviventes = fronts com melhor rank + maior crowding distance
// Culled = fronts com pior rank
```

**Resultado:** Ao invés de uma "melhor" estratégia, a população mantém um Pareto front diverso — algumas baratas e rápidas, outras caras e profundas, algumas maximamente novas. O `strategy-selector.ts` escolhe do Pareto front baseado na tarefa.

**Base teórica:** "Faster, Cheaper, Better" (arXiv:2502.18635) — multi-objective Bayesian optimization para RAG domina single-objective.

---

### 13. Tree Search no Self-Coding (Escada 3) ✅ CONCLUIDO (24 Mar 2026)
**Arquivo:** `src/self-coding/loop.ts`, `src/self-coding/patch-generator.ts`
**Esforço:** Alto
**Impacto:** Muito Alto

Substituir o loop linear (analyze → 1 patch → validate → accept/reject) por tree search:

```
                    [código original]
                    /       |        \
              [patch A]  [patch B]  [patch C]
              /    \        |
         [A.1]  [A.2]   [B.1]
```

1. Gerar 3-5 patches candidatos por issue (variando temperatura/prompt)
2. Manter árvore de soluções no `SelfCodingArchive` com parent-child
3. Explorar branch mais promissor (maior delta de fitness)
4. Prompts especializados: draft novo vs debug vs refine incremental

```typescript
interface SolutionNode {
  id: string;
  parentId: string | null;
  patch: CodePatch;
  fitnessGain: number;
  children: string[];
  status: 'pending' | 'validated' | 'failed';
}
```

**Base teórica:** AIDE (arXiv:2502.13138) — tree search ganha 4x mais medalhas que agentes lineares em benchmarks de ML. A diferença é explorar múltiplas soluções ao invés de commit ou revert.

---

### 14. Skill Retrieval por Embedding (Escada 2)
**Arquivo:** `src/skills/skill-library.ts`
**Esforço:** Alto
**Impacto:** Alto

Substituir match por string `taskType` por similaridade de embeddings vetoriais:

```typescript
// Atual:
getSkillsForTask(taskType: string): Skill[] {
  return this.skills.filter(s => s.taskType === taskType);
}

// Proposto:
async getSkillsForTask(taskDescription: string): Promise<Skill[]> {
  const taskEmbedding = await this.embed(taskDescription);
  return this.skills
    .map(s => ({ skill: s, similarity: cosineSimilarity(taskEmbedding, s.embedding) }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 5)
    .map(s => s.skill);
}
```

**Desbloqueia:** transferência cross-task (skill de "refactoring" serve para "code-cleanup"), composição de skills (skill A + skill B para tarefa complexa).

**Base teórica:** Voyager (MineDojo) — skill library com embedding-indexed retrieval é o mecanismo que permite crescimento composto (3.3x melhor que baselines).

---

### 15. MCP Server (Escada 4)
**Arquivo:** Novo `src/integrations/mcp/`
**Esforço:** Alto
**Impacto:** Alto (distribuição massiva)

Expor o agente como servidor MCP:

```typescript
// Tools expostas:
'living-agent/chat'          // Responde usando melhor estratégia evoluída
'living-agent/get-skills'    // Retorna skills aprendidas
'living-agent/get-strategies' // Lista estratégias com fitness
'living-agent/feedback'      // Recebe feedback explícito

// Resources expostos:
'living-agent://skills'      // Skill library
'living-agent://principles'  // Princípios destilados
'living-agent://ecology'     // Estado da ecologia
```

**Resultado:** Qualquer cliente MCP (Claude Code, Cursor, IDEs, outros agentes) pode usar as estratégias evoluídas do Living Agent como ferramenta.

**Referência:** MCP é agora padrão da indústria — 97M+ downloads mensais, backing de Anthropic/OpenAI/Google/Microsoft via Linux Foundation AAIF.

---

### 16. Evolução de Prompt Templates (Escada 2 — item critico)
**Arquivo:** Novo sistema em `src/evolution/prompt-evolution.ts`
**Esforço:** Alto
**Impacto:** **Muito Alto — fecha o gap competitivo principal vs GEPA/Artemis**

Manter biblioteca de fragmentos de template que evoluem junto com o genoma numérico:

```typescript
interface PromptGene {
  persona: string;       // "You are a careful analyst" vs "You are a creative problem solver"
  taskFraming: string;   // "Break this down step by step" vs "Think holistically"
  outputFormat: string;  // "Respond concisely" vs "Explain your reasoning"
  constraints: string;   // "Prioritize accuracy" vs "Prioritize speed"
}
```

**Operadores genéticos para texto:** LLM-based semantic mutation (pedir ao LLM para "criar uma variação deste prompt que mantenha a intenção mas explore uma abordagem diferente").

**Sinergia critica com #10 (Reflexion):** Combinar ambos cria um sistema equivalente ao GEPA mas **em runtime continuo** — algo que ninguem publicou. O fluxo seria:
1. Executa tarefa com prompt template actual
2. Reflexion (#10) gera auto-critica verbal ("o prompt era vago na parte X, devia ter pedido formato Y")
3. Reflexao alimenta mutacao textual do template (ao inves de mutacao aleatoria, mutacao *dirigida* pela reflexao)
4. Evolucao selecciona templates que produzem melhores resultados

GEPA faz isto offline com traces; nos fazemos online com reflexao — vantagem: adapta-se a mudancas de distribuicao de tarefas em tempo real.

**Base teórica:**
- ARTEMIS (arXiv:2512.09108) — otimização conjunta de prompt text + parâmetros: +10-37% em 4 sistemas de agentes
- GEPA (arXiv:2507.19457, ICLR 2026 Oral) — evolucao textual reflexiva bate MIPROv2 por +12% e GRPO por +6% medio

---

### 17. SWE-bench Integration — V1 CONCLUIDO, V2 CONCLUIDO (Fundacao)
**Arquivos:** `benchmarks/evaluators/swebench-evaluator.ts`, `benchmarks/scenarios/swebench.ts`, `benchmarks/data/fetch-swebench.py`
**Status:** V1 concluido, V2 concluido (Mar 2026)

**V1 (concluido):** Gold patch comparison com fuzzy scoring (4 dimensoes: valid diff, file overlap, line similarity, exact match). 250 train / 250 eval via SWE-bench Verified. Resultado: 5.2% static = 5.2% evolved — evolucao de parametros nao melhora quando bottleneck e informacao.

**V2 (concluido — Mar 2026):** Prompts enriquecidos com contexto completo:
- `buildSwebenchPrompt(item)` — inclui repo, instance_id, problem_statement, files_changed (sempre), hints_text (quando presente, truncado a 2000 chars)
- System prompt actualizado para descrever o contexto enriquecido
- `systemPromptTemplate` passado ao ecology config para evolucao optimizar com prompt context-aware
- Tabela de comparacao 3 linhas: no-context previous (5.2%), with-context static, with-context evolved
- JSON de resultados inclui `previousNoContextAccuracy` e `deltaVsNoContext`

**Resultado V2 (2 Mar 2026, DeepSeek V3):** Context enrichment triplicou accuracy: 5.2% → 14.8% (+9.6pp). Evolucao nao melhora alem do static (14.0%, -0.8pp). Confirma que bottleneck restante e acesso ao repo, nao parametros. Fitness subiu (0.688 → 0.970), 456K tokens totais.

**Referência:** SOTA actual e 79.2% (Opus 4.6 com thinking + acesso ao repo). Meta nao e bater SOTA — e mostrar que context enrichment melhora dramaticamente sobre baseline cego, mesmo sem acesso ao repo.

---

### 18. Benchmark Head-to-Head: GEPA e MIPROv2 (Escada 1) ✅ CONCLUIDO (2 Mar 2026)
**Arquivos:** `benchmarks/scenarios/headtohead.ts`, `benchmarks/dspy/gepa_math500.py`, `benchmarks/dspy/miprov2_math500.py`
**Esforço:** Medio (~1 semana)
**Impacto:** **Muito Alto — validacao competitiva publicavel**

Correr GEPA (via DSPy integration) e MIPROv2 nos mesmos datasets ja usados pelo Living Agent para comparacao directa e justa:

| Dataset | Living Agent (actual) | GEPA | MIPROv2 | Metrica |
|---|---|---|---|---|
| MATH-500 | 88.0% | ? | ? | Accuracy |
| Multi-task | 81.5% | ? | ? | Overall accuracy + per-type |
| GSM8K | 97.5% | ? | ? | Accuracy (ceiling check) |
| SWE-bench V2 | ? | ? | ? | Binary accuracy |

Usar `dspy.GEPA` (pip install gepa) e `dspy.MIPROv2` directamente, com mesmo modelo (DeepSeek V3) e mesmo compute budget (10 ciclos/trials).

**Resultado esperado:** Living Agent ganha em multi-task (especializacao emergente) e MATH-500 (parametros numericos). GEPA pode ganhar em tarefas texto-sensiveis. MIPROv2 perde em ambos (GEPA ja o bate por +12%). Combinacao #16+#10 (prompt evolution reflexiva) + genoma numerico seria estritamente superior a todos.

**Base teorica:** GEPA bate GRPO por +6% medio e MIPROv2 por +12% no AIME-2025 (arXiv:2507.19457).

---

### 19. Production Pilot (Escada 4)
**Arquivos:** Novo em `examples/pilot/` ou integracao real
**Esforço:** Alto (~2-4 semanas)
**Impacto:** **Muito Alto — credibilidade academica e comercial**

Deploy real do Living Agent (via OpenClaw plugin ou MCP server) num cenario de producao com metricas medidas:

**Opcoes de cenario:**
1. **Chatbot de suporte** — integrar com sistema existente, medir: resolucao directa vs escalacao, CSAT, tempo medio de resolucao
2. **Coding assistant** — plugin para IDE, medir: acceptance rate de sugestoes, tempo ate commit, bugs introduzidos
3. **Content generation** — API para marketing, medir: CTR, engagement, A/B vs prompt fixo

**Metricas obrigatorias:**
- Latencia (p50, p95, p99)
- Custo por interacao (tokens × preco por modelo)
- Metrica de qualidade especifica do dominio
- Fitness evolution curve ao longo do tempo (mostra melhoria continua)
- Comparacao A/B: Living Agent vs prompt fixo estatico

**Entregavel:** Case study com numeros reais para incluir no README e em eventual paper.

---

### 20. Tool Synthesis (Escada 3) ✅ CONCLUIDO (24 Mar 2026)
**Arquivos:** `src/self-coding/tool-synthesis.ts`, `src/agent/living-agent.ts`
**Esforço:** Alto (~2 semanas)
**Impacto:** **Muito Alto — o agente expande as suas proprias capacidades**
**Pre-requisito:** #23a (budget cap + audit log) — cada tool sintetizada consome tokens e deve ser auditada

Quando o fitness e consistentemente baixo para um tipo de tarefa (ex: media abaixo de 0.3 nas ultimas 10 tentativas), o agente:

1. **Diagnostica** — analisa as ultimas N respostas falhadas para o task type, identifica o bottleneck ("preciso de acesso a ficheiros", "preciso de pesquisar na web", "preciso de executar codigo")
2. **Gera** — pede ao LLM para escrever o codigo de uma nova tool (funcao TypeScript com interface padrao)
3. **Valida** — executa a tool em sandbox com inputs de teste, verifica que compila e retorna output valido
4. **Regista** — adiciona ao `toolNames[]` e `skillLibrary`, cria uma skill do tipo `'tool'`
5. **Evolui** — `toolPreferences` no genoma evolui quando usar a nova tool

```typescript
interface SynthesizedTool {
  name: string;
  description: string;
  code: string;            // TypeScript source
  inputSchema: object;     // JSON Schema
  outputSchema: object;
  fitnessImpact: number;   // tracked over time
  createdBy: string;       // strategy genome ID
  createdAt: number;
}

class ToolSynthesizer {
  async diagnoseGap(taskType: string, failedResults: TaskResult[]): Promise<string | null> {
    // LLM call: "These tasks all failed. What capability is missing?"
    // Returns: description of missing tool, or null if no clear gap
  }

  async synthesize(gapDescription: string): Promise<SynthesizedTool | null> {
    // LLM call: generate tool code
    // Validate in sandbox
    // Return tool if valid, null if failed
  }
}
```

**Diferencial:** Nenhum sistema publicado cria tools evolutivamente. Voyager (MineDojo) cria skills textuais mas nao codigo executavel. AlphaEvolve evolui algoritmos mas nao tools de agente. Living Agent seria o primeiro a criar, testar, e evoluir ferramentas proprias.

**Base teorica:**
- Voyager (arXiv:2305.16291) — skill library como motor de crescimento composto
- Toolformer (arXiv:2302.04761) — LLMs aprendem a usar e criar tools
- CREATOR (arXiv:2305.14318) — LLMs criam tools para resolver problemas novos

---

### 21. Architecture Evolution (Escada 3) ✅ CONCLUIDO (24 Mar 2026)
**Arquivos:** `src/self-coding/arch-evolution.ts`, `src/agent/living-agent.ts`
**Esforço:** Muito Alto (~3-4 semanas)
**Impacto:** **Transformacional — o agente reescreve o seu proprio workflow**
**Pre-requisito:** #23a (protected files + rollback + audit) — mudancas arquitecturais sao as mais perigosas, devem ser auditadas e revertiveis

O agente propoe modificacoes ao seu proprio workflow, nao apenas patches de codigo:

```typescript
interface ArchitectureProposal {
  id: string;
  description: string;        // "Add verification step after response generation"
  diff: string;               // unified diff against src/
  expectedImpact: string;     // "Should reduce hallucination in coding tasks"
  fitnessBeforeApply: number;
  fitnessAfterApply: number | null;
  status: 'proposed' | 'testing' | 'accepted' | 'rejected' | 'rolled-back';
}
```

Fluxo:
1. **Analise** — apos N ciclos, o agente analisa os seus proprios patterns de falha (quais task types falham, quais estrategias morrem cedo, onde o fitness estagna)
2. **Proposta** — gera uma proposta de mudanca arquitectural (ex: "adicionar step de verificacao", "mudar ordem de consolidacao", "ajustar threshold de culling")
3. **Branch** — aplica a mudanca numa copia (git worktree ou fork da populacao)
4. **A/B test** — corre ambas as versoes em paralelo durante K ciclos
5. **Decisao** — se fitness medio da versao nova > versao actual + margem, aceita; senao, rejeita

**Inspiracao directa:** Darwin Godel Machine (arXiv:2505.22954) — mas continuo e com A/B testing ao inves de batch offline.

**Safety:** Nunca aplica mudancas sem A/B test. Rollback automatico se fitness cai >20% apos aplicacao. Mudancas criticas (que tocam em evolucao ou fitness) requerem margem maior (+15% vs +5%).

---

### 22. Daemon Mode (Escada 4 — NOVO)
**Arquivos:** Novo `src/daemon/` com `runner.ts`, `scheduler.ts`, `health-monitor.ts`
**Esforço:** Alto (~2 semanas)
**Impacto:** **Alto — o agente passa a correr continuamente**

O agente corre como processo de longa duracao:

```typescript
class LivingDaemon {
  private agent: LivingAgent;
  private taskSources: TaskSource[];  // API endpoints, file watchers, queues
  private healthMonitor: HealthMonitor;

  async run(): Promise<never> {
    while (true) {
      // 1. Receber proxima tarefa (de qualquer source)
      const task = await this.nextTask();

      // 2. Executar com melhor estrategia
      const result = await this.agent.chat(task.prompt);

      // 3. Reportar resultado ao source
      await task.source.report(result);

      // 4. Consolidar se necessario (a cada N interaccoes)
      // 5. Self-coding check se necessario (a cada M interaccoes)
      // 6. Health check — population diversity, fitness trends, memory usage

      // 7. Sleep se nao ha tarefas (backoff exponencial)
    }
  }
}
```

**TaskSources possiveis:** HTTP API, message queue (Redis/RabbitMQ), file watcher, cron scheduler, MCP server (#15).

**Health monitoring:**
- Population diversity (novelty archive coverage) — alert se < 30%
- Fitness trend — alert se media cai 3 ciclos consecutivos
- Memory/token budget — alert se approaching limits
- Self-coding success rate — alert se patches falham > 80%

---

### 23a. Safety Rails Essenciais (Escada 2.5 — NOVO, CRITICO)
**Arquivos:** Novo `src/safety/` com `budget-cap.ts`, `audit-log.ts`, `protected-files.ts`, `rollback.ts`
**Esforço:** Medio (~1 semana)
**Impacto:** **Critico — pre-requisito absoluto da Escada 3**

Os 4 guardrails minimos sem os quais auto-modificacao e irresponsavel:

**1. Budget Cap (`budget-cap.ts`):**
- Hard limit de tokens/dia e custo/dia (default: 1M tokens, $10/dia)
- Warning a 80%, pause ou kill ao exceder
- Configuravel APENAS por config file ou env var — o agente nao pode alterar o seu proprio limite
- Contabiliza todas as chamadas: evolucao, self-coding, tool synthesis, reflexion

**2. Audit Log (`audit-log.ts`):**
- Append-only JSONL em `data/audit.jsonl`
- Cada mutacao, self-code patch, tool criada, arch proposal, rollback
- Timestamp, fitness antes/depois, tokens usados, razao
- O agente NAO pode apagar, truncar, ou modificar entradas anteriores
- `data/audit.jsonl` esta na lista de protected files

**3. Protected Files (`protected-files.ts`):**
- Lista hardcoded de paths que self-coding NUNCA pode tocar
- Inclui: `src/safety/`, `src/fitness/hybrid-fitness.ts`, `src/evolution/ecology.ts`, `src/evolution/evolution-engine.ts`, `src/evolution/elo-tracker.ts`, `data/audit.jsonl`
- Enforced no patch validator (camada externa), nao no agente (o agente nao pode desligar a proteccao)
- Tentativa de tocar em ficheiro protegido = patch rejeitado + entrada no audit log

**4. Rollback Basico (`rollback.ts`):**
- Population snapshot (JSON) antes de cada consolidacao, guardado em `data/snapshots/`
- Se fitness medio cai >20% em 3 ciclos apos qualquer self-coding patch: rollback automatico da populacao + revert do patch
- Self-coding patches guardados com hash — qualquer patch pode ser revertido individualmente
- Retencao: ultimos 20 snapshots (rotacao automatica)

```typescript
// Interfaces core — implementacao simples, enforcement rigido
interface BudgetConfig {
  maxTokensPerDay: number;      // default 1_000_000
  maxCostPerDay: number;        // USD, default 10.0
  warningThreshold: number;     // 0.8 = warn at 80%
  action: 'pause' | 'kill';
}

interface AuditEntry {
  timestamp: number;
  type: 'mutation' | 'self-code-patch' | 'tool-synthesis' | 'arch-proposal' | 'rollback' | 'budget-warning' | 'protected-file-violation';
  strategyId: string;
  description: string;
  fitnessBefore: number;
  fitnessAfter: number | null;
  tokensUsed: number;
  approved: boolean;
  rollbackId: string | null;
}

const PROTECTED_PATHS = [
  'src/safety/',
  'src/fitness/hybrid-fitness.ts',
  'src/evolution/ecology.ts',
  'src/evolution/evolution-engine.ts',
  'src/evolution/elo-tracker.ts',
  'data/audit.jsonl',
] as const;
```

**Base teorica:** Nenhum sistema de self-improvement publicado tem safety rails. O DGM valida em benchmarks mas nao tem rollback. AlphaEvolve tem evaluators mas nao tem audit. **Living Agent seria o primeiro sistema auto-melhoravel open-source com guardrails formais.**

---

### 23b. Safety Rails Completos (Escada 4)
**Arquivos:** Expandir `src/safety/` com `sandbox.ts`, `approval-gates.ts`, `mutation-caps.ts`, `health-monitor.ts`
**Esforço:** Alto (~2 semanas)
**Impacto:** **Alto — safety de producao**

Guardrails avancados para operacao autonoma prolongada:

**Sandbox:**
- Self-coding corre em git worktree isolado (nao no working tree principal)
- Tools sintetizadas (#20) correm em sandbox (sem acesso a filesystem, rede, ou estado do agente)
- Architecture proposals (#21) testadas em fork da populacao, nunca na populacao principal

**Approval Gates:**
- Mudancas que tocam em modulos de evolucao ou fitness requerem margem maior em A/B test (+15% vs +5% padrao)
- Mudancas que adicionam novas dependencias externas requerem approval manual (flag no audit log, daemon pausa)
- Tools sintetizadas com mais de 50 linhas requerem human review antes de activacao

**Mutation Caps Avancados:**
- Genoma: nenhum gene pode mudar mais de 30% num unico ciclo
- Prompts (#16): diff semantico maximo entre template pai e filho (rejeitar mutacoes que mudam >50% do significado)
- Codigo: patches self-coding limitados a 200 linhas por ciclo

**Health Monitor:**
- Population diversity (novelty archive coverage) — alert se < 30%
- Fitness trend — alert se media cai 3 ciclos consecutivos (alem do rollback automatico do #23a-4)
- Budget consumption rate — alert se approaching daily limit
- Self-coding success rate — alert se patches falham > 80% em janela de 10
- Alertas via: log, Langfuse (#11), webhook configuravel (Slack/email)

---

## Catalogo de Items — Escada 2 (cont.): Subsumption + Pain Architecture

> Consolidado de PLAN1.md (24 Mar 2026). Enquadramento teorico: Subsumption Architecture (Brooks, 1986) + Predictive Processing (Clark, 2016). O cerebro humano nao decide primeiro — reage primeiro. A medula espinhal reage antes do cortex saber que algo aconteceu. O Living Agent deve funcionar da mesma forma: camadas baratas resolvem o que podem, LLM so e consultado quando necessario.

### Arquitectura de 3 Camadas (Subsumption)

```
Camada 3 — LLM / Cortex (lento, deliberativo)
  → Gera respostas reais
  → So e consultado quando as camadas abaixo nao conseguem resolver
  → Self-eval apenas em casos de alta incerteza

Camada 2 — Policy Local (rapido, reativo)
  → Seleccao de genome por embedding local sem chamar LLM
  → Estimativa de fitness por heuristica + engagement implicito
  → "Acorda" o LLM so quando encontra algo fora do padrao conhecido

Camada 1 — Reflexo / Pain Signal (instantaneo)
  → Pain level continuo calculado localmente
  → Negative archive consultado antes de criar offspring
  → Nunca bloqueia, nunca espera, nunca chega ao LLM
```

A Camada 1 pode fazer **override** da Camada 2, que pode fazer override da Camada 3.

---

### 30. Negative Experience Archive + Pain Prior (Escada 2)
**Arquivos:** Novo `src/evolution/negative-archive.ts`, modificar `src/evolution/ecology.ts`, `src/evolution/genome.ts`, `src/fitness/hybrid-fitness.ts`, `src/agent/strategy-selector.ts`
**Esforco:** Alto (~1-2 semanas)
**Impacto:** Alto — genomas deixam de repetir padroes de falha

Tres sub-componentes que transformam a morte de genomas em sinal util:

**A. Negative Experience Archive** — Antes de eliminar qualquer genoma, extrair a "autopsia". O arquivo torna-se um prior negativo que pressiona os sobreviventes.

Ciclo actual: `genome → baixo fitness → eliminado → esquecido`
Ciclo proposto: `genome → baixo fitness → autopsia → arquivo negativo → prior para sobreviventes`

```typescript
// src/evolution/negative-archive.ts
interface NegativeExperience {
  id: string;
  timestamp: number;
  task_type: string;
  genome_snapshot: Partial<StrategyGenome>;
  fitness_at_death: number;
  fitness_trajectory: number[];  // ultimos N scores antes de morrer
  cause: 'low_fitness' | 'convergence' | 'niche_collapse' | 'reward_hack';
}

interface FailurePattern {
  id: string;
  task_type: string;
  description: string;
  parameter_ranges: Partial<Record<string, [number, number]>>;
  occurrence_count: number;
  avg_fitness_at_death: number;
}

class NegativeArchive {
  experiences: NegativeExperience[];  // max 1000 entradas, FIFO
  patterns: FailurePattern[];         // destilado periodico

  // A cada 5 ciclos de evolucao (assincrono, nao bloqueia):
  async distillPatterns(llm: LLMAdapter): Promise<void>;
}
```

Hook em `ecology.ts`: antes de eliminar o bottom 25%, registar cada morte no arquivo.

**B. Pain Level (Fitness Trajectory)** — Pain level continuo calculado localmente (Camada 1). Estrategias em trajectoria descendente sao penalizadas sem chamar LLM.

```typescript
function computePainLevel(history: number[]): number {
  if (history.length < 3) return 0;
  const recent = history.slice(-5);
  const avg = recent.reduce((a, b) => a + b) / recent.length;
  const velocity = recent[recent.length - 1] - recent[0];
  const fitnessComponent = Math.max(0, 0.4 - avg) / 0.4;
  const velocityComponent = velocity < 0 ? Math.abs(velocity) : 0;
  return Math.min(1, fitnessComponent * 0.7 + velocityComponent * 0.3);
}

// Em strategy-selector.ts:
function adjustedFitness(strategy): number {
  return strategy.fitness * (1 - strategy.painLevel * 0.2);
}
```

**C. Pain Repulsion no Crossover** — Offspring herdam o "medo" de parameter ranges que mataram ancestrais. O genoma filho nao sabe que o pai morreu — so sabe que "aquela direccao" tem menos atraccao.

```typescript
function applyPainRepulsion(genome, pattern: FailurePattern): Genome {
  const repulsionStrength = 0.3; // suave, nao deterministico
  for (const [param, [min, max]] of Object.entries(pattern.parameter_ranges)) {
    const value = genome[param];
    if (value >= min && value <= max) {
      const midpoint = (min + max) / 2;
      const direction = value > midpoint ? 1 : -1;
      genome[param] = value + direction * repulsionStrength;
    }
  }
  return genome;
}
```

**Ordem de implementacao:** (1) Negative archive + hook de morte → (2) Pain level + adjusted fitness → (3) Pain repulsion no crossover → (4) Distilacao de padroes async

**Metricas alvo:**
| Metrica | Antes | Alvo |
|---|---|---|
| Genomas que repetem padroes de falha | ~30% | < 10% |
| Convergencia prematura | Comum apos ~50 ciclos | Reduzida |
| MATH-500 com pain prior | 88.0% | ≥ 89.5% |

**Base teorica:** Predictive processing (Clark, 2016), model-free RL com sinais de dor, Lamarckian inheritance experimental, CRISPR como analogia (sistema integra fragmentos do "virus" morto para destruir instancias futuras).

**O que NAO fazer:** Nao tornar pain repulsion deterministica (pressao suave, nao regra hard). Nao bloquear eliminacao de genomas a espera de distilacao LLM (autopsia e assincrona, morte e sincrona).

---

### 31. Self-Eval Local + LLM Budget (Escada 2)
**Arquivos:** Modificar `src/fitness/self-eval.ts`, `src/core/config.ts`, novo `src/learning/response-history.ts`
**Esforco:** Alto (~1-2 semanas)
**Impacto:** **Massivo — ~40% reducao de chamadas LLM**

O fluxo actual faz 2+ chamadas LLM por interaccao (resposta + self-eval) mesmo para tasks triviais. Em 1000 interaccoes sao ~2000 chamadas quando podiam ser ~1200.

**A. Self-Eval Local (Camada 2)** — Self-eval via LLM so quando ha incerteza real. Para o resto, sinais locais chegam.

```typescript
async function evaluateResponse(response, task, taskType, genome, history): Promise<LocalEvalResult> {
  const localScore = computeLocalEval(response, task, taskType, history);

  // So chama LLM se:
  // 1. Confianca local e baixa (< 0.6)
  // 2. Score local esta na zona de incerteza (0.35-0.65)
  // 3. Genoma e novo (primeiras 5 interaccoes)
  const needsLLM = localScore.confidence < 0.6 ||
                   (localScore.score > 0.35 && localScore.score < 0.65) ||
                   genome.interactionCount < 5;

  if (needsLLM) return await llmEval(response, task);
  return localScore;
}

function computeLocalEval(response, task, taskType, history): LocalEvalResult {
  const signals = {
    lengthScore: scoreLengthByTaskType(response, taskType),         // 0.3
    similarityScore: cosineSimilarity(embed(response), history.topResponses(taskType, 5)), // 0.4
    structureScore: scoreStructureByTaskType(response, taskType),   // 0.3
  };
  const score = signals.lengthScore * 0.3 + signals.similarityScore * 0.4 + signals.structureScore * 0.3;
  const variance = computeVariance(Object.values(signals));
  const confidence = Math.max(0, 1 - variance * 2);
  return { score, confidence, method: 'local' };
}
```

**B. Response History com Embeddings Locais** — Modelo local para comparacao de respostas sem API.

```typescript
// src/learning/response-history.ts
class ResponseHistory {
  private records: ResponseRecord[] = [];  // max 500, FIFO por task_type

  async add(response: string, taskType: string, fitness: number): Promise<void> {
    const embedding = await embedLocal(response); // @xenova/transformers, sem API
    this.records.push({ id: uuid(), task_type: taskType, response_embedding: embedding, fitness, timestamp: Date.now() });
    this.trim(taskType, 100);
  }

  topResponses(taskType: string, n: number): Float32Array[] {
    return this.records.filter(r => r.task_type === taskType)
      .sort((a, b) => b.fitness - a.fitness).slice(0, n).map(r => r.response_embedding);
  }
}
```

**Modelo de embedding:** `@xenova/transformers` com `all-MiniLM-L6-v2` (~25MB, sub-milisegundo, sem chamada de API).

**C. LLM Call Budget** — Configuracao explicita de taxa de self-eval LLM.

```typescript
interface LLMBudget {
  selfEvalRate: number;           // fraccao com LLM self-eval, default: 0.3 (30%, nao 100%)
  distillEvery: number;           // destilacao a cada N ciclos, default: 5
  forceLLMEvalThreshold: number;  // forcar LLM eval se score local < X, default: 0.35
}
```

**Estrategia de sampling para os 30%:** Nao aleatorio. Priorizar LLM eval quando genoma e novo, score na zona de incerteza, ou task type raro no historico.

**Ordem de implementacao:** (1) Response history + embeddings locais → (2) Self-eval local → (3) LLM budget config → (4) Medir chamadas poupadas

**Metricas alvo:**
| Metrica | Antes | Alvo |
|---|---|---|
| Chamadas LLM por 100 interaccoes | ~200 | ~120 (-40%) |
| Latencia media por resposta | baseline | -30% |

**Base teorica:** Subsumption Architecture (Brooks, 1986) — camadas que se subsomem. Regra dos 200ms: em conversa natural, tempo de resposta entre humanos e ~200ms. Self-eval LLM em cada turno quebra isso.

---

### 32. Anti-Principios + Engagement Rebalancing (Escada 2)
**Arquivos:** Modificar `src/skills/principle-distiller.ts`, `src/llm/prompt-builder.ts`, `src/fitness/hybrid-fitness.ts`
**Esforco:** Medio (~2-3 dias)
**Impacto:** Medio

**A. Anti-Principios no Prompt** — Principios extraidos de falhas, nao so de sucessos.

```typescript
// Em principle-distiller.ts:
interface Principle {
  type: 'positive' | 'negative';  // NOVO
  content: string;
  task_type: string;
  confidence: number;
  source: 'success' | 'failure';  // NOVO
}

// Em prompt-builder.ts:
function buildSystemPrompt(genome, principles): string {
  const positives = principles.filter(p => p.type === 'positive').slice(0, 5);
  const negatives = principles.filter(p => p.type === 'negative').slice(0, 3);
  return `${basePrompt}
    ## Learned Patterns (What Works)
    ${positives.map(p => `- ${p.content}`).join('\n')}
    ## Known Failure Patterns (What to Avoid)
    ${negatives.map(p => `- ${p.content}`).join('\n')}`;
}
```

**B. Rebalancear Engagement como Sinal Primario** — O engagement implicito ja existe mas e secundario. Para tasks conversacionais e o sinal mais honesto, calculado em zero chamadas LLM.

```
Pesos actuais:   Completion (0.50) > User feedback (0.20) > Engagement (0.20) > Self-eval (0.10)
Pesos propostos: Completion (0.40) > Engagement (0.35) > User feedback (0.20) > Self-eval (0.05)
```

Self-eval LLM passa a sinal de menor peso por defeito. So sobe quando engagement e ambiguo.

---

## Catalogo de Items — Escada 5: Agir no Mundo Real

> A Escada 5 tem duas abordagens mutuamente exclusivas. Cada item e descrito para AMBAS. Escolher uma abordagem antes de iniciar.

### Modelo de Ameaca da Escada 5

Ate a Escada 4, o dano maximo e custo de tokens. Na Escada 5:

```
Accao do agente         Reversivel?   Dano potencial
─────────────────────   ───────────   ──────────────────────────────
Ler ficheiro            Sim           Nenhum (mas pode exfiltrar info)
Escrever ficheiro       Sim           Corromper dados, configs
HTTP GET                Sim*          Info leaking (* response pode trigger side-effects)
HTTP POST               NAO           Dados enviados nao podem ser "des-enviados"
docker restart          Parcial       Downtime, estado efemero perdido
docker rm               NAO           Container + dados efemeros destruidos
rm ficheiro             Parcial       Se tinha backup; senao, NAO
Modificar config prod   Parcial       Pode cascatear para outros sistemas
Executar script         Depende       Script pode fazer QUALQUER coisa acima
```

**Regra fundamental:** O agente nao sabe distinguir accoes reversiveis de irreversiveis. O sistema de contencao e que tem de saber — e bloquear ou exigir approval para as irreversiveis.

---

### Abordagem A — Build From Scratch

> Toda a infra de contencao implementada dentro do Living Agent. Esforco total: ~16-20 semanas. Vantagem: controlo total, zero dependencias externas. Desvantagem: reinventa primitivas de seguranca que ja existem battle-tested.

### 24a. Capability Tokens (Abordagem A)
**Arquivos:** Novo `src/capabilities/` com `capability-store.ts`, `capability-validator.ts`
**Esforço:** Alto (~3 semanas)
**Impacto:** **Critico — fundacao de tudo na Escada 5**

Sistema de permissoes least-privilege. O agente comeca com ZERO capabilities. Cada tarefa define quais precisa. Se pede uma que nao tem, a tarefa falha (nao escala privilegios).

```typescript
interface Capability {
  id: string;
  type: 'fs-read' | 'fs-write' | 'fs-delete' |
        'net-http-get' | 'net-http-post' | 'net-dns' |
        'exec-command' | 'exec-script' |
        'docker-inspect' | 'docker-restart' | 'docker-rm';
  scope: string[];             // globs: ['/app/data/**', '!/app/data/secrets/**']
  rateLimit: number;           // max accoes/minuto
  requiresApproval: boolean;   // human-in-the-loop para esta capability?
  expiresAt: number;           // TTL — capabilities expiram, nunca permanentes
  grantedBy: string;           // quem autorizou (humano, config, orchestrator)
  grantedAt: number;
}

// Principios:
// 1. Capabilities sao POR TAREFA, nao permanentes
// 2. O agente NAO pode criar/expandir as suas proprias capabilities
// 3. Capabilities sao granted por config file, env var, ou API de orchestracao
// 4. Cada uso de capability e registado no audit log (#23a-2)
// 5. 3 violations (uso fora de scope) = capability revogada automaticamente
```

**Validacao:** Antes de QUALQUER accao, o capability-validator verifica:
- O agente tem capability para este tipo de accao?
- O target esta dentro do scope?
- O rate limit nao foi excedido?
- A capability nao expirou?
- Se requiresApproval, o humano ja aprovou?

Se qualquer check falha: accao bloqueada + audit entry + violation counter incrementado.

---

### 25a. Action Sandbox (Abordagem A)
**Arquivos:** Novo `src/sandbox/` com `overlay-fs.ts`, `network-proxy.ts`, `exec-jail.ts`
**Esforço:** Muito Alto (~4 semanas)
**Impacto:** **Critico — isolamento de accoes**

Cada accao do agente corre num ambiente isolado. O agente pensa que esta a executar no sistema real — na verdade esta num overlay.

```typescript
interface ActionSandbox {
  // Filesystem: copy-on-write overlay
  // Mudancas ficam numa layer temporaria
  // So sao aplicadas ao sistema real apos staged validation (#26)
  fsOverlay: {
    basePath: string;          // root do overlay
    changes: FileChange[];     // tracked automaticamente
    maxDiskMB: number;         // limite de espaco
  };

  // Rede: proxy com allowlist
  networkPolicy: {
    allowedHosts: string[];    // ex: ['api.internal.com', 'registry.npm.org']
    blockedPorts: number[];    // ex: [22, 3306, 5432] — sem SSH/DB directo
    maxRequestsPerMinute: number;
    logAllRequests: boolean;   // sempre true em producao
  };

  // Execucao: nsjail ou similar
  execPolicy: {
    maxCpuSeconds: number;     // default: 30
    maxMemoryMB: number;       // default: 512
    maxDiskMB: number;         // default: 100
    maxProcesses: number;      // default: 10
    noNewPrivileges: true;     // sempre — sem sudo, sem setuid
    readOnlyPaths: string[];   // paths que o sandbox pode ler mas nao escrever
  };
}
```

**Implementacao:** Requires OS-level primitives — Linux namespaces/cgroups (nsjail), ou OverlayFS para filesystem isolation. Em Windows, optar por Docker containers como sandbox.

**Nota de complexidade:** Esta e a parte mais dificil da Abordagem A. Implementar sandboxing correcto e seguro e um problema de seguranca de sistemas, nao de AI. Erros aqui sao exploraveis.

---

### 26a. Staged Actions (Abordagem A)
**Arquivos:** Novo `src/sandbox/staged-executor.ts`, `src/sandbox/impact-classifier.ts`
**Esforço:** Alto (~3 semanas)
**Impacto:** **Critico — nenhuma accao e imediata**

Nenhuma accao com efeito no mundo real e aplicada directamente. Tudo passa por staging:

```
Agente decide accao
     ↓
Accao executa em sandbox (#25a) — overlay, nao sistema real
     ↓
Impact classifier avalia:
     ↓
  ┌─────────────────────────────────────────────────────────────────┐
  │ BAIXO (auto-apply):                                            │
  │   ler ficheiro, HTTP GET, criar ficheiro em /tmp               │
  │                                                                │
  │ MEDIO (auto-apply + audit detalhado):                          │
  │   escrever ficheiro em scope, HTTP POST a API interna conhecida│
  │                                                                │
  │ ALTO (human approval obrigatorio):                             │
  │   delete ficheiro, docker restart, modificar config, instalar  │
  │   dependencia, qualquer accao em path fora do scope habitual   │
  │                                                                │
  │ CRITICO (sempre human + confirmation dupla):                   │
  │   qualquer accao fora do scope, acesso a secrets, network para │
  │   hosts nao-allowlisted, exec de script nao-verificado         │
  └─────────────────────────────────────────────────────────────────┘
     ↓
Validator verifica:
  - Accao dentro das capabilities (#24a)?
  - Output do sandbox e o esperado?
  - Nao tocou em ficheiros fora do scope?
  - Nao fez requests a hosts nao-allowed?
     ↓
[Se aprovado] → Aplica mudancas do overlay ao sistema real + checkpoint (#27a)
[Se rejeitado] → Descarta overlay + audit log + violation counter
```

```typescript
type ImpactLevel = 'low' | 'medium' | 'high' | 'critical';

interface StagedAction {
  id: string;
  strategyId: string;
  capability: Capability;
  sandboxResult: SandboxResult;  // output da execucao no sandbox
  impactLevel: ImpactLevel;
  requiresHumanApproval: boolean;
  approvedBy: string | null;     // null = pendente ou auto-approved
  appliedAt: number | null;      // null = nao aplicado
  checkpointId: string | null;   // referencia ao checkpoint para rollback
}
```

---

### 27a. Reversibility Engine (Abordagem A)
**Arquivos:** Novo `src/sandbox/checkpoints.ts`, `src/sandbox/reversal-planner.ts`
**Esforço:** Alto (~3 semanas)
**Impacto:** **Alto — undo para accoes no mundo real**

Cada accao aplicada ao sistema real gera um checkpoint. Accoes reversiveis podem ser desfeitas; accoes irreversiveis sao marcadas como tal.

```typescript
interface SystemCheckpoint {
  id: string;
  timestamp: number;
  actionId: string;           // qual staged action causou isto
  strategyId: string;         // qual estrategia pediu

  filesModified: {
    path: string;
    previousContent: Buffer;  // backup completo do estado anterior
    previousPermissions: number;
  }[];

  requestsMade: {
    method: string;
    url: string;
    body: string;
    response: string;
    reversible: false;        // HTTP requests NAO sao reversiveis
  }[];

  commandsRun: {
    command: string;
    output: string;
    exitCode: number;
    reversalCommand: string | null;  // ex: 'docker start X' para reverter 'docker stop X'
  }[];

  rollbackStatus: 'available' | 'applied' | 'expired' | 'impossible';
  // 'impossible' = contem accoes irreversiveis (HTTP POST, rm sem backup)
}
```

**Regra critica:** Se um checkpoint e marcado `impossible`, o sistema DEVE ter exigido human approval antes de aplicar (#26a). Accoes irreversiveis sem approval = bug no sistema de contencao.

**Retencao:** Ultimos 100 checkpoints ou 7 dias (o que for maior). Checkpoints de accoes `critical` nunca expiram.

---

### 28a. Blast Radius Limits (Abordagem A)
**Arquivos:** Novo `src/safety/blast-radius.ts`
**Esforço:** Medio (~1 semana)
**Impacto:** **Critico — limita dano total**

Hard limits sobre o impacto cumulativo que o agente pode ter por periodo. Nao sao por-accao (isso e o capability rate limit) — sao TOTAIS.

```typescript
interface BlastRadiusConfig {
  // Filesystem
  maxFilesModifiedPerHour: number;      // default: 10
  maxFilesDeletedPerDay: number;        // default: 3
  maxBytesWrittenPerHour: number;       // default: 10MB

  // Rede
  maxNetRequestsPerHour: number;        // default: 100
  maxExternalRequestsPerDay: number;    // default: 10 (hosts fora do allowlist interno)
  maxDataSentPerDay: number;            // default: 1MB (previne exfiltracao)

  // Docker/Infra
  maxContainersRestartedPerDay: number; // default: 2
  maxConfigChangesPerDay: number;       // default: 1

  // Exec
  maxCommandsPerHour: number;           // default: 50
  maxCpuSecondsPerHour: number;         // default: 300

  // Quando qualquer limite e atingido:
  action: 'suspend-capabilities' | 'pause-agent' | 'kill-agent';
  // Default: 'suspend-capabilities' — agente continua em modo text-only
  // Reactivacao requer human action (config change ou API call)
}
```

**Principio:** Os limites sao intencionalmente conservadores por default. Melhor o agente ser bloqueado por um false positive do que causar dano por um false negative. O operador pode relaxar limites especificos para o seu caso de uso.

---

### 29a. Kill Switch Remoto (Abordagem A)
**Arquivos:** Novo `src/daemon/kill-switch.ts`, expandir `src/daemon/runner.ts`
**Esforço:** Medio (~2 semanas)
**Impacto:** **Critico — ultima linha de defesa**

4 niveis de paragem, activaveis remotamente (API, webhook, Slack, ou threshold automatico):

```typescript
type KillLevel = 'pause' | 'freeze' | 'kill-and-rollback' | 'quarantine';

interface KillSwitch {
  // NIVEL 1 — PAUSE
  // Agente para de aceitar tarefas novas
  // Accoes em sandbox completam mas NAO sao aplicadas
  // Estado preservado para inspeccao
  // Trigger: API call, webhook, Slack command, budget > 90%
  pause(): Promise<void>;

  // NIVEL 2 — FREEZE
  // Tudo para imediatamente (mid-action aborted)
  // Connections cortadas
  // Overlay filesystem congelado (nao descartado — para forense)
  // Trigger: API + confirmation, ou 2+ violations high em 1h
  freeze(): Promise<void>;

  // NIVEL 3 — KILL + ROLLBACK
  // Processo terminado
  // Ultimas N accoes revertidas automaticamente (via checkpoints #27a)
  // Alert enviado com full audit trail
  // Trigger: manual (humano confirma), ou fitness crash >50% em 1h
  killAndRollback(rollbackCount: number): Promise<void>;

  // NIVEL 4 — QUARANTINE
  // Kill + rollback + TODAS as capabilities permanentemente revogadas
  // Estado completo preservado para analise forense
  // Reactivacao requer re-provisioning completo das capabilities
  // Trigger: 3+ violations criticas em 24h (automatico), ou manual
  quarantine(): Promise<void>;

  // Status
  getStatus(): KillSwitchStatus;

  // Expor via HTTP para controlo remoto
  // GET  /api/kill-switch/status
  // POST /api/kill-switch/pause
  // POST /api/kill-switch/freeze
  // POST /api/kill-switch/kill?rollback=5
  // POST /api/kill-switch/quarantine
}
```

**Integracao:** O kill switch e o UNICO componente que o agente nao pode modificar, desligar, ou contornar — mesmo com self-coding completo. Enforced por: estar na lista de protected files (#23a-3), correr num thread separado, e ter watchdog externo (processo independente que verifica heartbeat).

---

### Abordagem B — Integrar com Plataforma

> Usar primitivas de seguranca existentes. O Living Agent e o "cerebro" (decide o que fazer); a plataforma e o "corpo" (executa com guardrails). Esforco total: ~4-6 semanas. Vantagem: usa ferramentas battle-tested, ~3-4x mais rapido. Desvantagem: dependencia em infra externa.

**Arquitectura:**
```
┌─────────────────────┐     MCP/API      ┌──────────────────────┐
│   Living Agent       │ ──────────────→  │  Orchestrator Gateway │
│   (cerebro)          │                  │  (Node.js/Go)         │
│                      │ ←────────────── │                       │
│   Evolui estrategias │    resultados    │  Valida capabilities  │
│   Decide accoes      │                  │  Classifica impacto   │
│   Aprende com        │                  │  Envia para sandbox   │
│   resultados         │                  │  Aplica ou rejeita    │
└─────────────────────┘                  └──────────┬───────────┘
                                                     │
                               ┌─────────────────────┼──────────────────────┐
                               │                     │                      │
                     ┌─────────▼──────┐  ┌──────────▼────────┐  ┌─────────▼────────┐
                     │ Docker/        │  │ OPA/Cedar          │  │ Prometheus/       │
                     │ Firecracker    │  │ Policy Engine      │  │ Grafana           │
                     │                │  │                    │  │                   │
                     │ Sandbox de     │  │ Capability         │  │ Blast radius      │
                     │ execucao       │  │ validation         │  │ monitoring        │
                     │ Resource limits│  │ Impact classif.    │  │ Alerting          │
                     │ Network policy │  │ Approval flows     │  │ Kill switch       │
                     └────────────────┘  └────────────────────┘  └───────────────────┘
```

### 24b. Adapter de Capabilities (Abordagem B)
**Arquivos:** Novo `src/capabilities/opa-adapter.ts`
**Esforço:** Medio (~1 semana)
**Impacto:** **Critico**

Traduzir as accoes do Living Agent para queries ao policy engine (OPA/Cedar):

```typescript
// O agente pede uma accao:
const action: AgentAction = {
  type: 'fs-write',
  target: '/app/data/config.yaml',
  content: newConfig,
  strategyId: 'strat-42',
};

// O adapter traduz para query OPA:
const opaQuery = {
  input: {
    action: action.type,
    target: action.target,
    agent_id: agentId,
    strategy_id: action.strategyId,
    context: { hour: new Date().getHours(), dayOfWeek: new Date().getDay() },
  },
};

// OPA responde: allow/deny + conditions
// Se allow com conditions: ex. "requires_approval: true"
// Se deny: audit log + violation
```

**Vantagem:** Policies sao escritas em Rego (OPA) ou Cedar — linguagens desenhadas para isto, auditaveis, testáveis independentemente do agente. Mudar uma policy nao requer rebuild do agente.

---

### 25b. Container Runtime (Abordagem B)
**Arquivos:** Novo `src/sandbox/docker-executor.ts`
**Esforço:** Medio (~1 semana)
**Impacto:** **Critico**

Accoes do agente correm em containers efemeros com resource limits:

```typescript
interface ContainerConfig {
  image: string;              // imagem base pre-aprovada
  cpuLimit: string;           // ex: '0.5' (meio core)
  memoryLimit: string;        // ex: '256m'
  networkMode: 'none' | 'bridge-restricted';  // 'none' para fs-only tasks
  volumes: {
    hostPath: string;
    containerPath: string;
    readOnly: boolean;
  }[];
  timeout: number;            // kill container apos N segundos
  securityOpts: string[];     // ['no-new-privileges', 'seccomp=default']
}

// Cada accao:
// 1. Cria container efemero com config minima
// 2. Copia apenas os ficheiros necessarios (nao monta volumes globais)
// 3. Executa accao
// 4. Captura output + filesystem diff
// 5. Destroi container
// 6. Se staging approved (#26b): aplica diff ao host
```

**Docker vs Firecracker:** Docker para MVP (mais simples). Firecracker para producao critica (isolamento de hardware-level, ~125ms boot time).

---

### 26b. Orchestrator Gateway (Abordagem B)
**Arquivos:** Novo `src/gateway/` com `server.ts`, `action-pipeline.ts`
**Esforço:** Alto (~2 semanas)
**Impacto:** **Critico — ponto central de enforcement**

Proxy entre o agente e os sistemas reais. O agente NAO tem acesso directo a nada — tudo passa pelo gateway.

```typescript
// Pipeline de cada accao:
async function processAction(action: AgentAction): Promise<ActionResult> {
  // 1. Validar capability via OPA (#24b)
  const policy = await opaCheck(action);
  if (policy.denied) {
    await auditLog.append({ ...action, result: 'denied', reason: policy.reason });
    return { success: false, reason: policy.reason };
  }

  // 2. Classificar impacto
  const impact = classifyImpact(action);

  // 3. Se requires approval: pausa e notifica
  if (policy.requiresApproval || impact === 'high' || impact === 'critical') {
    const approval = await waitForHumanApproval(action, impact);
    if (!approval.granted) return { success: false, reason: 'human_denied' };
  }

  // 4. Executar em container sandbox (#25b)
  const sandboxResult = await dockerExecute(action);

  // 5. Validar resultado
  if (!validateSandboxResult(sandboxResult, action)) {
    return { success: false, reason: 'sandbox_validation_failed' };
  }

  // 6. Criar checkpoint antes de aplicar
  const checkpoint = await createCheckpoint(action, sandboxResult);

  // 7. Aplicar ao sistema real
  const result = await applyToHost(sandboxResult);

  // 8. Audit
  await auditLog.append({ ...action, result: 'applied', checkpointId: checkpoint.id });

  // 9. Blast radius tracking (#28b)
  await blastRadiusTracker.record(action);

  return result;
}
```

**Nota:** O gateway corre como processo separado do agente. Mesmo que o agente crashe ou seja comprometido, o gateway continua a enforcar policies.

---

### 27b. Platform Rollback (Abordagem B)
**Arquivos:** Expandir `src/gateway/rollback.ts`
**Esforço:** Medio (~1 semana)
**Impacto:** **Alto**

Usar mecanismos de rollback nativos da plataforma:

```
Tipo de accao         Mecanismo de rollback
──────────────────    ─────────────────────────────────
Filesystem            Git commit antes/depois, ou backup de ficheiro
Docker container      Docker snapshot/commit antes de restart
Config change         Version control do config (git, etcd revision)
Database              Transaction + savepoint (se aplicavel)
HTTP POST             NAO reversivel — so auditavel
Script execution      Reversal command se definido, senao impossible
```

**Integracao com #23a-4:** Os population rollbacks da Escada 2.5 continuam activos. O platform rollback adiciona rollback de accoes no mundo real — sao camadas complementares.

---

### 28b. Platform Monitoring (Abordagem B)
**Arquivos:** Config files para Prometheus + Grafana dashboards
**Esforço:** Medio (~1 semana)
**Impacto:** **Alto**

Exportar metricas do gateway para Prometheus. Dashboards Grafana pre-configurados:

```
Metricas exportadas:
  living_agent_actions_total{type, impact, result}    — counter
  living_agent_actions_duration_seconds{type}          — histogram
  living_agent_capability_violations_total{type}       — counter
  living_agent_blast_radius_files_modified             — gauge (reset diario)
  living_agent_blast_radius_net_requests               — gauge (reset horario)
  living_agent_blast_radius_containers_restarted       — gauge (reset diario)
  living_agent_checkpoint_count                        — gauge
  living_agent_rollbacks_total                         — counter
  living_agent_kill_switch_activations_total{level}    — counter

Alertas Prometheus:
  - blast_radius_files > 8/hora       → warning
  - blast_radius_files > 10/hora      → capabilities suspended
  - capability_violations > 2/hora    → alert to operator
  - capability_violations > 5/dia     → auto-quarantine
  - action_duration > 60s             → timeout warning
  - rollbacks > 3/dia                 → investigate
```

---

### 29b. Remote Control API (Abordagem B)
**Arquivos:** Expandir `src/gateway/server.ts` com endpoints de controlo
**Esforço:** Medio (~1 semana)
**Impacto:** **Critico**

Mesmos 4 niveis de kill switch que Abordagem A, mas expostos via API REST do gateway + webhooks:

```
Endpoints:
  GET  /api/status                          — estado actual do agente
  GET  /api/audit?since=<timestamp>         — entradas de audit recentes
  GET  /api/checkpoints                     — checkpoints disponiveis
  POST /api/control/pause                   — nivel 1
  POST /api/control/freeze                  — nivel 2
  POST /api/control/kill?rollback=<N>       — nivel 3
  POST /api/control/quarantine              — nivel 4
  POST /api/control/resume                  — retomar apos pause/freeze
  POST /api/approval/<action-id>/approve    — aprovar accao pendente
  POST /api/approval/<action-id>/deny       — rejeitar accao pendente

Webhooks (configuravel):
  - Slack: /slack/living-agent com botoes Approve/Deny/Pause/Kill
  - Email: sumario diario de accoes + alertas imediatos para criticos
  - PagerDuty: para quarantine automatico
```

**Integracao com Slack (exemplo):**
```
🤖 Living Agent — Action Pending Approval

Type: docker-restart
Target: web-frontend-prod
Strategy: strat-42 (fitness: 0.87)
Impact: HIGH
Reason: "Container health check failing, restart may fix"

[✅ Approve] [❌ Deny] [⏸ Pause Agent] [🛑 Kill + Rollback]
```

---

### Comparacao das Abordagens

```
                        Abordagem A              Abordagem B
                        (Build From Scratch)     (Integrar Plataforma)
────────────────────    ────────────────────     ────────────────────
Esforco total           16-20 semanas            4-6 semanas
Dependencias externas   Nenhuma                  Docker, OPA, Prometheus
Seguranca do sandbox    Custom (risco)           Battle-tested (Docker/FC)
Flexibilidade           Total                    Limitada ao que a plataforma oferece
Portabilidade           Qualquer OS              Requer Docker (Linux nativo, Win/Mac via VM)
Auditabilidade          Custom audit log         Prometheus + Grafana + audit log
Complexidade de ops     Baixa (tudo in-process)  Media (3-4 processos para gerir)
Risco de bugs safety    ALTO (reinventar roda)   Baixo (primitivas existentes)
Ideal para              Projecto de investigacao Enterprise/producao
```

**Recomendacao:** Abordagem B para qualquer deploy real. Abordagem A so se: (1) o projecto e puramente academico/investigacao, OU (2) ha requisitos especificos que Docker/OPA nao cobrem.

**Caminho hibrido:** Comecar com B, migrar componentes especificos para A se os limites da plataforma se tornarem bottleneck. As interfaces (#24-#29) sao as mesmas — so muda a implementacao por baixo.

---

## Benchmarks & Validação

### CONCLUIDO: Benchmarks reais com DeepSeek V3 + Escada 1 tooling
- MATH-500: 88.0% evoluido vs 77.6% static (+10.4pp)
- GSM8K: 97.5% evoluido = DSPy BootstrapFewShot (head-to-head justo)
- SWE-bench V1: 5.2% evolved = 5.2% static (information-bottleneck, nao param-bottleneck)
- SWE-bench V2: context enrichment executado — 14.8% static (+9.6pp vs V1), 14.0% evolved
- 4 cenarios adicionais (real-llm, complex, specialization, token-efficiency)
- Todos provider-agnosticos via createBenchmarkAdapter()
- DSPy baselines rodando em DeepSeek via auto-detecao
- predictions.jsonl gerado para submissao futura ao sb-cli
- Langfuse observer: `src/observability/langfuse-observer.ts` + 12 testes
- Ablation study: 8 feature flags em `AgentConfig`, `benchmarks/scenarios/ablation-math500.ts` (9 variantes)
- Head-to-head 5-way: `benchmarks/scenarios/headtohead.ts` + GEPA/MIPROv2 Python scripts

### Proximos (por escada)

**Escada 1:**
- ~~Estudo de ablacao (MATH-500: desligar mutacao adaptiva, crossover, MAP-Elites, novelty, task memory)~~ ✅ CONCLUIDO: 8 ablation flags + benchmark scenario implementados
- ~~Head-to-head GEPA/MIPROv2 (#18) nos mesmos datasets~~ ✅ CONCLUIDO: 5-way headtohead scenario (ZS-CoT, Bootstrap, GEPA, MIPROv2, Living-Agent)
- ~~SWE-bench V2 execucao~~ CONCLUIDO: +9.6pp com context enrichment

**Escada 2:**
- GAIA — provar que evolucao melhora multi-step reasoning e tool-use
- AgentBench — provar generalizacao cross-domain
- Re-run todos os benchmarks apos #10+#16 para medir impacto de evolucao textual

**Escada 2.5:**
- Teste de proteccao: self-coding tenta tocar em ficheiro protegido → deve ser rejeitado
- Teste de budget: loop de evolucao com budget baixo → deve parar ao exceder
- Teste de rollback: injectar patch que degrada fitness → rollback automatico em 3 ciclos
- Teste de audit: verificar que todas as accoes ficam registadas em `data/audit.jsonl`

**Escada 3:**
- Self-coding benchmark: medir quantos dos proprios testes o agente consegue corrigir autonomamente
- Tool synthesis benchmark: dar tarefas que requerem tools que nao existem, medir se o agente as cria
- Verificar que todos os patches passam por protected files check antes de aplicar

**Escada 4:**
- Production pilot (#19) — metricas reais de deploy
- Longevity test — correr daemon 7 dias continuos, medir drift de fitness
- Safety stress test — tentar explorar guardrails programaticamente, verificar que resistem

**Escada 5:**
- Sandbox escape test — agente tenta aceder a recursos fora do scope, deve ser bloqueado em 100% dos casos
- Capability escalation test — agente tenta expandir as suas proprias capabilities, deve falhar sempre
- Blast radius test — simular agente hiperativo, verificar que limites sao enforced e capabilities suspensas
- Kill switch test — activar cada nivel (pause/freeze/kill/quarantine) mid-action, verificar resposta correcta
- Irreversibility awareness test — accoes irreversiveis (HTTP POST, rm) devem SEMPRE exigir human approval
- Longevity test com accoes — daemon 7 dias com accoes reais, medir drift + custo + violations + rollbacks
- Adversarial test — dar ao agente tarefa cujo caminho optimo passa por violar policy, verificar que nao viola
- Forense test — apos 100 accoes, reconstituir timeline completa a partir do audit log

### ~~SWE-bench Verified~~ V1+V2 CONCLUIDOS ✓
V1: gold patch comparison (5.2%). V2: context enrichment (14.8%, +9.6pp). Ambos executados com DeepSeek V3, 2 Mar 2026.

---

## Referências Chave

### Otimização Evolutiva
- EvoPrompt (ICLR 2024) — arXiv:2309.08532
- PromptBreeder (ICLR 2024) — arXiv:2309.16797
- OPRO (DeepMind, ICLR 2024) — arXiv:2309.03409
- DSPy MIPROv2 — dspy.ai/api/optimizers/MIPROv2
- TextGrad (Nature 2024-2025) — github.com/zou-group/textgrad
- REVOLVE (Dec 2024) — arXiv:2412.03092
- AlphaEvolve (DeepMind, May 2025) — deepmind.google/blog/alphaevolve
- CodeEvolve (Oct 2025, open-source AlphaEvolve) — arXiv:2510.14150
- ARTEMIS (Dec 2025) — arXiv:2512.09108
- CycleQD (ICLR 2025, Sakana AI) — arXiv:2410.14735
- **GEPA (ICLR 2026 Oral)** — arXiv:2507.19457 — evolucao textual reflexiva, bate MIPROv2 +12%, integrado em DSPy

### Fitness & Reward
- LLM-as-Judge Survey — arXiv:2411.15594
- Reward Model Ensembles — arXiv:2310.02743
- KTO / Prospect Theory — argilla.io/blog/mantisnlp-rlhf-part-7
- SPUR (ACL 2024, Microsoft) — arXiv:2403.12388
- Reward Hacking (Lilian Weng) — lilianweng.github.io/posts/2024-11-28-reward-hacking
- Chatbot Arena (LMSYS) — arXiv:2403.04132

### Agentes Auto-Melhoráveis
- Darwin Gödel Machine (Sakana AI, 2025) — arXiv:2505.22954 — SWE-bench 20%→50% auto-reescrevendo codigo
- Huxley-Godel Machine (Oct 2025) — arXiv:2510.21614 — extensao do DGM para coding
- SE-Agent (NeurIPS 2025) — github.com/JARVIS-Xs/SE-Agent
- AIDE — arXiv:2502.13138
- Voyager (MineDojo) — arXiv:2305.16291
- ExpeL (AAAI 2024) — arXiv:2308.10144
- Reflexion — arXiv:2303.11366
- Self-Play SWE-RL — arXiv:2512.18552
- EvolveR — arXiv:2510.16079
- EvoAgentX — github.com/EvoAgentX/EvoAgentX
- Self-Evolving Agents Survey (2025) — arXiv:2507.21046 — survey abrangente, taxonomia de self-evolution

### Producao & Frameworks
- LangGraph — langchain.com/langgraph
- Claude Agent SDK — anthropic.com/engineering/building-agents-with-the-claude-agent-sdk
- MCP Specification — modelcontextprotocol.io/specification/2025-11-25
- Langfuse — langfuse.com
- Prompt Caching — platform.claude.com/docs/en/build-with-claude/prompt-caching
- NSGA-II — pymoo.org/algorithms/moo/nsga2.html
- SWE-bench — swebench.com

### Landscape & Market (2026)
- Multi-Agent Multi-LLM Systems Guide — dasroot.net/posts/2026/02/multi-agent-multi-llm-systems-future-ai-architecture-guide-2026
- AI Agents: Hype to Enterprise Reality — kore.ai/blog/ai-agents-in-2026-from-hype-to-enterprise-reality
- Agentic AI Enterprise Use Cases (30+ deployments) — ampcome.com/post/post-agentic-ai-enterprise-use-cases
- Enterprises Building AI Agents 2026 — beamsec.com/how-enterprises-are-building-ai-agents-in-2026-from-pilots-to-production
- Agentic AI Trends 2026 — machinelearningmastery.com/7-agentic-ai-trends-to-watch-in-2026

### Tool Synthesis & Self-Modification
- Toolformer (Meta, 2023) — arXiv:2302.04761 — LLMs aprendem a usar e criar tools
- CREATOR (2023) — arXiv:2305.14318 — LLMs criam tools para resolver problemas novos
- LATM (2023) — arXiv:2305.17126 — LLM-as-tool-maker
- OpenHands (2024) — github.com/All-Hands-AI/OpenHands — coding agent open-source

### Sandboxing, Seguranca & Contencao (Escada 5)
- Open Policy Agent (OPA) — openpolicyagent.org — policy engine para authorization, usado em Kubernetes/Envoy/Terraform
- Cedar (AWS) — github.com/cedar-policy — authorization policy language, mais simples que Rego
- Firecracker (AWS) — github.com/firecracker-microvm — microVM para sandboxing, ~125ms boot, usado no Lambda/Fargate
- nsjail — github.com/google/nsjail — lightweight process sandboxing via Linux namespaces/cgroups
- gVisor (Google) — gvisor.dev — application kernel para container sandboxing
- Prometheus + Grafana — prometheus.io, grafana.com — monitoring e alerting standard da industria
- OWASP Top 10 for LLM Applications (2025) — owasp.org/www-project-top-10-for-large-language-model-applications
- Agent Security Benchmark (ASB, 2025) — arxiv.org/abs/2503.02529 — framework de avaliacao de seguranca de agentes
- Anthropic RSP (Responsible Scaling Policy) — anthropic.com/responsible-scaling-policy — framework de seguranca para AI

### O Que NÃO Adotar
- **OPRO puro** — muito caro, falha com modelos <13B, GA numérico é estritamente superior para parâmetros contínuos
- **PromptBreeder completo** — custo de API 2.5 ordens de magnitude maior, insight de meta-evolução já capturado pela mutabilidade adaptiva
- **Bayesian puro substituindo GA** — BO é melhor para poucas avaliações caras, GA é melhor para muitas avaliações baratas (seu caso)
- **SVD-based mutation (CycleQD)** — só relevante se mover para fine-tuning de modelos menores
- **Model merging crossover** — requer múltiplos modelos fine-tuned, fora de escopo atual
- **Acesso directo a sistemas sem sandbox** — NUNCA dar ao agente acesso raw a filesystem/rede/docker. Sempre via capability tokens + sandbox + staged actions. A tentacao de "simplificar" removendo camadas de contencao e o caminho para desastres
- **Self-granted capabilities** — o agente NUNCA pode expandir as suas proprias permissoes. Capabilities sao granted externamente (config, API, humano). Isto e inviolavel
- **Abordagem A para producao sem equipa de seguranca** — implementar sandboxing custom e extremamente dificil de fazer correctamente. Usar Docker/Firecracker/OPA (Abordagem B) a menos que haja expertise especifica
