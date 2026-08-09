import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/auth-shell";
import { RegisterForm } from "@/components/auth/register-form";
import { adminExists } from "@/lib/auth/users";
import { loadConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  if (!(await adminExists())) {
    redirect("/setup");
  }

  const config = loadConfig();

  return (
    <AuthShell
      title="Register"
      description={
        config.users.inviteOnly
          ? "Registration requires an invite code from an administrator."
          : "Create an account. An administrator must approve it before you can access the app."
      }
      footer={
        <>
          Already registered?{" "}
          <a href="/login" className="font-medium text-primary hover:underline">
            Sign in
          </a>
        </>
      }
    >
      <RegisterForm inviteOnly={config.users.inviteOnly} />
    </AuthShell>
  );
}
