import { NextResponse } from "next/server";

import { adminExists } from "@/lib/auth/users";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ adminExists: await adminExists() });
}
