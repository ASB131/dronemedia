import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";
import { adminExists } from "@/lib/auth/users";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  if (!(await adminExists())) {
    redirect("/setup");
  }

  const params = await searchParams;
  const rejectedError =
    params.error === "rejected"
      ? "Your account registration was rejected. Contact an administrator."
      : undefined;

  return (
    <AuthShell
      title="Sign in"
      description="Enter your credentials to access your library."
      footer={
        <>
          New here?{" "}
          <a href="/register" className="font-medium text-primary hover:underline">
            Register
          </a>
        </>
      }
    >
      {rejectedError ? (
        <p className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {rejectedError}
        </p>
      ) : null}
      <LoginForm callbackUrl={params.callbackUrl} />
    </AuthShell>
  );
}
