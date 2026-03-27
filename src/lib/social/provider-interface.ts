import type { SocialPlatform } from "@/lib/db/schema";

/**
 * Error classification for social provider operations.
 * Drives retry behavior in the Vercel Workflow publish pipeline.
 */
export type SocialErrorType =
  | "refresh-token" // Token expired — refresh then retry
  | "bad-body" // Invalid content — fail immediately (FatalError)
  | "retry"; // Transient error — auto-retry (up to 3x)

export interface SocialProviderError {
  type: SocialErrorType;
  message: string;
  original?: unknown;
}

/**
 * OAuth URL generation result.
 */
export interface GenerateAuthUrlResult {
  url: string;
  state: string;
  codeVerifier?: string; // PKCE or OAuth 1.0a secret
}

/**
 * Result from exchanging an OAuth code for tokens.
 */
export interface AuthenticateResult {
  platformUserId: string;
  accessToken: string;
  refreshToken?: string;
  accessTokenSecret?: string; // OAuth 1.0a (X/Twitter)
  expiresIn?: number; // Seconds until token expiry
  displayName: string;
  username?: string;
  avatarUrl?: string;
  requiresPageSelection?: boolean; // True for Instagram, Facebook, YouTube, LinkedIn
}

/**
 * Input for exchanging an OAuth callback code into tokens.
 */
export interface AuthenticateParams {
  code: string;
  state: string;
  redirectUri: string;
  codeVerifier?: string;
}

/**
 * Result from refreshing an expired token.
 */
export interface RefreshTokenResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

/**
 * Page/channel/account info for two-step auth flows.
 */
export interface PageInfo {
  id: string;
  name: string;
  accessToken?: string;
  picture?: string;
  username?: string;
}

/**
 * Media item to publish with a post.
 */
export interface PublishMediaItem {
  type: "image" | "video";
  url: string; // S3/R2 presigned URL or public URL
  alt?: string;
  mimeType?: string;
}

/**
 * Request to publish a post to a social platform.
 */
export interface PublishRequest {
  postId: string; // Our internal post ID
  content: string;
  media?: PublishMediaItem[];
  platformSettings?: Record<string, unknown>;
}

/**
 * Result after successfully publishing to a platform.
 */
export interface PublishResult {
  postId: string; // Our internal post ID
  platformPostId: string; // Platform-specific post ID
  platformPostUrl: string; // Direct link to the published post
  status: "published" | "processing"; // Some platforms (IG, TikTok) publish async
}

export interface PublishStatusResult {
  platformPostId: string;
  platformPostUrl: string;
  status: "published" | "processing" | "failed";
  errorMessage?: string;
}

/**
 * Provider capabilities exposed to the UI (e.g., provider list endpoint).
 */
export interface ProviderCapabilities {
  identifier: SocialPlatform;
  displayName: string;
  maxContentLength: number;
  supportsImages: boolean;
  supportsVideo: boolean;
  supportsCarousel: boolean;
  requiresPageSelection: boolean;
}

/**
 * Core interface that every social platform adapter must implement.
 *
 * Inspired by Postiz's SocialProvider but simplified for our stack:
 * - No NestJS decorators or DI
 * - Composition over inheritance (no abstract base class)
 * - Explicit error classification for Vercel Workflow retry semantics
 */
export interface SocialProviderAdapter {
  /** Platform identifier (matches socialPlatformEnum). */
  readonly identifier: SocialPlatform;

  /** Human-readable platform name. */
  readonly displayName: string;

  /** Maximum post text length for this platform. */
  readonly maxContentLength: number;

  /** Whether this platform supports image uploads. */
  readonly supportsImages: boolean;

  /** Whether this platform supports video uploads. */
  readonly supportsVideo: boolean;

  /** Whether this platform supports multi-image carousel posts. */
  readonly supportsCarousel: boolean;

  /** Maximum number of images per post. */
  readonly maxImages: number;

  /** Max concurrent publish jobs (for rate limiting). */
  readonly maxConcurrentJobs: number;

  /** Whether the OAuth flow requires page/channel selection after initial auth. */
  readonly requiresPageSelection: boolean;

  /**
   * Generate the OAuth authorization URL for this platform.
   * The user will be redirected here to grant access.
   */
  generateAuthUrl(callbackUrl: string): Promise<GenerateAuthUrlResult>;

  /**
   * Exchange an OAuth authorization code for access tokens.
   * Called after the user approves the OAuth prompt.
   */
  authenticate(params: AuthenticateParams): Promise<AuthenticateResult>;

  /**
   * Refresh an expired access token.
   * Some platforms (X) have permanent tokens — their implementation is a no-op.
   */
  refreshToken(refreshToken: string): Promise<RefreshTokenResult>;

  /**
   * Publish one or more posts to the platform.
   * Returns a result for each post in the request array.
   */
  post(
    platformUserId: string,
    accessToken: string,
    requests: PublishRequest[],
    options?: { accessTokenSecret?: string },
  ): Promise<PublishResult[]>;

  /**
   * Classify a platform API error into a retry category.
   * This drives Vercel Workflow's retry behavior:
   * - "bad-body" → FatalError (no retry)
   * - "refresh-token" → FatalError + mark account for re-auth
   * - "retry" → auto-retry up to 3 times
   */
  classifyError(error: unknown): SocialProviderError;

  /**
   * Fetch available pages/channels/accounts for two-step auth flows.
   * Only implemented by providers where requiresPageSelection is true.
   */
  fetchPageInformation?(accessToken: string): Promise<PageInfo[]>;

  /**
   * Fetch the current status of a previously created platform post.
   * Implemented only by providers that support asynchronous publish states.
   */
  getPostStatus?(
    platformUserId: string,
    accessToken: string,
    platformPostId: string,
    options?: { accessTokenSecret?: string },
  ): Promise<PublishStatusResult>;

  /**
   * Get the provider's capabilities for UI display.
   */
  getCapabilities(): ProviderCapabilities;
}
