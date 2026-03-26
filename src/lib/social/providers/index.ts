/**
 * Social provider bootstrap module.
 *
 * Import this module once (e.g., in the social API route handler) to ensure
 * all provider adapters are registered in the provider registry before use.
 * Each provider calls registerProvider() as a side effect at module load time.
 */
import "./linkedin";
import "./x";
import "./instagram";
import "./facebook";
import "./tiktok";
import "./youtube";
import "./reddit";
import "./threads";

export { linkedInProvider } from "./linkedin";
export { xProvider } from "./x";
export { tikTokProvider } from "./tiktok";
export { youTubeProvider } from "./youtube";
export { facebookProvider } from "./facebook";
export { instagramProvider } from "./instagram";
export { redditProvider } from "./reddit";
export { threadsProvider } from "./threads";
