import { cookies } from "next/headers";

export async function GET() {
  const session = cookies().get("drishti_session");

  if (!session || session.value !== "authenticated") {
    return Response.json({ error: "Not logged in" }, { status: 401 });
  }

  const secret = process.env.SIGNALING_SECRET;
  const signalingUrl = process.env.NEXT_PUBLIC_SIGNALING_URL;

  if (!secret || !signalingUrl) {
    return Response.json(
      { error: "Server misconfigured: SIGNALING_SECRET or NEXT_PUBLIC_SIGNALING_URL not set" },
      { status: 500 }
    );
  }

  // Only reachable after a valid login - this is why the secret isn't
  // just hardcoded in the client-side bundle.
  return Response.json({ secret, signalingUrl });
}
