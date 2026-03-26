# Social Hub Frontend UI — Design Spec

## Why

The Social Hub backend is complete (6 providers, 9 API routes, durable workflows, repository, media processing). But there's no UI — users can't interact with any of it. This spec designs the frontend pages, user flows, and component structure to make the Social Hub usable.

## Architectural Context

ContentOS is a multi-pillar app. Each pillar is a separate Next.js route group with its own layout:

```
/ (home)           → Marketing page (future) / redirects to login
/studio            → AI Content Studio (existing canvas editor)
/social            → Social Media Hub (this spec)
/analytics         → Analytics Dashboard (future)
```

After login, users land on a **Command Center** (future) where they choose a pillar. Every pillar's header contains a **Pillar Switcher dropdown** to jump between Studio / Social / Analytics without returning to the command center.

---

## Route Structure

```
/social                        → redirects to /social/calendar
/social/calendar               → Calendar scheduling view (default)
/social/compose                → Full-page post composer (new post)
/social/compose/[postId]       → Edit existing draft
/social/posts                  → Posts list (all statuses, filterable)
/social/channels               → Channel management
```

---

## Layout

**Persistent left sidebar** across all `/social/*` pages (like Postiz):

```
┌──────────────────────────────────────────────────────┐
│  🍌 [📱 Social Hub ▼]              [+ New Post] user │  ← Header with pillar switcher
├─────────────┬────────────────────────────────────────┤
│ Navigation  │                                        │
│ 📅 Calendar │         Main content area              │
│ ✏️ Compose  │         (changes per route)             │
│ 📝 Posts    │                                        │
│ 📱 Channels │                                        │
│             │                                        │
│ ─────────── │                                        │
│ Channels    │                                        │
│ 🔵 LinkedIn │                                        │
│ ⚫ X        │                                        │
│ 🟣 IG       │                                        │
│ + Add       │                                        │
└─────────────┴────────────────────────────────────────┘
```

**Sidebar contents:**
- **Navigation section**: Calendar, Compose, Posts, Channels — active item highlighted with platform green
- **Channels section**: Connected accounts with avatar + platform badge + status dot (green = healthy, red = needs re-auth)
- **"+ Add Channel"** button (dashed border) at bottom of channel list
- Sidebar width: ~220px, collapsible on small screens

**Header:**
- Logo + Pillar Switcher dropdown (shows current pillar, dropdown lists all pillars + command center)
- "+ New Post" button (green, navigates to `/social/compose`)
- User avatar/email

---

## Page 1: Channel Management (`/social/channels`)

### Empty State (first visit)
- Centered illustration + "Connect your first channel" heading
- Description text explaining the value
- Large green "Connect Channel" CTA button

### Platform Picker
After clicking "Connect Channel":
- Grid of 6 platform cards (LinkedIn, Instagram, X, TikTok, Facebook, YouTube)
- Each card: platform icon (brand color), platform name
- Click → initiates OAuth flow via `POST /api/social/accounts/connect`

### OAuth Flow
1. Browser redirects to platform OAuth page
2. User approves
3. Callback returns to `/social/channels` with success state
4. **Two-step auth** (LinkedIn, Instagram, Facebook, YouTube): page/channel picker appears — user selects which account to post as
5. Success: channel appears in sidebar + channel grid

### Connected Channels View
- Grid of channel cards, each showing:
  - Platform icon (brand color) + avatar
  - Display name + platform label
  - Status badge: green "Connected" or red "Needs re-auth"
  - Action buttons: "Settings" and "Disconnect" (or "Reconnect" if needs re-auth)
- Disconnect: confirmation dialog → calls `DELETE /api/social/accounts/[accountId]`
- Reconnect: re-initiates OAuth flow for that platform

### Sidebar Channel List
- Always visible across all `/social/*` pages
- Each channel: 22px circular avatar with platform badge, display name, status dot
- Click a channel → filters calendar/posts to that channel
- Red dot = `requiresReauth` flag from API

---

## Page 2: Calendar (`/social/calendar`)

The default landing page for Social Hub. Shows scheduled, published, and failed posts on a visual timeline.

### View Modes
- **Week view** (default): 7-column grid (Mon–Sun) with hourly rows. Time labels on left (136px). Each cell is a droppable zone.
- **Day view**: Single day, posts grouped by hour/minute, vertically scrolled
- **Month view**: 7-column x 6-row grid, posts shown as compact bars per day
- **List view**: Paginated vertical list, grouped by date. No drag-and-drop.

View switcher: tabs above the calendar (Day | Week | Month | List). Stored in localStorage.

### Post Cards on Calendar
Two-part card design:
- **Header strip**: Background color from post tag/status. Shows: tag labels, hover-revealed action icons (edit, duplicate, preview, delete)
- **Body**: Platform icon (20px) + content preview (single line, truncated) + time label
- Draft posts prefixed with "Draft:" label
- Past posts rendered with grayscale filter
- Status color coding:
  - Draft: neutral/gray border
  - Queued/Scheduled: blue border
  - Published: green border
  - Failed: red border with warning icon

### Drag-and-Drop Rescheduling
- **Library**: `react-dnd` with `HTML5Backend`
- Posts are **drag sources** — become semi-transparent while dragging
- Calendar time slots are **drop targets** — show purple highlight border on hover
- **Past time slots disabled**: diagonal stripe pattern, `cursor: not-allowed`, won't accept drops
- **Validation refreshes** every ~120ms to catch the boundary as "now" advances
- **Drop action**:
  1. If post is published/queued: prompt user — "Reschedule" (reset to queued) or "Just move" (keep status) or "Cancel"
  2. Call `PATCH /api/social/posts/[postId]` with new `scheduledAt`
  3. Optimistic UI update, reload calendar data

### Click to Create
- Click on any future empty time slot → navigate to `/social/compose` with `?date={clicked-time}` pre-filled
- If no channels connected → redirect to `/social/channels` with prompt

### Navigation Controls
- **Previous / Next** arrows: shift date range by view period (1 day / 1 week / 1 month)
- **Today** button: jump to current date
- **Channel filter**: filter calendar to show posts for a specific channel only

### Data Fetching
- `GET /api/social/posts?status=queued&status=published&status=failed&startDate=...&endDate=...`
- Refetch on view change, filter change, or after any mutation (create/edit/delete/reschedule)
- SWR or TanStack Query for caching + revalidation

---

## Page 3: Post Composer (`/social/compose`)

Full-page split view. Editor on left, live platform previews on right.

### URL Patterns
- `/social/compose` — new post
- `/social/compose/[postId]` — edit existing draft
- `/social/compose?date=2026-03-28T10:00:00` — new post with pre-filled schedule (from calendar click)
- `/social/compose?assetId=asset_123` — new post with pre-attached media from Studio (future)

### Left Panel: Editor

**Platform Selector** (top):
- Row of connected channel chips. Each shows: platform icon + display name
- Click to toggle: selected channels glow with platform brand color + checkmark. Unselected are dimmed.
- Multi-select: post to multiple platforms simultaneously
- At least one must be selected to publish

**Content Mode Tabs**:
- **"All platforms"**: single editor, content shared across all selected platforms
- **"Per platform"**: tab per selected platform, customize content individually

**Text Editor**:
- Plain text editor (no rich text for MVP — social platforms don't support it)
- Auto-growing textarea
- **Live character count** per selected platform below editor:
  - Green: under 80% of limit
  - Amber: 80–100% of limit
  - Red: over limit (content will be truncated)
  - Shows: `{count} / {limit} ({platform})`

**Media Section**:
- Grid of attached media thumbnails (80x80px) with remove (✕) button
- **"+ Media Pool"** button: opens the Media Pool panel/modal
- **Media Pool**: browse R2 assets (images, videos from AI Studio or uploads). Search, filter by type, click to attach.
- Drag media thumbnails to reorder
- Per-platform media validation shown (e.g., "YouTube: video only", "X: max 4 images")

**Schedule Section**:
- Date picker + time picker
- Pre-filled from `?date=` query param if coming from calendar click

**Action Buttons** (bottom, sticky):
- **Save Draft** (gray): saves without scheduling, status = `draft`
- **Schedule** (amber): requires date/time set, status = `queued`, starts Vercel Workflow with sleep
- **Publish Now** (green): immediate publish, status = `queued` → workflow runs immediately

### Right Panel: Live Preview

- Scrollable stack of platform-specific previews, one per selected channel
- Each preview card:
  - Platform badge + label at top
  - Pixel-approximate mockup of how the post appears on that platform
  - Shows: avatar, display name, content, attached media, engagement buttons (non-functional, for visual accuracy)
  - Character count warning badge if over limit
- **Updates in real-time** as user types
- **Responsive**: on narrow screens, preview collapses to a toggle panel or slides from bottom

### Auto-Save
- Draft auto-saved every 30 seconds while editing
- "Draft saved" / "Saving..." indicator in header

### Back Navigation
- "← Back to Calendar" link in header
- If unsaved changes: confirmation prompt before leaving

---

## Page 4: Posts List (`/social/posts`)

Filterable table/list of all posts across all statuses.

### Filters
- **Status**: All | Draft | Scheduled | Published | Failed (tab-style toggle)
- **Channel**: filter by specific connected account
- **Date range**: optional date picker

### Post Row
Each post shows:
- Platform icon + channel name
- Content preview (truncated, 1–2 lines)
- Status badge (colored pill: gray=draft, blue=scheduled, green=published, red=failed)
- Scheduled/published date+time
- **Actions**: Edit (drafts only), Duplicate, Delete, Retry (failed only), View (published — links to platform URL)

### Failed Posts
- Red status badge with error icon
- Expandable error message (from `errorMessage` field)
- **"Retry"** button: calls `POST /api/social/posts/[postId]/publish` → resets retryCount, re-queues

### Bulk Actions (future)
- Select multiple posts → bulk delete, bulk reschedule

---

## Media Pool

A shared component (panel or modal) used within the composer to browse and select R2 assets.

### Layout
- Grid of media thumbnails from the workspace's R2 storage
- Filter tabs: All | Images | Videos
- Search bar (by filename/metadata)
- Upload button (direct upload to R2 via presigned URL — reuses existing `/api/studio/assets/presign`)

### Selection
- Click thumbnail to select (checkmark overlay)
- Multi-select supported
- "Insert" button adds selected media to the composer
- Shows media dimensions + file size on hover

### Data Source
- `GET /api/studio/assets?type=image,video` — reuses the existing Studio assets API
- Assets are workspace-scoped (already enforced by authz)

---

## Component Architecture

```
src/app/social/
├── layout.tsx                          ← Social Hub layout (sidebar + header)
├── page.tsx                            ← Redirect to /social/calendar
├── calendar/
│   └── page.tsx                        ← Calendar page
├── compose/
│   ├── page.tsx                        ← New post composer
│   └── [postId]/
│       └── page.tsx                    ← Edit draft composer
├── posts/
│   └── page.tsx                        ← Posts list
└── channels/
    └── page.tsx                        ← Channel management

src/components/social/
├── SocialSidebar.tsx                   ← Left sidebar (nav + channels)
├── SocialHeader.tsx                    ← Header with pillar switcher
├── PillarSwitcher.tsx                  ← Dropdown to switch pillars
├── ChannelCard.tsx                     ← Channel card (channels page)
├── ChannelChip.tsx                     ← Compact channel selector (composer)
├── ChannelAvatar.tsx                   ← Platform icon + avatar combo
├── PlatformPicker.tsx                  ← Grid of platforms for connection
├── calendar/
│   ├── CalendarView.tsx                ← Calendar with view switching
│   ├── CalendarWeek.tsx                ← Week grid view
│   ├── CalendarDay.tsx                 ← Day view
│   ├── CalendarMonth.tsx               ← Month grid view
│   ├── CalendarColumn.tsx              ← Single time slot (drop target)
│   ├── CalendarPostCard.tsx            ← Post card on calendar (drag source)
│   └── CalendarFilters.tsx             ← View switcher + date nav + channel filter
├── compose/
│   ├── PostEditor.tsx                  ← Text editor with character count
│   ├── PlatformSelector.tsx            ← Multi-select channel picker
│   ├── MediaAttachments.tsx            ← Attached media grid
│   ├── MediaPool.tsx                   ← R2 asset browser modal/panel
│   ├── SchedulePicker.tsx              ← Date + time pickers
│   ├── PlatformPreview.tsx             ← Single platform preview card
│   ├── PreviewPanel.tsx                ← Right panel with all previews
│   └── previews/
│       ├── LinkedInPreview.tsx         ← LinkedIn-specific mock
│       ├── XPreview.tsx                ← X/Twitter-specific mock
│       ├── InstagramPreview.tsx        ← Instagram-specific mock
│       ├── FacebookPreview.tsx         ← Facebook-specific mock
│       ├── TikTokPreview.tsx           ← TikTok-specific mock
│       └── YouTubePreview.tsx          ← YouTube-specific mock
├── posts/
│   ├── PostsList.tsx                   ← Filterable posts table
│   ├── PostRow.tsx                     ← Single post row
│   └── PostStatusBadge.tsx             ← Colored status pill
└── shared/
    ├── StatusDot.tsx                    ← Green/red/amber connection indicator
    └── PlatformIcon.tsx                ← Platform icon with brand color
```

---

## State Management

- **Server state**: TanStack Query (or SWR) for API data — accounts, posts, providers, assets
- **Composer state**: Zustand store for the compose page — content per platform, selected channels, media, schedule, draft save status
- **Calendar state**: Zustand store — current view, date range, channel filter, drag state
- **No global social store** — each page manages its own server state via query hooks

---

## Data Flow

### Creating a Post
```
User: /social/compose
  → Select channels (PlatformSelector)
  → Write content (PostEditor)
  → Attach media from Media Pool (MediaPool → MediaAttachments)
  → Set schedule (SchedulePicker)
  → Click "Schedule"

Client: createSocialPost({ socialAccountId, content, mediaUrls, scheduledAt })
  → POST /api/social/posts (creates draft)
  → POST /api/social/posts/[id]/publish (transitions to queued, starts workflow)

Workflow: publishPostWorkflow
  → sleep(scheduledAt - now)
  → refreshToken → processMedia → publish → finalize

UI: Calendar shows post as "scheduled" → updates to "published" on next poll
```

### Rescheduling via Drag
```
User: drags post card from Tuesday 10:00 to Thursday 14:00

Client:
  → If published/queued: prompt "Reschedule?" / "Just move?" / "Cancel"
  → updateSocialPost(postId, { scheduledAt: new Date("Thu 14:00") })
  → PATCH /api/social/posts/[postId]
  → Optimistic UI update

Calendar: post card moves to new position
```

### Connecting a Channel
```
User: /social/channels → "Connect Channel" → picks LinkedIn

Client: connectSocialAccount("linkedin")
  → POST /api/social/accounts/connect → returns { authUrl }
  → Browser redirects to LinkedIn OAuth

LinkedIn: user approves → redirects back with code + state

Client: handleOAuthCallback("linkedin", code, state)
  → POST /api/social/accounts/callback
  → If requiresPageSelection: show page picker → selectPage(...)
  → Account appears in sidebar + channel grid
```

---

## Error States

| Scenario | UI Treatment |
|----------|-------------|
| No channels connected | Empty state with CTA on calendar, posts, and compose pages |
| OAuth fails | Error toast + "Try again" button on channels page |
| Token expired (requiresReauth) | Red dot on sidebar channel, "Reconnect" button on channel card, warning banner on compose if channel selected |
| Post publish fails | Red badge on calendar card, error message expandable on posts list, "Retry" button |
| Character limit exceeded | Red character count, amber warning on preview, "Publish" button disabled |
| Media validation fails | Red text below media section (e.g., "X supports max 4 images") |
| Network error | Toast notification with retry action |

---

## NPM Dependencies (new for frontend)

| Package | Purpose |
|---------|---------|
| `react-dnd` | Drag-and-drop for calendar rescheduling |
| `react-dnd-html5-backend` | HTML5 DnD backend |
| `@tanstack/react-query` | Server state management (or continue with SWR if already used) |
| `date-fns` or `dayjs` | Date formatting and manipulation for calendar |

---

## MVP Scope

**Build first (Phase 3 UI):**
- Social Hub layout (sidebar + header + pillar switcher)
- Channel management page (connect, disconnect, status)
- Post composer (full page, editor + preview, media pool)
- Calendar (week view + list view, drag-and-drop rescheduling)
- Posts list (filter by status, retry failed)

**Defer:**
- Command center / dashboard hub
- Day view and month view for calendar
- Per-platform content customization in composer
- Bulk actions on posts list
- Media Pool upload (reuse existing presign upload, just add browse UI)
- Post duplication
- Post analytics/statistics
