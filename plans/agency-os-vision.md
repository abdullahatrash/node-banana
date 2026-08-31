# Marketing Agency OS — north star

Date: 2026-06-23
Status: north star (supersedes the narrow "publishing" framing of `agent-native-publishing-vision.md`, which is now just the Launch stage)

> **Thesis:** The product is a **personal AI marketing agency** that runs the full agency
> lifecycle — `brief → strategy → creative → approval → production → launch → reporting → repeat` —
> where the user's own AI agents are the **brain at every stage** and the product is the
> **operating system**: the stages, the artifacts, the approval gates, the durable infra.
>
> **North star:** the founder uses it on their *own* products first. Acquiring other users is
> secondary. This defers pricing, metering, multi-tenant, and MCP-for-strangers.

## Two halves — both already built

- **flowleap content factory** (`/Users/neoak/projects/flowleap-migration/tanstack-start`) = the
  headless **Content Engine**. Git-native, agent-driven (sandcastle), with a *mechanical-first
  quality oracle* (citation resolution, claim anchoring, naked-number linter). **Live** for GEO
  answer pages (66 pages indexed); social factory scaffolded (north-star + 500-hook library +
  writer/verifier prompts, runners pending). Covers `brief → strategy → creative → verify → approval`.
- **node-banana** = the visual **Cockpit**. Visual creative (canvas, image/video/text gen),
  multi-platform launch (11 social Provider Adapters + scheduling), analytics/reporting, and the
  human UI/auth/DB. Covers the stages that need *eyes*.

They are not competitors. They are two halves of one agency.

## Composition (ADR 0012)

**node-banana = cockpit, flowleap = engine.** node-banana is where the human sees the lifecycle,
does visual creative, approves at gates, launches to channels, and reads reporting. flowleap runs
the headless content loop and feeds artifacts in via a **contract** (the Post-pack / answer-page
artifact), not a shared database. The BYO-agent boundary (ADR 0009) holds: agents run on the
user's side; the product is the circuit + state + gates.

## AI-native discovery (GEO) is first-class

Discovery now means **being cited / recommended by LLMs** (ChatGPT, Claude, Perplexity, Gemini),
not only human SEO/social — the model [Prompting Company](https://promptingcompany.com/) raised
$6.5M for. flowleap's answer-page factory *already does GEO production* (the same loop, applied to
patents/IP). The missing edge is **measurement**: are we actually getting cited, vs competitors,
over time? **Citation frequency / share-of-voice is the north-star reporting metric.**

## Lifecycle → where each stage lives

| Stage | Engine (flowleap) | Cockpit (node-banana) |
|---|---|---|
| Brief | issue / north-star | (later: a brief UI) |
| Strategy (incl. GEO question-mapping) | tier / hook / north-star | — |
| Creative — text | writer agent | — |
| Creative — visual (image/video) | — | ✅ canvas + gen |
| Approval | oracle + verifier + human gate | review board |
| Production | writer + verifier | composer |
| Launch | GEO index-flip | ✅ social publish + scheduling |
| Reporting | Search Console | ✅ analytics + **GEO citation tracking (first build)** |

## First focus: GEO reporting / citation tracking (in the Cockpit)

The GEO content already exists and is live, so the highest-leverage first build is the **feedback
edge**: probe LLMs with category questions, detect whether our domain is mentioned/cited, score
share-of-voice vs competitors, track over time, surface in the node-banana cockpit. This tells us
whether the agency actually *works* before we wire the rest of the seam.

## Shelved, not deleted

- Publishing ingest slices (#95–#99) = the **Launch stage** implementation. Resume when the spine
  reaches launch.
- Pricing, metering, multi-tenant, MCP-for-strangers, the Agency Recipe = deferred (self-use first).
