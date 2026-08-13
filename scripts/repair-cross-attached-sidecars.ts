#!/usr/bin/env tsx
import { closeDbPools } from "@/lib/db";
import { closeQueues } from "@/lib/jobs/queues";
import {
  applyCrossAttachedSidecarRepairs,
  planCrossAttachedSidecarRepairs,
} from "@/lib/assets/repair-cross-attached-sidecars";
import { loadConfig } from "@/lib/config";

async function main() {
  loadConfig();
  const apply = process.argv.includes("--apply");
  if (!apply) {
    const { groups } = await planCrossAttachedSidecarRepairs();
    const actionable = groups.filter((g) =>
      g.actions.some((a) => a.detachSrt || a.detachLrf),
    );
    console.log(
      JSON.stringify(
        {
          conflictStems: groups.length,
          stemsNeedingDetach: actionable.length,
          groups,
        },
        null,
        2,
      ),
    );
    return;
  }

  const result = await applyCrossAttachedSidecarRepairs();
  console.log(
    JSON.stringify(
      {
        detached: result.detached,
        thumbsQueued: result.thumbsQueued,
        srtQueued: result.srtQueued,
        flagsCleared: result.flagsCleared,
        stems: result.groups.length,
      },
      null,
      2,
    ),
  );
}

main()
  .catch(async (error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeQueues().catch(() => undefined);
    await closeDbPools().catch(() => undefined);
    process.exit(process.exitCode ?? 0);
  });
