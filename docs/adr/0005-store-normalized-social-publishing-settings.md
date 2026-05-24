# Store Normalized Social Publishing Settings

Node Banana will store Publishing Settings in normalized, provider-stable JSON rather than raw UI form values. This keeps the social post model testable and migration-friendly, avoids persisting widget-specific shapes such as `{ label, value }` arrays, and lets provider publish code consume stable values. The UI may use convenient local shapes, but create/update and publish paths should normalize defensively.
