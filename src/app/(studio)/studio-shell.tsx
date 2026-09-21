"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { StudioSidebar } from "@/components/studio/studio-sidebar";
import { StudioHeader } from "@/components/studio/studio-header";
import { AccountAccessAlert } from "@/components/layout/account-access-alert";

// Studio's own shell — deliberately a sibling of (dashboard)/dashboard-shell.tsx
// rather than a shared component, so the two app surfaces can diverge freely
// (different nav, different chrome) while both sitting on the same
// AuthProvider/useAuth session — one login, two "apps".

function StudioShellInner({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Cargando...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <StudioSidebar open={sidebarOpen} onClose={closeSidebar} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <StudioHeader onOpenSidebar={() => setSidebarOpen(true)} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <AccountAccessAlert />
          {children}
        </main>
      </div>
    </div>
  );
}

export function StudioShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <StudioShellInner>{children}</StudioShellInner>
    </AuthProvider>
  );
}
