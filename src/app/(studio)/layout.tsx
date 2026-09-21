import type { Metadata } from "next";
import { StudioShell } from "./studio-shell";

// Same noindex stance as (dashboard)/layout.tsx — this is an authed app
// surface, never meant to be crawled or linked publicly.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export default function StudioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <StudioShell>{children}</StudioShell>;
}
