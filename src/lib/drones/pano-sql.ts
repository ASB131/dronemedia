import { sql, type SQL } from "drizzle-orm";

import { assets } from "@/lib/db/schema";

/**
 * SQL expression approximating {@link effectivePanoramaViewer}:
 * returns '180' | '360' | 'photo'.
 */
export function effectivePanoramaViewerSql(): SQL {
  const viewer = sql`coalesce(${assets.mediaMetadata}->>'panoramaViewer', '')`;
  const sphere = sql`coalesce(${assets.mediaMetadata}->>'panoramaSphere', '')`;
  const ratio = sql`(
    nullif(${assets.mediaMetadata}->>'panoramaWidth', '')::double precision
    / nullif(
      nullif(${assets.mediaMetadata}->>'panoramaHeight', '')::double precision,
      0
    )
  )`;

  return sql`(
    case
      when ${viewer} in ('180', '360', 'photo') then ${viewer}
      when ${assets.assetType} = 'sequence'
        and ${assets.sequenceKind} = 'panorama'
        then case when ${sphere} = 'false' then '180' else '360' end
      when ${assets.assetType} = 'photo' and ${sphere} = 'true' then '360'
      when ${assets.assetType} = 'photo' and ${sphere} = 'false' then '180'
      when ${assets.assetType} = 'photo'
        and ${ratio} between 1.9 and 2.1 then '360'
      when ${assets.assetType} = 'photo'
        and ${ratio} > 1.2 then '180'
      else 'photo'
    end
  )`;
}
