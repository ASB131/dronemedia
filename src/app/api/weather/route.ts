import { NextResponse } from "next/server";

import { jsonError, requireApprovedSession } from "@/lib/api/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Historical weather at capture time via Open-Meteo (no API key). */
export async function GET(request: Request) {
  try {
    await requireApprovedSession();
    const url = new URL(request.url);
    const lat = Number(url.searchParams.get("lat"));
    const lng = Number(url.searchParams.get("lng"));
    const at = url.searchParams.get("at");
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !at) {
      return NextResponse.json(
        { error: "lat, lng, and at are required" },
        { status: 400 },
      );
    }

    const when = new Date(at);
    if (Number.isNaN(when.getTime())) {
      return NextResponse.json({ error: "Invalid at timestamp" }, { status: 400 });
    }

    const date = when.toISOString().slice(0, 10);
    const endpoint = new URL("https://archive-api.open-meteo.com/v1/archive");
    endpoint.searchParams.set("latitude", String(lat));
    endpoint.searchParams.set("longitude", String(lng));
    endpoint.searchParams.set("start_date", date);
    endpoint.searchParams.set("end_date", date);
    endpoint.searchParams.set("hourly", "temperature_2m,windspeed_10m,winddirection_10m,weathercode");
    endpoint.searchParams.set("timezone", "UTC");

    const response = await fetch(endpoint.toString(), {
      next: { revalidate: 86_400 },
    });
    if (!response.ok) {
      return NextResponse.json(
        { error: "Weather provider unavailable" },
        { status: 502 },
      );
    }

    const payload = (await response.json()) as {
      hourly?: {
        time?: string[];
        temperature_2m?: Array<number | null>;
        windspeed_10m?: Array<number | null>;
        winddirection_10m?: Array<number | null>;
        weathercode?: Array<number | null>;
      };
    };

    const times = payload.hourly?.time ?? [];
    const targetMs = when.getTime();
    let bestIdx = 0;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (let i = 0; i < times.length; i += 1) {
      const delta = Math.abs(new Date(times[i]!).getTime() - targetMs);
      if (delta < bestDelta) {
        bestDelta = delta;
        bestIdx = i;
      }
    }

    return NextResponse.json({
      at: times[bestIdx] ?? when.toISOString(),
      temperatureC: payload.hourly?.temperature_2m?.[bestIdx] ?? null,
      windSpeedKmh: payload.hourly?.windspeed_10m?.[bestIdx] ?? null,
      windDirectionDeg: payload.hourly?.winddirection_10m?.[bestIdx] ?? null,
      weatherCode: payload.hourly?.weathercode?.[bestIdx] ?? null,
      source: "open-meteo",
    });
  } catch (error) {
    return jsonError(error);
  }
}