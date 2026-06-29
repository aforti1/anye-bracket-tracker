import { NextRequest, NextResponse } from "next/server";
import { getBracketDetail } from "@/lib/get-bracket-detail";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ hash: string }> }
) {
  const { hash: rawHash } = await params;
  const bracket = await getBracketDetail(rawHash.toUpperCase(), "mens");
  if (!bracket) {
    return NextResponse.json({ error: "Bracket not found" }, { status: 404 });
  }
  return NextResponse.json(bracket);
}