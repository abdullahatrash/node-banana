# Node Banana

Node Banana includes a Social Hub for planning, composing, and publishing generated media and written posts to external social platforms.

## Language

**Channel**:
A connected social publishing destination inside a workspace, backed by one platform account, page, or channel and its auth credentials.
_Avoid_: Integration, social account, provider account

**Platform**:
An external social network or publishing surface, such as YouTube, TikTok, Reddit, Instagram, X, or LinkedIn.
_Avoid_: Provider

**Provider Adapter**:
The code module that knows how to authenticate, validate, and publish to a **Platform**.
_Avoid_: Integration

**Publishing Settings**:
Platform-specific options that modify how a post is validated, previewed, or published for a selected **Channel**.
_Avoid_: Provider settings, platform settings, post settings

**Publish Validation**:
The checks that decide whether a **Post** can be sent through a **Channel** with its selected content, media, and **Publishing Settings**.
_Avoid_: Form validation, provider validation

**Safe Defaults**:
Initial **Publishing Settings** values that avoid unintended public publishing while still letting creators move quickly.
_Avoid_: Postiz defaults, platform defaults

**Publishing Readiness**:
The per-**Channel** state that tells a creator whether a **Post** has all required content, media, and **Publishing Settings** needed to schedule or publish.
_Avoid_: Form status, validation status

**Normalized Publishing Settings**:
Stored **Publishing Settings** that use stable canonical field names and primitive values rather than UI widget shapes.
_Avoid_: Raw form values

**Instance Registration**:
A stored OAuth app credential set for a federated **Platform** instance (e.g., a specific Mastodon server). One registration is shared by all **Channels** on that instance within the system.
_Avoid_: App registration, server config

**Facet**:
A byte-range annotation on post text that marks a link, @mention, or #hashtag for platforms that require explicit rich-text markup (e.g., Bluesky via AT Protocol).
_Avoid_: Entity, annotation, rich text node

**App Password Auth**:
An authentication method where the user provides a platform-generated credential directly, instead of an OAuth redirect flow. Used by Bluesky.
_Avoid_: API key auth, basic auth, direct login

**Content Warning**:
An optional spoiler or sensitivity label on a Mastodon post that collapses the main content behind a "Show more" button. A **Publishing Setting** specific to Mastodon **Channels**.
_Avoid_: CW, spoiler text, sensitive flag

**Post Visibility**:
A **Publishing Setting** that controls the audience reach of a post on federated platforms. Mastodon supports public, unlisted, private, and direct.
_Avoid_: Privacy setting, audience

## Relationships

- A **Workspace** has zero or more **Channels**.
- A **Channel** belongs to exactly one **Platform**.
- A **Provider Adapter** supports exactly one **Platform**.
- A **Post** has **Publishing Settings** for each selected **Channel** when that platform needs extra publishing choices.
- A **Platform** defines the shape of **Publishing Settings**, but the saved values belong to a specific selected **Channel** for a **Post**.
- **Publishing Settings** are stored as **Normalized Publishing Settings**.
- **Publishing Settings** must affect the resulting platform publish request when the corresponding **Platform** supports the option.
- **Publish Validation** applies to the combination of **Post**, **Channel**, media, and **Publishing Settings**.
- A draft **Post** may have incomplete **Publishing Settings**; a scheduled or publishing **Post** must pass **Publish Validation**.
- **Safe Defaults** should be applied when a **Channel** is selected, except where the creator must make an explicit destination choice such as a Reddit subreddit or Pinterest board.
- **Publishing Readiness** is shown separately for each selected **Channel**.
- A **Post** sent through a Reddit **Channel** targets one subreddit destination at a time.
- During a compose session, deselecting a **Channel** preserves its unsaved **Publishing Settings** in case the creator reselects it; saving a **Post** only persists settings for selected **Channels**.
- When editing an older draft **Post** that has missing **Publishing Settings**, the composer hydrates **Safe Defaults** for display without changing the saved **Post** until the creator saves, schedules, or publishes.
- A federated **Platform** (e.g., Mastodon) may have many instances, each with its own **Instance Registration**.
- Multiple **Channels** on the same federated instance share one **Instance Registration**.
- A Bluesky **Channel** uses **App Password Auth** instead of an OAuth redirect flow.
- A Mastodon **Channel** has **Post Visibility** and optional **Content Warning** as **Publishing Settings**.
- **Facets** are computed at publish time by the Bluesky **Provider Adapter**, not stored on the **Post**.

## Example Dialogue

> **Dev:** "When a user connects YouTube, are they adding an integration or an account?"
> **Domain expert:** "They are adding a **Channel**. YouTube is the **Platform**, and the YouTube **Provider Adapter** handles OAuth and publishing."
>
> **Dev:** "Where do YouTube privacy and Reddit subreddit choices belong?"
> **Domain expert:** "Those are **Publishing Settings** for the selected **Channel**, not global post content."
>
> **Dev:** "If I publish the same post to two YouTube channels, do they share one privacy setting?"
> **Domain expert:** "No. The YouTube **Platform** defines the privacy field, but each selected **Channel** stores its own **Publishing Settings** value for that post."
>
> **Dev:** "Can this post be scheduled if TikTok has no media attached?"
> **Domain expert:** "No. **Publish Validation** should catch that before the post is sent through the TikTok **Channel**."
>
> **Dev:** "Can a creator save a YouTube draft before choosing privacy or title?"
> **Domain expert:** "Yes. A draft **Post** can be incomplete, but scheduling or publishing it must pass **Publish Validation**."
>
> **Dev:** "Should YouTube default to public because Postiz does?"
> **Domain expert:** "No. Node Banana uses **Safe Defaults** so generated or experimental work is not published publicly by accident."
>
> **Dev:** "If a post targets YouTube and Reddit, can one readiness state cover both?"
> **Domain expert:** "No. Each selected **Channel** has its own **Publishing Readiness** because each may require different **Publishing Settings**."
>
> **Dev:** "Can one Reddit **Channel** publish the same post to five subreddits at once?"
> **Domain expert:** "No. A Reddit **Channel** post targets one subreddit destination at a time; creators can duplicate or create separate posts for multiple subreddits."

## Flagged Ambiguities

- "integration" was used to mean a connected publishing destination; resolved: use **Channel** for the destination and reserve "integration" for broader third-party product integrations.
- "settings" was used broadly; resolved: use **Publishing Settings** for platform-specific options attached to publishing a **Post** through a **Channel**.
- Existing code and database fields may still use `socialAccountId` and `platformSettings`; resolved: keep those implementation names for now while using **Channel** and **Publishing Settings** in product/domain language and new domain-facing code.
