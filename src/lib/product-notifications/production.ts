import "server-only";
import { getDb } from "@/lib/db";
import { WorkspaceNotificationProjector } from "./projector";
import { WorkspaceNotificationService } from "./service";

export const WORKSPACE_NOTIFICATIONS = new WorkspaceNotificationService();
export const WORKSPACE_NOTIFICATION_PROJECTOR = new WorkspaceNotificationProjector(getDb(), WORKSPACE_NOTIFICATIONS);
