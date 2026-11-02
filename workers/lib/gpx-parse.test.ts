import assert from "node:assert/strict";
import test from "node:test";

import { parseGpx } from "./gpx-parse";

test("parseGpx extracts track points with time offsets", () => {
  const xml = `<?xml version="1.0"?>
<gpx>
  <trk><trkseg>
    <trkpt lat="51.5" lon="-0.12"><ele>10</ele><time>2024-01-01T12:00:00Z</time></trkpt>
    <trkpt lat="51.501" lon="-0.121"><ele>12</ele><time>2024-01-01T12:00:05Z</time></trkpt>
  </trkseg></trk>
</gpx>`;
  const points = parseGpx(xml);
  assert.equal(points.length, 2);
  assert.equal(points[0]!.lat, 51.5);
  assert.equal(points[0]!.lng, -0.12);
  assert.equal(points[1]!.startMs, 5000);
});
