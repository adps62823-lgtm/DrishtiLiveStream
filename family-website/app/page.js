import { redirect } from "next/navigation";
import { cookies } from "next/headers";

export default function RootPage() {
  const session = cookies().get("drishti_session");
  if (session && session.value === "authenticated") {
    redirect("/watch");
  }
  redirect("/login");
}
