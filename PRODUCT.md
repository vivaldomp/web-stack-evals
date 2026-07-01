# Web Stack Benchmark Platform

# Product Vision

## Overview

The Web Stack Benchmark Platform is an automated evaluation platform for AI agents focused on Front-end development.

Its goal is to produce **reproducible, comparable, and measurable** assessments of different language models' capabilities to build complete web applications from a standardized set of assets.

The platform executes agents using the Pi SDK, monitors the entire execution, builds the application in an isolated environment, renders the result using Headless Playwright, and automatically calculates quality, cost, speed, and visual fidelity metrics.

The product eliminates subjective evaluations and allows for the objective comparison of:

* LLM models
* Prompts
* Skills
* MCP servers
* Templates
* Web stacks
* Engineering strategies (Loop Engineering, Spec-Driven Development, etc.)

---

# Problem

Today, there is no consistent way to answer questions such as:

* Which model produces Angular applications the fastest?
* How much does it cost to generate a React application?
* How many self-correction cycles does each model perform?
* Which Prompt + Skill combination produces the best results?
* Which stack is easiest for an agent to implement?
* Does the visual output actually match the expected mockup?

Each evaluation is typically performed manually, lacking repeatability, consistent metrics, and heavily influenced by human bias.

---

# Objectives

The platform must enable:

* Fully automated execution
* Reproducible benchmarks
* Isolation between runs
* Model comparison
* Stack comparison
* Prompt comparison
* Skill comparison
* MCP comparison
* Detailed metric capturing
* Comparative report generation

---

# Non-Objectives

The product does not intend to:

* Replace IDEs
* Manually edit code
* Serve as a development framework
* Act as an IDE for agents
* Deploy to production

Its focus is exclusively on benchmarking and evaluation.

# Conceptual Architecture

I would separate this into five completely independent domains:

```
                  +----------------------+
                  | CLI / API / CI       |
                  +----------+-----------+
                             |
                             v
                 +------------------------+
                 | Evaluation Orchestrator|
                 +-----------+------------+
                             |
      +----------------------+----------------------+
      |                      |                      |
      v                      v                      v
 Agent Runtime         Workspace Runtime      Evaluation Runtime
 (Pi SDK)              (Sandbox)             (Visual/Judges)
      |                      |                      |
      +-----------+----------+-----------+----------+
                  |                      |
                  v                      v
          Metrics Pipeline        Artifact Store

```

This division allows any component to be swapped out without altering the others.

---

# Proposed Structure

```
web-stack-evals/

├── package.json
├── pi.config.ts
├── bench.config.ts
├── tsconfig.json

├── assets/
│
│   ├── prompts/
│   │      base.md
│   │      repair.md
│   │
│   ├── images/
│   │      dashboard.png
│   │      login.png
│   │
│   ├── skills/
│   │      angular/
│   │      react/
│   │      vue/
│   │
│   ├── mcp/
│   │      filesystem.json
│   │      playwright.json
│   │      angular.json
│   │
│   └── datasets/
│          dashboard.yaml
│          login.yaml
│
├── stacks/
│
│   ├── angular/
│   │      stack.yaml
│   │      template/
│   │
│   ├── react/
│   ├── vue/
│   ├── svelte/
│   └── htmx/
│
├── models/
│
│   └── deepseek4pro.json
│
├── evals/
│
│   ├── visual/
│   │      pixelmatch.ts
│   │      screenshot.ts
│   │
│   ├── structural/
│   │      dom.ts
│   │
│   ├── llm/
│   │      judge.ts
│   │
│   └── metrics/
│          scorer.ts
│
├── src/
│
│   ├── orchestrator/
│   │      benchmark.ts
│   │      scheduler.ts
│   │      matrix.ts
│   │
│   ├── agent/
│   │      pi-session.ts
│   │      resource-loader.ts
│   │      prompt-builder.ts
│   │
│   ├── sandbox/
│   │      workspace.ts
│   │      lifecycle.ts
│   │
│   ├── runtime/
│   │      npm.ts
│   │      docker.ts
│   │      playwright.ts
│   │
│   ├── telemetry/
│   │      collector.ts
│   │      events.ts
│   │      metrics.ts
│   │
│   ├── storage/
│   │      sqlite.ts
│   │      filesystem.ts
│   │
│   ├── reports/
│   │      html.ts
│   │      markdown.ts
│   │      csv.ts
│   │
│   └── cli/
│          run.ts
│          report.ts
│          compare.ts
│
└── results/

```

---

# The Role of Each Module

## 1. Agent Runtime

This module completely encapsulates the Pi SDK.

It knows how to:

* Start sessions
* Load MCPs
* Load Skills
* Load prompts
* Send images
* Swap models

The rest of the system never interacts directly with the Pi SDK.

```
Benchmark
      │
      ▼

AgentRuntime

      │

Pi SDK

```

This makes it easy to replace DeepSeek with another model in the future.

---

# 2. Workspace Runtime

Exclusively responsible for the temporary environment.

Each execution generates something similar to:

```
tmp/

   run-001/

        angular/

        logs/

        screenshots/

        artifacts/

```

Nothing from the benchmark is executed inside the main project.

Everything happens within a disposable sandbox.

---

# 3. Application Runtime

After the agent finishes its work:

```
npm install

↓

npm run build

↓

npm start

↓

Playwright

↓

Screenshot

```

This runtime can also validate:

* Build success
* Linting
* Testing
* Coverage

This provides you with extra metrics.

---

# 4. Evaluation Runtime

I wouldn't limit the evaluation to just PixelMatch.

I would build an evaluator pipeline.

```
Screenshot

     │

     ▼

PixelMatch

     │

DOM Diff

     │

Accessibility

     │

LLM Judge

     │

Final Score

```

This keeps the benchmark extensible.

---

# PixelMatch

Compares pixels.

```
Visual Similarity

95.3%

```

---

# DOM Diff

Compares structure.

Example:

```
Does the button exist?

Does the sidebar exist?

Do the cards exist?

Is the heading correct?

```

Because two screens might look similar but have entirely different HTML structures.

---

# Accessibility Eval

Would automatically run:

* axe-core
* Lighthouse
* WCAG

This way, you can also measure quality.

---

# LLM Judge

Highly useful for complex components.

Prompt:

```
Compare:

Expected Screenshot

Generated Screenshot

Return:

Layout

Spacing

Typography

Missing Components

Extra Components

Final Score

```

This score can complement PixelMatch.

---

# Metrics Pipeline

Completely decoupled from the execution.

All information is converted into events.

```
SessionStarted

↓

PromptSent

↓

ToolExecuted

↓

FileWritten

↓

BuildStarted

↓

BuildFinished

↓

ScreenshotTaken

↓

PixelMatchCompleted

↓

BenchmarkFinished

```

These events feed into a collector.

---

# Captured Metrics

## Performance

* Wall time
* Build time
* Startup time
* Render time

---

## LLM

* Input tokens
* Output tokens
* Cache read
* Cache write
* Estimated cost
* TTFT (Time to First Token)

---

## Engineering

* Files created
* Files edited
* Lines generated
* Lines removed

---

## Agent

A metric I consider extremely interesting:

```
Iteration Count

```

Example:

```
Turn 1

↓

Build Failed

↓

Turn 2

↓

Build Failed

↓

Turn 3

↓

Success

```

This measures the self-correction capability.

Another one:

```
Correction Density

corrections / generated files

```

---

## Tools

I would also log:

```
Tool Calls

read

write

edit

bash

grep

find

mcp

```

---

# Results Database

Instead of just JSON files, I would use SQLite.

Example:

```
runs

stacks

artifacts

events

metrics

screenshots

tool_calls

iterations

```

This allows for queries like:

```
Which stack had the lowest cost?

Which stack required the fewest corrections?

Which model generated the most files?

Which template converged the fastest?

```

Without needing to re-process JSON files.

---

# Declarative Model for Stacks

Instead of hardcoding the stacks, I would use a declarative specification.

Example:

```yaml
name: angular20

template: ./template

commands:

  install: npm install

  build: npm run build

  start: npm run dev

port: 4200

viewport:

  width: 1440

  height: 900

```

The benchmark simply interprets this.

---

# Declarative Model for Scenarios

I would also make the scenarios independent of the stacks.

```yaml
id: dashboard

prompt: prompts/dashboard.md

expected:

  screenshot: dashboard.png

viewport:

  width: 1440

height: 900

skills:

- angular

- ui

mcps:

- filesystem

- playwright

```

This way:

```
1 scenario

×

8 stacks

×

3 models

×

5 repetitions

```

automatically generates the entire benchmark matrix.

---

# Complete Flow

```text
                 Benchmark Matrix
                        │
                        ▼
            Create Temporary Workspace
                        │
                        ▼
          Initialize Pi SDK Session
                        │
                        ▼
      Inject Prompt + Skills + MCP + Image
                        │
                        ▼
       Agent generates & fixes the project
                        │
                        ▼
     Collect events, tokens, and telemetry
                        │
                        ▼
       Build + Execute generated application
                        │
                        ▼
    Capture Screenshot with Headless Playwright
                        │
                        ▼
               Evaluation Pipeline
      (PixelMatch → DOM → A11y → LLM Judge)
                        │
                        ▼
     Metrics aggregation & composite score
                        │
                        ▼
      Persistence in SQLite + Artifacts
                        │
                        ▼
       Dashboard & report generation

```

## Conclusion

With this architecture, the platform moves beyond being just a benchmark for DeepSeek 4 Pro and becomes a **reproducible evaluation framework for software engineering agents**. The exact same infrastructure can be used to compare different models, prompt versions, Skill sets, MCP servers, project templates, and even engineering strategies (such as Loop Engineering or Spec-Driven Development)—simply by altering the execution matrix, without modifying the platform's core code. This makes the project highly scalable for scientific experimentation and continuous integration (CI/CD), enabling historical analysis, performance regression tracking, and objective comparison across various AI-assisted development approaches.