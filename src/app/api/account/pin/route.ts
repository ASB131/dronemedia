import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { getWebDb } from "@/lib/db";
import { users } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const setSchema = z.object({
  action: z.literal("set"),
  pin: z.string().regex(/^\d{4,8}$/),
  currentPassword: z.string().min(1),
});

const clearSchema = z.object({
  action: z.literal("clear"),
  currentPassword: z.string().min(1),
});

const unlockSchema = z.object({
  action: z.literal("unlock"),
  pin: z.string().regex(/^\d{4,8}$/),
});

const bodySchema = z.discriminatedUnion("action", [
  setSchema,
  clearSchema,
  unlockSchema,
]);

export async function POST(request: Request) {
  try {
    const session = await requireApprovedSession();
    const body = bodySchema.parse(await request.json());
    const db = getWebDb();

    const [user] = await db
      .select({
        passwordHash: users.passwordHash,
        pinHash: users.pinHash,
      })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);

    if (!user) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (body.action === "unlock") {
      if (!user.pinHash) {
        return NextResponse.json({ unlocked: true });
      }
      const valid = await verifyPassword(body.pin, user.pinHash);
      if (!valid) {
        return NextResponse.json({ error: "Incorrect PIN" }, { status: 401 });
      }
      return NextResponse.json({ unlocked: true });
    }

    const passwordOk = await verifyPassword(
      body.currentPassword,
      user.passwordHash,
    );
    if (!passwordOk) {
      return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
    }

    if (body.action === "clear") {
      await db
        .update(users)
        .set({ pinHash: null, updatedAt: new Date() })
        .where(eq(users.id, session.user.id));
      return NextResponse.json({ pinEnabled: false });
    }

    const pinHash = await hashPassword(body.pin);
    await db
      .update(users)
      .set({ pinHash, updatedAt: new Date() })
      .where(eq(users.id, session.user.id));
    return NextResponse.json({ pinEnabled: true });
  } catch (error) {
    return jsonError(error);
  }
}
