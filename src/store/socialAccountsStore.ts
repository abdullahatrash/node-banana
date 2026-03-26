"use client";

import { create } from "zustand";
import type { SocialAccount } from "@/lib/social/client";
import { listSocialAccounts } from "@/lib/social/client";

interface SocialAccountsState {
  accounts: SocialAccount[];
  isLoading: boolean;
  error: string | null;
  selectedChannelFilter: string | null;
  fetchAccounts: () => Promise<void>;
  setChannelFilter: (accountId: string | null) => void;
  removeAccount: (accountId: string) => void;
  addOrUpdateAccount: (account: SocialAccount) => void;
}

export const useSocialAccountsStore = create<SocialAccountsState>(
  (set, get) => ({
    accounts: [],
    isLoading: false,
    error: null,
    selectedChannelFilter: null,

    fetchAccounts: async () => {
      if (get().isLoading) return;
      set({ isLoading: true, error: null });
      try {
        const accounts = await listSocialAccounts();
        set({ accounts, isLoading: false });
      } catch (error) {
        set({
          error:
            error instanceof Error ? error.message : "Failed to load accounts",
          isLoading: false,
        });
      }
    },

    setChannelFilter: (accountId) => {
      set({ selectedChannelFilter: accountId });
    },

    removeAccount: (accountId) => {
      set((state) => ({
        accounts: state.accounts.filter((a) => a.id !== accountId),
        selectedChannelFilter:
          state.selectedChannelFilter === accountId
            ? null
            : state.selectedChannelFilter,
      }));
    },

    addOrUpdateAccount: (account) => {
      set((state) => {
        const existing = state.accounts.findIndex((a) => a.id === account.id);
        if (existing >= 0) {
          const updated = [...state.accounts];
          updated[existing] = account;
          return { accounts: updated };
        }
        return { accounts: [account, ...state.accounts] };
      });
    },
  }),
);
