import { cookies } from "next/headers";

export async function POST() {
  cookies().delete("drishti_session");
  return Response.json({ ok: true });
}
