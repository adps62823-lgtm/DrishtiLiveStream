import { NextResponse } from "next/server";

export function middleware(request) {
  const session = request.cookies.get("drishti_session");

  if (!session || session.value !== "authenticated") {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/watch"],
};
