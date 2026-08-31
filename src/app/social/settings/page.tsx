import { ApiTokensSettings } from "@/components/social/ApiTokensSettings"
import { ProviderKeysSettings } from "@/components/social/ProviderKeysSettings"

export default function SettingsPage() {
  return (
    <div className="flex flex-1 flex-col divide-y">
      <ApiTokensSettings />
      <ProviderKeysSettings />
    </div>
  )
}
