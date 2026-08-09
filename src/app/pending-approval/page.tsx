import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { signOutAction } from "@/actions/auth";

export default function PendingApprovalPage() {
  return (
    <AuthShell
      title="Waiting for approval"
      description="Your account has been created. An administrator must approve your registration before you can access Drone Media."
    >
      <form action={signOutAction}>
        <Button type="submit" variant="outline" className="w-full">
          Sign out
        </Button>
      </form>
    </AuthShell>
  );
}
