export interface OnboardingQueue {
  schedule(input: { workspaceId: string; runId: string }): Promise<void>;
}

export class InMemoryOnboardingQueue implements OnboardingQueue {
  readonly scheduled = new Map<string, { workspaceId: string; runId: string }>();

  async schedule(input: { workspaceId: string; runId: string }): Promise<void> {
    this.scheduled.set(`${input.workspaceId}\u0000${input.runId}`, input);
  }
}

