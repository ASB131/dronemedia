import { Suspense } from "react";

import { CommunityView } from "@/components/profiles/community-view";

export default function CommunityPage() {
  return (
    <Suspense
      fallback={
        <div className="p-4 text-sm text-muted-foreground">
          Loading community…
        </div>
      }
    >
      <CommunityView />
    </Suspense>
  );
}