# ContentOS

## Product Requirements Document & Technical Architecture

**The All-in-One Marketing Platform for SMBs**

**Version 1.0 | February 2026**
**CONFIDENTIAL**

---

## 1. Executive Summary

ContentOS is an all-in-one marketing platform designed for small and medium businesses with small or non-existent marketing teams. It combines four integrated pillars into a single workspace, replacing the need for 4-5 separate tools and effectively serving as the marketing team these businesses can't afford to hire.

### 1.1 The Four Pillars

| Pillar | Core Value | MVP Priority | Comparable Products |
|--------|-----------|--------------|---------------------|
| AI Content Studio | Generate professional images, videos, and copy with AI | P0 (Lead Differentiator) | PhotoAI, Canva AI, Opus Clip |
| Social Media Hub | Connect accounts, schedule, adapt posts per platform | P0 (Distribution Engine) | Buffer, Hootsuite, Post-Bridge |
| Analytics & Intelligence | Track your performance + competitor intelligence | P1 (Growth Loop) | ViewStats, SocialBlade, Sprout Social |
| Canvas Workspace | Infinite canvas with AI cards, notes, and embeds | P2 (Sticky Layer) | Eden.so, Notion, Miro |

### 1.2 Target Users

- **Primary:** Solo founders, small business owners (1-20 employees) handling their own marketing
- **Secondary:** Freelance marketers managing multiple SMB clients
- **Tertiary:** Small marketing teams (1-3 people) at growing startups

### 1.3 Core Value Proposition

One subscription replaces Buffer ($60/mo) + Canva Pro ($13/mo) + SocialBlade Pro ($40/mo) + Notion ($10/mo) + PhotoAI ($29/mo). ContentOS delivers all of this for a fraction of the combined cost, with the added benefit of tight integration between content creation, publishing, analytics, and planning.

---

## 2. Feature Breakdown by Pillar

### 2.1 Pillar 1: AI Content Studio (Lead Differentiator)

The AI Content Studio is the primary hook. SMB owners describe their brand, and AI generates platform-ready content. This pillar directly feeds into the Social Media Hub for scheduling and publishing.

#### 2.1.1 MVP Features

**AI Image Generation**

- **Brand Kit Setup:** Upload logo, brand colors, fonts, and tone of voice during onboarding
- **Template Library:** Pre-built templates for common SMB needs (product showcase, testimonial, promotion, announcement, behind-the-scenes)
- **Prompt-to-Image:** Natural language input generates on-brand social media images
- **Multi-Format Output:** Auto-generate in all required aspect ratios (1:1 Instagram, 9:16 Stories/Reels, 16:9 YouTube thumbnail, 4:5 Facebook)
- **Text Overlay Engine:** AI places text on generated images with proper typography and readability

**AI Video Generation (Basic)**

- **Image-to-Video:** Animate static images with subtle motion (ken burns, parallax, zoom)
- **Text-to-Short-Video:** Generate 15-60 second clips from script input with stock footage + text overlays
- **Auto-Captions:** AI-generated captions with customizable styling
- **Platform Presets:** Export optimized for TikTok, Reels, Shorts, or Stories

**AI Copywriting**

- **Post Copy Generator:** Generate captions, hooks, CTAs adapted per platform voice (professional for LinkedIn, casual for Twitter, hashtag-rich for Instagram)
- **Content Repurposer:** Input one piece of content (blog post, podcast transcript), output 10+ platform-specific posts
- **Hashtag Engine:** AI-suggested hashtags based on content, trend data, and niche

#### 2.1.2 Post-MVP Features

- AI Avatar/Spokesperson videos (talking head from text)
- Brand voice fine-tuning with training on past content
- AI-powered A/B variant generation
- Batch content generation (30 days of content in one session)
- Product photo enhancement and background replacement

#### 2.1.3 Technical Implementation

| Feature | AI Provider | Fallback | Estimated Cost/Generation |
|---------|------------|----------|---------------------------|
| Image Generation | Replicate (FLUX/SDXL) | OpenAI DALL-E 3 | $0.01-0.05 |
| Video Generation | Replicate (Stable Video) | RunwayML API | $0.10-0.50 |
| Captions/Subtitles | Whisper (self-hosted) | Deepgram API | $0.002/min |
| Copywriting | Claude Sonnet 4 via API | GPT-4o Mini | $0.003-0.01 |
| Text Overlay | Sharp + Canvas (server) | Cloudinary | $0.001 |

---

### 2.2 Pillar 2: Social Media Hub (Distribution Engine)

The Social Media Hub is the distribution layer that makes the AI Content Studio valuable. Content created in the Studio flows directly into scheduling, adaptation, and publishing across all connected platforms.

#### 2.2.1 MVP Features

**Account Connection & Management**

- **Supported Platforms (MVP):** Instagram (Business/Creator), Facebook (Pages), Twitter/X, LinkedIn (Personal + Company), TikTok (Business), YouTube
- **OAuth Integration:** One-click connect via official APIs
- **Multi-Account Support:** Connect multiple accounts per platform
- **Connection Health Monitor:** Visual status of each connection with re-auth prompts

**Content Scheduling & Publishing**

- **Visual Calendar:** Monthly/weekly/daily calendar view with drag-and-drop rescheduling
- **Smart Queue:** AI-suggested optimal posting times based on audience activity data
- **Platform Adaptation:** Single post auto-adapted for each platform (character limits, hashtag strategy, media format, link placement)
- **Preview Mode:** Pixel-perfect preview of how posts will appear on each platform before publishing
- **Draft System:** Save work-in-progress posts with versioning

**Basic Web Video Editor**

- **Timeline Editor:** Simple timeline-based editor for trimming, splitting, and reordering clips
- **Text Overlays:** Add animated text with templates (lower thirds, titles, captions)
- **Audio:** Add background music from royalty-free library, adjust volume levels
- **Export Presets:** One-click export optimized for each platform

#### 2.2.2 Post-MVP Features

- Instagram carousel builder with swipe-through preview
- First comment scheduling (for link-in-bio strategies)
- Team approval workflows
- Bulk scheduling via CSV upload
- Pinterest, Threads, and Bluesky support
- Advanced video editor with transitions, filters, and green screen

#### 2.2.3 Platform API Strategy

| Platform | API | Capabilities | Rate Limits |
|----------|-----|-------------|-------------|
| Instagram | Meta Graph API | Post images/videos/carousels, Stories, scheduling | 200 calls/user/hour |
| Facebook | Meta Graph API | Post to Pages, schedule, Reels | 200 calls/user/hour |
| Twitter/X | X API v2 (Basic) | Post tweets, threads, media upload | 1,500 tweets/month (Basic) |
| LinkedIn | LinkedIn Marketing API | Share posts, articles, company updates | 100 calls/day |
| TikTok | TikTok Content Posting API | Upload videos, set privacy, manage content | Subject to approval |
| YouTube | YouTube Data API v3 | Upload videos, set thumbnails, manage playlists | 10,000 units/day |

---

### 2.3 Pillar 3: Analytics & Competitor Intelligence

Analytics transforms ContentOS from a publishing tool into a growth engine. Users see what works, what competitors are doing differently, and receive AI-powered recommendations for improvement.

#### 2.3.1 MVP Features

**Your Performance Dashboard**

- **Unified Metrics:** Followers, engagement rate, impressions, reach, clicks across all platforms in one view
- **Post Performance:** Individual post analytics with engagement breakdown
- **Best Performing Content:** Auto-identify top posts by engagement, reach, and conversions
- **Growth Tracking:** Follower growth over time with trendlines
- **Time-Based Analysis:** Engagement heatmaps showing best days/times to post

**Competitor Intelligence**

- **Competitor Profiles:** Add up to 10 competitor accounts to track
- **Public Metrics Tracking:** Monitor competitor follower growth, posting frequency, engagement rates (public data only)
- **Content Strategy Analysis:** AI-analyzed patterns in competitor content (posting times, content types, hashtag strategies, trending topics)
- **Gap Analysis:** AI identifies topics and content types competitors are covering that you are not

**AI Insights**

- **Weekly Digest:** AI-generated summary of performance with actionable recommendations
- **Content Scoring:** Pre-publish AI score predicting engagement potential based on historical data
- **Trend Alerts:** Notifications when competitors launch successful campaigns or when niche trends emerge

#### 2.3.2 Post-MVP Features

- Sentiment analysis on comments and mentions
- ROI tracking with UTM parameter management
- Custom report builder with PDF/CSV export
- Industry benchmark comparisons
- Audience demographics and overlap analysis

#### 2.3.3 Data Collection Strategy

| Data Type | Source | Method | Update Frequency |
|-----------|--------|--------|-----------------|
| Own account metrics | Platform APIs (authenticated) | Direct API calls with user tokens | Every 6 hours |
| Competitor public metrics | Platform APIs (public) | Public API endpoints + scraping fallback | Daily |
| Trend data | Platform APIs + web scraping | Hashtag tracking, trending topics APIs | Every 2 hours |
| Content analysis | Internal AI pipeline | Claude/GPT analysis of post content | On competitor data refresh |

---

### 2.4 Pillar 4: Canvas Workspace (Sticky Layer)

The Canvas is the strategic thinking layer. It is where SMB owners plan campaigns, brainstorm content ideas, and keep all their marketing context in one place. The infinite canvas with AI cards makes it a unique planning tool that no competitor offers alongside publishing and analytics.

#### 2.4.1 MVP Features

**Infinite Canvas**

- **Freeform Layout:** Place cards anywhere on an infinite 2D canvas with no hierarchy enforced
- **Multiple Grids:** Create separate grids for different contexts (Campaign Planning, Content Ideas, Competitor Research, Brand Assets)
- **Grid Navigation:** Quick-jump between grids, search across all grids
- **Zoom and Pan:** Smooth zoom from bird's-eye overview to card-level detail

**Card Types**

- **Text Cards:** Rich text with markdown support, resizable
- **AI Cards:** Embedded AI chat (Claude, GPT, Gemini) that outputs directly onto the canvas
- **Checklist Cards:** Task lists with due dates and completion tracking
- **Image Cards:** Drag-and-drop images, screenshots, mood boards
- **Web Embed Cards:** Embed any URL (competitor posts, reference sites, analytics dashboards)
- **Link Cards:** Bookmarks with auto-generated previews

**Connections & Organization**

- **Card Linking:** Draw connections between related cards
- **Color Coding:** Label cards by category, status, or priority
- **Templates:** Pre-built canvas templates (Content Calendar Planning, Campaign Brief, Competitor Audit, Brand Guidelines)

#### 2.4.2 Post-MVP Features

- Real-time collaboration (multiplayer canvas)
- Canvas-to-Calendar: automatically convert planned content cards into scheduled posts
- AI canvas analysis: AI reviews your entire canvas and suggests optimizations
- Voice-to-card: dictate ideas that become cards
- Version history and canvas snapshots

---

## 3. Technical Architecture

### 3.1 High-Level System Architecture

ContentOS follows a modular monolith architecture, starting as a single Next.js application with clearly separated domains that can be extracted into microservices as the platform scales. This approach optimizes for development speed at MVP stage while maintaining clean boundaries for future scaling.

#### 3.1.1 Architecture Principles

- **Modular Monolith First:** Single deployable unit with domain-separated modules. Extract to microservices only when scaling demands it.
- **API-First Design:** Every feature is built as an API endpoint first, enabling future mobile apps, integrations, and white-label products.
- **Event-Driven Processing:** Background jobs for AI generation, scheduling, analytics collection via message queues.
- **Multi-Tenant by Default:** Data isolation at the database level from day one to support future team/agency features.

### 3.2 Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Frontend | Next.js 15 (App Router) + React 19 | Server Components, streaming, your existing expertise |
| UI Components | shadcn/ui + Tailwind CSS v4 | Accessible, customizable, fast iteration |
| State Management | Zustand + TanStack Query v5 | Lightweight global state + server state caching |
| AI Integration | Vercel AI SDK v5 | Unified streaming, multi-provider, tool use with inputSchema |
| Canvas Engine | tldraw or ReactFlow | Battle-tested infinite canvas with extensible node system |
| Video Editor | Remotion (React-based) | Programmatic video with React components, server-side rendering |
| Backend API | Next.js Route Handlers + tRPC | Type-safe API layer, zero config, co-located with frontend |
| Database | PostgreSQL (Supabase or Neon) | Relational data, JSONB for flexible schemas, real-time subscriptions |
| ORM | Drizzle ORM | Type-safe, lightweight, excellent DX with Postgres |
| Auth | Better Auth or Clerk | Social login, multi-tenant, API keys |
| File Storage | Cloudflare R2 or AWS S3 | Cost-effective media storage with CDN |
| Job Queue | Inngest or Trigger.dev | Serverless background jobs, scheduled tasks, retries |
| Caching | Upstash Redis | Rate limiting, session cache, real-time data |
| Search | Meilisearch (self-hosted) or Typesense | Fast search across posts, analytics, and canvas cards |
| Deployment | Vercel (frontend) + Railway/Fly.io (workers) | Edge-optimized frontend, dedicated compute for AI/video |
| Monitoring | Sentry + PostHog | Error tracking + product analytics + feature flags |

### 3.3 System Architecture Diagram

The system is organized into four domain modules that communicate through a shared event bus and database layer:

**Client Layer**

- Next.js App Router (Server Components + Client Components)
- tldraw Canvas Engine (Canvas Workspace)
- Remotion Player (Video Editor in-browser preview)

**API Layer** (Next.js Route Handlers + tRPC)

- `/api/studio/*` — AI Content Studio endpoints
- `/api/social/*` — Social Media Hub endpoints
- `/api/analytics/*` — Analytics & Intelligence endpoints
- `/api/canvas/*` — Canvas Workspace endpoints
- `/api/auth/*` — Authentication and user management
- `/api/billing/*` — Stripe subscription management

**Background Workers** (Inngest/Trigger.dev)

- **AI Generation Workers** — image/video generation queue with progress streaming
- **Publishing Workers** — scheduled post publishing with retry logic
- **Analytics Workers** — periodic data collection from platform APIs
- **Competitor Workers** — daily competitor data refresh
- **Webhook Handlers** — process incoming webhooks from social platforms

**Data Layer**

- **PostgreSQL** — primary relational data (users, posts, accounts, analytics)
- **Redis (Upstash)** — caching, rate limiting, real-time pub/sub
- **R2/S3** — media storage (generated images, videos, user uploads)
- **Vector DB** (optional, post-MVP) — content similarity search for AI recommendations

**External Integrations**

- Social Platform APIs (Meta, X, LinkedIn, TikTok, YouTube)
- AI Providers (Anthropic, OpenAI, Replicate, Deepgram)
- Stripe (billing), Resend (email), Novu (notifications)

### 3.4 Database Schema (Core Entities)

The database is organized by domain with clear foreign key relationships. All tables include standard audit fields (`created_at`, `updated_at`, `deleted_at` for soft deletes). Below are the primary entities.

#### 3.4.1 Core / Auth Domain

| Table | Key Fields | Purpose |
|-------|-----------|---------|
| `users` | id, email, name, avatar_url, plan_tier, onboarding_complete | User accounts |
| `workspaces` | id, name, owner_id, plan_tier, brand_kit (JSONB) | Multi-tenant workspaces |
| `workspace_members` | workspace_id, user_id, role (owner/admin/member) | Team membership |

#### 3.4.2 Social Media Hub Domain

| Table | Key Fields | Purpose |
|-------|-----------|---------|
| `social_accounts` | id, workspace_id, platform, platform_user_id, access_token (encrypted), refresh_token, status | Connected social accounts |
| `posts` | id, workspace_id, content (JSONB), status (draft/scheduled/published/failed), scheduled_at | Social media posts |
| `post_variants` | id, post_id, platform, adapted_content (JSONB), media_urls, platform_post_id | Platform-specific post versions |
| `media_assets` | id, workspace_id, type (image/video/audio), storage_url, metadata (JSONB) | Uploaded and generated media |

#### 3.4.3 AI Content Studio Domain

| Table | Key Fields | Purpose |
|-------|-----------|---------|
| `generation_jobs` | id, workspace_id, type (image/video/copy), prompt, provider, status, result_url, cost | AI generation tracking |
| `brand_kits` | id, workspace_id, colors (JSONB), fonts, logo_url, tone_description, sample_content | Brand identity settings |
| `templates` | id, category, name, prompt_template, preview_url, is_system | Content templates |

#### 3.4.4 Analytics Domain

| Table | Key Fields | Purpose |
|-------|-----------|---------|
| `account_metrics` | id, social_account_id, date, followers, impressions, engagement_rate, reach (JSONB) | Daily account snapshots |
| `post_metrics` | id, post_variant_id, date, likes, comments, shares, saves, impressions, clicks | Post performance data |
| `competitors` | id, workspace_id, platform, platform_handle, display_name | Tracked competitor accounts |
| `competitor_metrics` | id, competitor_id, date, followers, engagement_rate, posting_frequency, top_content (JSONB) | Competitor daily snapshots |

#### 3.4.5 Canvas Workspace Domain

| Table | Key Fields | Purpose |
|-------|-----------|---------|
| `canvases` | id, workspace_id, name, grid_index, viewport_state (JSONB) | Canvas/grid containers |
| `cards` | id, canvas_id, type (text/ai/checklist/image/embed/link), content (JSONB), position (JSONB), size (JSONB) | Individual canvas cards |
| `card_connections` | id, from_card_id, to_card_id, label, style (JSONB) | Links between cards |
| `ai_conversations` | id, card_id, provider, messages (JSONB), model | AI card chat histories |

---

## 4. Key Architectural Decisions

### 4.1 AI Content Studio: Generation Pipeline

AI generation follows a queue-based architecture to handle long-running tasks and provide real-time progress updates to users:

1. **User Submits Request:** Client sends generation parameters to `/api/studio/generate`. Instantly returns a `job_id`.
2. **Job Queued:** Inngest/Trigger.dev picks up the job. Calls the appropriate AI provider (Replicate for images, Claude for copy).
3. **Progress Streaming:** Worker publishes progress updates to Redis pub/sub. Client subscribes via SSE or WebSocket for real-time UI updates (`generating... 45%... processing... done`).
4. **Result Storage:** Generated assets are uploaded to R2/S3. Job record updated with result URL.
5. **Cross-Pillar Integration:** Generated content appears in the user's media library, ready to be dragged into a scheduled post or placed on a canvas card.

### 4.2 Social Media Hub: Publishing Architecture

Scheduled publishing uses a cron-based job system with reliability guarantees:

1. **Schedule Creation:** User sets a publish time. Post record created with `status=scheduled` and `scheduled_at` timestamp.
2. **Cron Trigger:** A cron job runs every minute, querying for posts where `scheduled_at <= now AND status=scheduled`.
3. **Platform-Specific Publishing:** For each `post_variant`, the appropriate platform adapter is called. Each adapter handles media upload, content formatting, and API-specific requirements.
4. **Retry Logic:** If publishing fails (rate limit, token expired, API error), the job is retried with exponential backoff up to 3 times. On persistent failure, user is notified and post status set to `failed`.
5. **Post-Publish Sync:** After successful publish, the `platform_post_id` is stored, and the first analytics collection is scheduled for 1 hour later.

### 4.3 Video Editor: Remotion Architecture

The video editor uses Remotion, which treats videos as React components. This enables a powerful editing experience within the existing tech stack:

- **Browser Preview:** Remotion Player renders video compositions in-browser in real-time, allowing instant preview of edits without server rendering.
- **Timeline Abstraction:** The timeline UI controls Remotion composition props (sequences, timing, overlays). Each track maps to a React component layer.
- **Server-Side Rendering:** Final export is handled by Remotion Lambda or a dedicated Fly.io worker running Remotion's server renderer. This offloads CPU-intensive encoding from the client.
- **Template System:** Video templates are Remotion compositions with parameterized props (text, images, colors, timing). Users customize parameters; the composition handles layout and animation.

### 4.4 Canvas: Data Model & Rendering

The canvas uses tldraw (or ReactFlow) as the rendering engine with a custom card system layered on top:

- **CRDT-Ready:** Card positions and content are stored as JSONB, structured for future CRDT-based real-time collaboration (Yjs or Liveblocks).
- **Lazy Loading:** Only cards within the current viewport are fully rendered. Off-screen cards are rendered as lightweight placeholders.
- **AI Card Architecture:** Each AI card maintains its own conversation context via Vercel AI SDK v5. The card sends messages to `/api/canvas/ai-chat` with the `card_id`, and responses stream directly into the card using `useChat` with inputSchema-based tools.
- **Persistence Strategy:** Canvas state is auto-saved via debounced writes (300ms) to the database. Full canvas state is also cached in Redis for fast reload.

### 4.5 Analytics: Data Pipeline

Analytics data flows through a scheduled collection pipeline:

1. **Scheduled Collection:** Inngest cron jobs trigger data collection every 6 hours for own accounts, daily for competitors.
2. **Platform API Calls:** Each platform adapter fetches the relevant metrics using the user's stored OAuth tokens.
3. **Data Normalization:** Raw API responses are normalized into the common `account_metrics` and `post_metrics` schema, ensuring consistent data regardless of source platform.
4. **Aggregation:** Pre-computed aggregates (weekly summaries, month-over-month growth) are stored alongside raw data to keep dashboard queries fast.
5. **AI Analysis:** After each collection cycle, an AI analysis job runs to generate insights, detect trends, and update content scoring models.

---

## 5. MVP Scope & Development Roadmap

### 5.1 MVP Definition (12-16 weeks)

The MVP includes thin slices of all four pillars, prioritized to create a complete user journey from content creation to publishing to measuring results:

| Phase | Duration | Deliverables | Milestone |
|-------|----------|-------------|-----------|
| Phase 0: Foundation | Weeks 1-2 | Auth, workspace setup, database schema, CI/CD pipeline, brand kit onboarding | Users can sign up and configure their brand |
| Phase 1: AI Studio Core | Weeks 3-5 | Image generation, copywriting, template library, media library | Users can generate on-brand content |
| Phase 2: Social Hub Core | Weeks 6-8 | Connect 3 platforms (Instagram, X, LinkedIn), scheduling calendar, platform adaptation, preview mode | Users can schedule and publish AI-generated content |
| Phase 3: Analytics V1 | Weeks 9-11 | Performance dashboard, post metrics, competitor tracking (3 competitors), weekly AI digest | Users can see what's working |
| Phase 4: Canvas V1 | Weeks 12-14 | Infinite canvas, 4 card types (text, AI, checklist, image), grid system | Users can plan and brainstorm |
| Phase 5: Polish & Launch | Weeks 15-16 | Integration testing, onboarding flow, billing (Stripe), landing page, beta invites | Product ready for beta users |

### 5.2 Pricing Strategy (Suggested)

| Tier | Price | AI Generations | Social Accounts | Competitors | Canvas Grids |
|------|-------|---------------|-----------------|-------------|-------------|
| Starter | $19/mo | 50 images, 10 videos/mo | 3 accounts | 3 competitors | 2 grids |
| Growth | $49/mo | 200 images, 50 videos/mo | 10 accounts | 10 competitors | Unlimited grids |
| Pro | $99/mo | Unlimited images, 200 videos/mo | 25 accounts | 25 competitors | Unlimited + collaboration |

### 5.3 Success Metrics

| Metric | Target (3 months post-launch) | Measurement |
|--------|------------------------------|-------------|
| Beta Sign-ups | 500 users | Registration count |
| Activation Rate | 40% (connect 1 account + generate 1 asset) | Event tracking (PostHog) |
| Weekly Active Users | 30% of registered users | Unique sessions per week |
| Posts Scheduled | 5+ posts/user/week average | Database query |
| Paid Conversion | 5% of free users | Stripe subscription events |
| Churn Rate | <8% monthly | Subscription cancellations |

---

## 6. Recommended Project Structure

The following folder structure reflects the modular monolith architecture, with clear domain separation:

```
contentos/
├── app/                          # Next.js App Router
│   ├── (auth)/                   # Auth pages (login, signup, onboarding)
│   ├── (dashboard)/              # Main app layout
│   │   ├── studio/               # AI Content Studio pages
│   │   ├── social/               # Social Media Hub pages
│   │   ├── analytics/            # Analytics pages
│   │   ├── canvas/               # Canvas Workspace pages
│   │   └── settings/             # Workspace & account settings
│   └── api/                      # Route Handlers
│       ├── studio/               # AI generation endpoints
│       ├── social/               # Publishing & scheduling endpoints
│       ├── analytics/            # Data collection endpoints
│       ├── canvas/               # Canvas CRUD + AI chat endpoints
│       ├── auth/                 # Auth callbacks, sessions
│       └── webhooks/             # Incoming webhooks from platforms
├── src/
│   ├── modules/                  # Domain modules
│   │   ├── studio/               # AI Content Studio logic
│   │   ├── social/               # Social Media Hub logic
│   │   ├── analytics/            # Analytics logic
│   │   └── canvas/               # Canvas logic
│   ├── components/               # Shared UI components
│   ├── lib/                      # Shared utilities
│   │   ├── db/                   # Drizzle schema, migrations, queries
│   │   ├── ai/                   # AI provider configurations
│   │   ├── platforms/            # Social platform adapters
│   │   └── storage/              # File upload utilities
│   └── hooks/                    # Shared React hooks
├── inngest/                      # Background job definitions
│   ├── functions/                # Job handlers
│   └── client.ts                 # Inngest client config
├── drizzle/                      # Database migrations
└── public/                       # Static assets
```

---

## 7. Key Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------|------------|
| Social platform API changes or deprecation | High | Medium | Abstract platform interactions behind adapter pattern. Monitor API changelogs. Maintain fallback scraping for non-critical data. |
| AI generation costs exceed revenue at scale | High | Medium | Implement per-user generation limits by tier. Cache common generations. Negotiate volume pricing with providers. Self-host models as volume grows. |
| OAuth token expiry causing publishing failures | Medium | High | Proactive token refresh schedule. Health check dashboard. Push notifications for re-auth required. Graceful degradation (queue failed posts for retry). |
| Scope creep across four pillars | High | High | Strict MVP feature freeze. Phase-gated development. User feedback drives post-MVP priority. Say no to non-essential features. |
| Video editor performance in browser | Medium | Medium | Remotion Player handles preview well. Offload rendering to server/Lambda. Progressive loading for large compositions. |
| Competitor data collection at scale | Medium | Medium | Start with public API data only. Implement respectful rate limiting. Consider partnerships with data providers for scale. |

---

## 8. Recommended Next Steps

1. **Set Up Foundation:** Initialize Next.js 15 project with the recommended folder structure, configure Drizzle + PostgreSQL, set up auth, and deploy a skeleton to Vercel.
2. **Build Brand Kit Onboarding:** Create the onboarding flow where users define their brand identity. This data feeds every AI generation.
3. **Implement AI Image Generation:** Connect Replicate API, build the generation queue with Inngest, and create the media library UI. This is the wow moment that hooks users.
4. **Add Social Account Connection:** Implement OAuth flows for Instagram, X, and LinkedIn. Build the scheduling calendar and platform adaptation engine.
5. **Launch Closed Beta:** With AI generation + publishing working, invite 50-100 SMB owners for feedback before building analytics and canvas.
