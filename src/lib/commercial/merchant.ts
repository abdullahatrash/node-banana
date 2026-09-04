export interface MerchantOfRecordAdapter {
  createPortal(input: { workspaceId: string; customerRef: string; returnPath: string }): Promise<{ kind: "ready"; url: string; expiresAt: Date } | { kind: "unavailable" }>;
}
export class UnavailableMerchantOfRecordAdapter implements MerchantOfRecordAdapter { async createPortal(_input: { workspaceId: string; customerRef: string; returnPath: string }) { return { kind: "unavailable" as const } as Awaited<ReturnType<MerchantOfRecordAdapter["createPortal"]>>; } }
