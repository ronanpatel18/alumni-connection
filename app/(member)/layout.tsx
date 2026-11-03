import { Suspense } from "react";
import { AccountBlock, SavedCount } from "@/components/account-block";
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
