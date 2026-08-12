import { NextResponse } from "next/server";
import { z } from "zod";

import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import { dismissDuplicateGroup } from "@/lib/assets/mutations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  kind: z.enum(["exact", "near"]),
  hash: z.string().min(1),
  assetIds: z.array(z.string().uuid()).min(2),
});

export async function POST(request: Request) {
  try {
    const session = await requireApprovedSession();
    const body = bodySchema.parse(await request.json());
    await dismissDuplicateGroup({
      userId: session.user.id,
      kind: body.kind,
      hash: body.hash,
      assetIds: body.assetIds,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
