import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { AppShell } from "@/components/layout/app-shell";
import { adminExists } from "@/lib/auth/users";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await adminExists())) {
    redirect("/setup");
  }

  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  if (session.user.approvalStatus === "pending") {
    redirect("/pending-approval");
  }

  if (session.user.approvalStatus === "rejected") {
    redirect("/login?error=rejected");
  }

  return <AppShell user={session.user}>{children}</AppShell>;
}
