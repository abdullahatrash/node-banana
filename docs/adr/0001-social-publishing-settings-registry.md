# Use a Publishing Settings Registry for Social Compose

Node Banana will model Postiz-style per-platform publishing options with a typed Publishing Settings Registry instead of copying Postiz's React `withProvider` wrapper. The registry keeps each platform's defaults, validation, normalization, and settings UI behind one contract while fitting Node Banana's existing Zustand composer state and per-channel `platformSettings` model. This preserves Postiz's useful provider-specific behavior without importing its larger form/ref/HOC architecture.
