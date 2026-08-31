import Link from "next/link"
import Image from "next/image"
import { LanguageSwitcher } from "@/components/LanguageSwitcher"

interface HomeHeaderProps {
  signInUrl: string
  signUpUrl: string
}

export function HomeHeader({ signInUrl, signUpUrl }: HomeHeaderProps) {
  return (
    <header className="h-11 bg-neutral-900 border-b border-neutral-800 flex items-center justify-between px-4 shrink-0 sticky top-0 z-50">
      <div className="flex items-center gap-2">
        <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <Image src="/logo-node.svg" alt="" width={48} height={48} />
          <span className="text-2xl font-semibold text-neutral-100 tracking-tight">
            Tasmeemai
          </span>
        </Link>
      </div>

      <div className="flex items-center gap-3 text-xs">
        <LanguageSwitcher className="text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800" />
        <Link
          href={signInUrl}
          className="text-neutral-400 hover:text-neutral-200 transition-colors"
        >
          Sign in
        </Link>
        <Link
          href={signUpUrl}
          className="text-neutral-400 hover:text-neutral-200 transition-colors"
        >
          Sign up
        </Link>
      </div>
    </header>
  )
}
