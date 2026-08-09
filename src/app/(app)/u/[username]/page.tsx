import { Suspense } from "react";

import { PublicProfileView } from "@/components/profiles/public-profile-view";

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          Loading profile…
        </div>
      }
    >
      <PublicProfileView username={username} />
    </Suspense>
  );
}
