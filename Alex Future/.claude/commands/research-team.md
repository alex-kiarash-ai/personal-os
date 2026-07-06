# /research-team - Adaptive Multi-Agent Research

Spec: work/04-research-team/CLAUDE.md (read it first; it defines the full runtime flow).

Usage: `/research-team {question or topic}`. If no question given, ask for one - don't invent a topic.

## Steps (condensed; spec is authoritative)
1. Classify the question; check work/04-research-team/patterns/index.md for a reusable team.
2. Check vault/research/ and notion-search first - partial answers may exist; don't re-buy them.
3. Design the team (2-5 sub-agents, parallel where independent) or adapt the matched pattern.
4. AskUserQuestion: approve / modify / answer-without-team. NO sub-agents before approval.
5. Execute, synthesize in Alex voice. Unknown stays unknown; cite sources.
6. Write vault/research/{topic-slug}.md + Notion page "Research: {topic}" under the Personal OS parent.
7. Save/refresh the pattern in patterns/ + index.md.
8. AskUserQuestion: "Claude Design deck or PDF?" → **Deck = Claude Design (DesignSync)** on claude.ai/design (slides as components, finalize_plan → write_files, branded from brand config), export PDF; OR PDF = reportlab with brand config. NOT /pptx (standing rule 2026-06-15). Output the PDF (+ note the claude.ai/design link) to outputs/research-team/YYYY-MM-DD/. Delete build scripts and temp artifacts after.

## Post-Run
- New people → vault/people/, new companies → vault/business/, with [[wiki links]].
- vault/projects/research-team/status.md (last run, topic, output path).
- vault/log.md: `## [YYYY-MM-DD HH:MM] research-team | {topic}, {n} agents, {deliverable}`.
- vault/index.md for the new research page.
