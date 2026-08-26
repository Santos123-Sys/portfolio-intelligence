# Platform comparison — base44 / Replit / Vercel / Manus / Kimi

**Researched:** August 2026. This space moves fast; re-verify pricing and limits before committing spend.

**Framing caveat:** these five are not one category. base44, Manus, and Kimi are "describe it, AI builds and hosts it in *their* stack." Replit is a general-purpose cloud dev environment — bring any code. Vercel is deployment/hosting plus an AI toolkit (v0 is Vercel's actual prompt-to-UI product). Treating them as five substitutable options overstates how interchangeable they are.

---

## Summary matrix

| | base44 | Replit | Vercel | Manus | Kimi |
|---|---|---|---|---|---|
| What it is | Prompt→full app (TS/Deno) | General cloud dev env | Deploy/host + AI SDK | Autonomous task agent | LLM + agent mode |
| Free tier | Yes, thin (25 msg/mo) | Yes, public apps only | Yes, generous compute | Disputed | Chat free; agent limited |
| Private on free? | No | No | N/A (ToS bars commercial) | N/A | N/A |
| SOC 2 / ISO 27001 | Yes / Yes | Yes / — | Yes / Yes | Claimed, unverified | None found |
| **Python backend?** | **No — TS only** | **Yes, native** | Beta (TS-first) | Sandbox only | No hosting product |
| Long LLM pipelines | Superagents (TS) | Yes — Scheduled, 11h | Emerging (Workflow SDK) | Is one, for own tasks | Is one, for own tasks |
| **Your own agent code?** | Rewrite required | **Runs as-is** | Rewrite in TS | No | No |
| Known incident | Critical auth bypass 2025 | 2025 DB incident (fixed) | App-boundary, not platform | Prompt-injection chain | Structural legal exposure |

---

## 1. Security

**base44** — SOC 2 Type II and ISO 27001 certified, TLS 1.2+ in transit, AES-256 at rest, app-level protection via Row Level Security policies. In July 2025, Wiz Research disclosed a critical flaw: attackers could access private applications knowing only a publicly visible `app_id`, submitted to undocumented registration endpoints, bypassing all authentication including SSO. The `app_id` was hardcoded in each app's URL and `manifest.json`. Wix patched within 24 hours with no evidence of exploitation. The concern is the *class* of failure — a fundamental design oversight, not an exotic edge case.

**Replit** — SOC 2 Type II certified August 2025 after a 12-month audit with zero exceptions. Runs on GCP with each customer in an isolated GCP project. Secrets encrypted AES-256, separate from source. Main exposure: free-tier Repls are public, exposing all source and commit history.

**Vercel** — deepest compliance stack of the five: SOC 2 Type 2 (Security, Confidentiality, Availability), ISO 27001, TISAX, PCI DSS support, HIPAA for enterprise. Independent review finding worth heeding: essentially every breach triaged on Vercel deployments traced to the boundary Vercel doesn't control — env var scoping, leaked preview URLs, functions trusting their own request headers. Strong platform; risk relocates to your code.

**Manus** — claims SOC 2 Type II and ISO 27001. Each task runs in an isolated Firecracker microVM; uploaded files auto-delete after 48 hours. Independent research (SilentBridge) demonstrated real prompt-injection exploit chains: Gmail exfiltration via a connected email tool, API key extraction from the agent container, and a root-level reverse shell — all triggered by web content the agent treated as instructions, with nothing malicious typed by the user.

**Ownership is unresolved.** Meta announced a ~$2B acquisition in December 2025. China's NDRC ordered the deal blocked and unwound on 27 April 2026 following an investigation opened in January. Manus's own site still read "now part of Meta" while Meta indicated it would comply. Which entity controls Manus, under which jurisdiction, is genuinely unsettled.

**Kimi** — the clearest structural (not incidental) risk. Moonshot AI is Beijing-founded; consumer terms name a Singapore entity as controller of record while engineering and infrastructure remain Chinese. Article 7 of China's National Intelligence Law compels organizations to support state intelligence work, and no privacy policy overrides it. Moonshot's consumer policy permits prompts and uploads to be used for model training with no documented in-product opt-out, and does not name a storage jurisdiction. No Business Associate Agreement is offered, unlike OpenAI, Anthropic, Google, AWS Bedrock, and Azure OpenAI on enterprise tiers.

---

## 2. Free tiers

| Platform | Free tier reality |
|---|---|
| **base44** | Permanent but thin: 5 message credits/day, 25/month, 100 integration credits, max 5 apps. Evaluation only. |
| **Replit** | Exists, but forces **public** Repls. The blocker is visibility, not compute. Core (~$20/mo annual) is a hard floor for private work. |
| **Vercel** | Most usable compute of the five: 100 GB transfer, 1M function invocations, 6,000 build minutes, 4 CPU-hours/month. Catch is legal, not technical — Hobby is restricted to personal, non-commercial use by ToS. |
| **Manus** | **Unclear.** Pricing page lists only $20/$40/$200 tiers with no free column; Manus's own docs still describe a Free Plan. Its two pages disagree. Verify against your account. |
| **Kimi** | Chat free with caps. OK Computer agent mode offered 3 free trial attempts in beta, paid tiers in RMB after. No ongoing free app-hosting tier found. |

---

## 3. Hosting & deployment

**base44** — one-command deploy, CDN hosting, custom domains, automatic HTTPS. Server-side code runs as **TypeScript functions on Deno**. Frontend code is exportable; backend functions, auth, and database remain tied to base44's proprietary infrastructure. Migrating fully off-platform requires substantial rewriting.

**Replit** — four deployment types (Autoscale, Reserved VM, Scheduled, Static), Python-native, no rewrite. See `replit-deployment-architecture.md`.

**Vercel** — serverless-first with historically short function durations, but real long-running infrastructure now exists: durable functions auto-provisioned for multi-step agent loops and pipelines spanning minutes to days. The catch for a Python project: the Workflow SDK proved out in TypeScript first; the Workflow Python SDK is in beta.

**Manus** — hosts what it generates. Code is downloadable, but backend functionality built on Manus's integrated services must be recreated elsewhere. Generate-then-migrate, not bring-your-own-repo.

**Kimi** — no persistent backend/database hosting product found. OK Computer produces standalone outputs (sites, decks, spreadsheet analyses), not an ongoing hosted service.

---

## 4. Multi-agent systems

This is where the comparison collapses to a simple answer.

- **base44** — Superagents (persistent background agents, added 2026) are base44's own primitive on Deno. A CrewAI cluster architecture doesn't port; it gets rebuilt in their framework.
- **Replit** — no special multi-agent product, and none needed. `pip install crewai` works exactly as anywhere else. **The only one of the five where "multi-agent" means your own code runs unmodified.**
- **Vercel** — AI SDK provides the primitives (tool calling, streaming, durable execution), but native multi-agent orchestration is not built in; developers bolt on third-party libraries. Buildable, as a TypeScript rewrite.
- **Manus / Kimi** — both are internally multi-agent (a planner coordinating sub-agents) in service of *your prompted task*. Kimi's K2.5 Agent Swarm can direct up to 100 sub-agents. Impressive, and still producing one generated output rather than hosting a persistent agent graph you author and control.

---

## Conclusion for this project

Agenteki is Python. The quant engine depends on QuantStats and Riskfolio-Lib, which have no real TypeScript equivalent.

**Replit is the only one of the five that runs the actual system without a rewrite.** base44 (Deno/TS) and Vercel (TS-first) both force a language migration that means rebuilding the calculation layer. Manus and Kimi don't host arbitrary long-running code at all.

**Security ranking for this use case** — personal financial data, proprietary thesis logic:

1. **Vercel / Replit** (tied) — both SOC 2, both carrying the "your app code is the real risk surface" caveat
2. **base44** — strong program, one real disclosed incident of a concerning class
3. **Manus / Kimi** — last, not primarily on technical grounds but on unresolved ownership and legal-jurisdiction exposure, which sits outside anything a security team can patch

This reinforces rather than changes ADR-008.

**Where v0 fits:** using v0 to generate the dashboard while Python stays on Replit is a coherent split — it uses Vercel for the one thing it's genuinely best at without migrating the backend. See `V0-DASHBOARD-BRIEF.md` and the Next.js static-export constraint documented there.
