# External Agents Default to Review, With Opt-In Per-Channel Autonomy

Content submitted by an **External Agent** through the **Agent Interface** lands as a draft **Post** in the Kanban `review` state by default; a human approves before it schedules or publishes. An **External Agent** may bypass human review only when its stable **Agent Principal** has an applicable versioned **Auto-publish Grant** for the exact **Channel**, action, and safety limits. Policy allowance creates the same durable **Publishing Approval** and uses the same release path as human approval; server-side **Publish Validation** and the **Workspace** scheduled-volume cap still apply. We chose this over letting agents publish freely (brand/abuse/prompt-injection risk shipped under the customer's name becomes our product's liability) and over mandatory always-review (which makes "an agency that markets for you" a lie and reduces the hub to an inbox).

## Consequences

- Agent grants must carry explicit per-**Channel** resource constraints rather than a single all-or-nothing permission.
- Rotatable **Agent Keys** authenticate and may attenuate an Agent Principal; autonomy policy belongs to the stable Principal, not the bearer credential.
- Autonomy becomes a pricing axis: review-only on lower tiers, graduated **Auto-publish Grants** on higher tiers.
- The Kanban review board stays the product's center of gravity (the retained moat from [0009](0009-agent-native-publishing-byo-agent.md)) even as autonomy grows.
