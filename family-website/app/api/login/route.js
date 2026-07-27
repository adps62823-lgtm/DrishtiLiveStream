import { cookies } from "next/headers";

export async function POST(request) {
  const { password } = await request.json();
  const correctPassword = process.env.FAMILY_PASSWORD;

  if (!correctPassword) {
    return Response.json(
      { error: "Server misconfigured: FAMILY_PASSWORD not set" },
      { status: 500 }
    );
  }

  if (password !== correctPassword) {
    return Response.json({ error: "Incorrect password" }, { status: 401 });
  }

  // Session cookie is just a marker, not the password itself - kept
  // separate from SIGNALING_SECRET (see /api/signaling-token), which is
  // what actually authenticates to the signaling server.
  cookies().set("drishti_session", "authenticated", {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  return Response.json({ ok: true });
}
