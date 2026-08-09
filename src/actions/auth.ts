"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";

import { signIn } from "@/auth";
import { hashPassword } from "@/lib/auth/password";
import { markInviteUsed, validateInviteCode } from "@/lib/auth/invites";
import {
  adminExists,
  createFirstAdmin,
  registerUser,
} from "@/lib/auth/users";
import {
  loginSchema,
  registerSchema,
  setupSchema,
  type AuthFormState,
} from "@/lib/auth/validators";
import { loadConfig } from "@/lib/config";

function formDataToObject(formData: FormData): Record<string, string> {
  return Object.fromEntries(
    [...formData.entries()].map(([key, value]) => [key, String(value)]),
  );
}

function fieldErrorsFromZod(
  issues: { path: PropertyKey[]; message: string }[],
): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "form");
    fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message];
  }
  return fieldErrors;
}

export async function setupAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (await adminExists()) {
    redirect("/login");
  }

  const parsed = setupSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFromZod(parsed.error.issues) };
  }

  try {
    const passwordHash = await hashPassword(parsed.data.password);
    await createFirstAdmin({
      username: parsed.data.username,
      email: parsed.data.email,
      passwordHash,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "SETUP_ALREADY_COMPLETE") {
      redirect("/login");
    }
    return { error: "Could not complete setup. Please try again." };
  }

  await signIn("credentials", {
    username: parsed.data.username,
    password: parsed.data.password,
    redirectTo: "/",
  });

  return { success: true };
}

export async function registerAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!(await adminExists())) {
    redirect("/setup");
  }

  const parsed = registerSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFromZod(parsed.error.issues) };
  }

  const config = loadConfig();
  let inviteId: string | undefined;

  if (config.users.inviteOnly) {
    if (!parsed.data.inviteCode) {
      return { fieldErrors: { inviteCode: ["Invite code is required."] } };
    }
    const inviteResult = await validateInviteCode(parsed.data.inviteCode);
    if (!inviteResult.ok) {
      return { fieldErrors: { inviteCode: [inviteResult.error] } };
    }
    inviteId = inviteResult.invite.id;
  } else if (parsed.data.inviteCode) {
    const inviteResult = await validateInviteCode(parsed.data.inviteCode);
    if (inviteResult.ok) {
      inviteId = inviteResult.invite.id;
    }
  }

  try {
    const passwordHash = await hashPassword(parsed.data.password);
    const user = await registerUser({
      username: parsed.data.username,
      email: parsed.data.email,
      passwordHash,
      inviteId,
    });

    if (inviteId) {
      await markInviteUsed(inviteId, user.id);
    }
  } catch (error) {
    const pgCode =
      error &&
      typeof error === "object" &&
      "cause" in error &&
      error.cause &&
      typeof error.cause === "object" &&
      "code" in error.cause
        ? String(error.cause.code)
        : error &&
            typeof error === "object" &&
            "code" in error
          ? String(error.code)
          : undefined;

    if (pgCode === "23505") {
      return { error: "Username or email is already registered." };
    }
    return { error: "Registration failed. Please try again." };
  }

  await signIn("credentials", {
    username: parsed.data.username,
    password: parsed.data.password,
    redirectTo: "/pending-approval",
  });

  return { success: true };
}

export async function loginAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = loginSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFromZod(parsed.error.issues) };
  }

  const callbackUrl = formData.get("callbackUrl");
  const redirectTo =
    typeof callbackUrl === "string" && callbackUrl.startsWith("/")
      ? callbackUrl
      : "/";

  try {
    await signIn("credentials", {
      username: parsed.data.username,
      password: parsed.data.password,
      redirectTo,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.type === "CredentialsSignin") {
        const code = (error as AuthError & { code?: string }).code;
        if (code === "rate_limit") {
          return {
            error:
              "Too many failed login attempts. Please wait and try again.",
          };
        }
        if (code === "rejected") {
          return {
            error:
              "Your account registration was rejected. Contact an administrator.",
          };
        }
        return { error: "Invalid username or password." };
      }
    }
    throw error;
  }

  return { success: true };
}

export async function signOutAction(): Promise<void> {
  const { signOut } = await import("@/auth");
  await signOut({ redirectTo: "/login" });
}
