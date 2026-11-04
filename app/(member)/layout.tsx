import { Suspense } from "react";
import { AccountBlock, AdminNav, SavedCount } from "@/components/account-block";
import { AppFrame } from "@/components/app-frame";

export default function MemberLayout({ children }: LayoutProps<"/">) {
  // AppFrame reads the URL (active nav item), which must sit inside a Suspense boundary.
  return (
    <Suspense>
    <AppFrame
      account={
        <Suspense fallback={null}>
          <AccountBlock />
        </Suspense>
      }
      admin={
        <Suspense fallback={null}>
          <AdminNav />
        </Suspense>
      }
      savedCount={
        <Suspense fallback={null}>
          <SavedCount />
        </Suspense>
      }
    >
      {children}
    </AppFrame>
    </Suspense>
  );
}
