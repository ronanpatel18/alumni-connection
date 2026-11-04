import { redirect } from "next/navigation";
import { Suspense } from "react";
import { DEV_LOGIN_PATH, devAutoLoginEmail } from "@/lib/dev-auto-login";
import { getViewer } from "@/lib/viewer";

async function Route() {
  const viewer = await getViewer();
  // Local development with DEV_AUTO_LOGIN_EMAIL: sign in and show everyone.
  if (!viewer && devAutoLoginEmail()) redirect(`${DEV_LOGIN_PATH}?next=/search`);
  redirect(!viewer ? "/login" : viewer.isVerified ? "/discover" : "/pending");
  return null;
}

/** The front door: members go to Discover, everyone else to sign-in or verification. */
export default function Home() {
  return (
    <Suspense>
      <Route />
    </Suspense>
  );
}
