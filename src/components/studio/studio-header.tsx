"use client";

import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { ModeToggle } from "@/components/layout/mode-toggle";

// Sibling of components/layout/header.tsx — forked rather than reused
// because that component's pageTitles map is hardcoded to CRM paths and
// would silently fall back to "Dashboard" for every Studio route.
const pageTitles: Record<string, string> = {
  "/studio": "Resumen",
  "/studio/calendar": "Calendario",
  "/studio/settings": "Conexiones",
};

function getPageTitle(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname];
  const match = Object.entries(pageTitles).find(([path]) =>
    pathname.startsWith(path),
  );
  return match ? match[1] : "GMVA Studio";
}

interface StudioHeaderProps {
  onOpenSidebar?: () => void;
}

export function StudioHeader({ onOpenSidebar }: StudioHeaderProps) {
  const pathname = usePathname();
  const title = getPageTitle(pathname);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-4 lg:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label="Abrir menú"
          className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <h1 className="truncate text-base font-semibold text-foreground sm:text-lg">
          {title}
        </h1>
      </div>

      <div className="flex items-center gap-1 sm:gap-2">
        <ModeToggle />
      </div>
    </header>
  );
}
