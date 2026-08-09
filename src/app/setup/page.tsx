import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/auth-shell";
import { SetupForm } from "@/components/auth/setup-form";
import { adminExists } from "@/lib/auth/users";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (await adminExists()) {
    redirect("/login");
  }

  return (
    <AuthShell
      title="Welcome to Drone Media"
      description="Create the administrator account for this instance. This runs once on first boot."
    >
      <SetupForm />
    </AuthShell>
  );
}
