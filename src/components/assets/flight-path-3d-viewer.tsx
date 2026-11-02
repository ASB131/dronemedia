"use client";

import { useEffect, useRef, useState } from "react";

import { useGlobeConfig } from "@/hooks/use-globe-config";
import type { LineStringGeoJson } from "@/lib/assets/telemetry";
import type { TelemetrySeriesPoint } from "@/lib/assets/telemetry";
import { loadCesium, type CesiumNamespace } from "@/lib/map/cesium-loader";
import {
  headingFromSeries,
  interpolateSeriesAtOffsetMs,
  seriesToDegreesHeights,
} from "@/lib/map/telemetry-3d";
import { cn } from "@/lib/utils";

type Props = {
  series: TelemetrySeriesPoint[];
  flightPath?: LineStringGeoJson | null;
  currentOffsetMs: number;
  homePoint?: { lat: number; lng: number } | null;
  className?: string;
  /** Hide MapTiler flat-terrain hint (e.g. when overlaid on dark stage). */
  hideTerrainHint?: boolean;
};

export function FlightPath3DViewer({
  series,
  flightPath,
  currentOffsetMs,
  homePoint,
  className,
  hideTerrainHint = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<InstanceType<CesiumNamespace["Viewer"]> | null>(null);
  const droneEntityRef = useRef<InstanceType<CesiumNamespace["Entity"]> | null>(
    null,
  );
  const cesiumRef = useRef<CesiumNamespace | null>(null);
  const initializedRef = useRef(false);
  const globeConfig = useGlobeConfig();
  const [initError, setInitError] = useState<string | null>(null);
  const [viewerReady, setViewerReady] = useState(false);

  useEffect(() => {
    if (globeConfig.loading || !containerRef.current || initializedRef.current) {
      return;
    }

    let disposed = false;
    initializedRef.current = true;

    async function initViewer() {
      try {
        const Cesium = await loadCesium();
        cesiumRef.current = Cesium;

        if (disposed || !containerRef.current) return;

        if (globeConfig.cesiumIonAccessToken) {
          Cesium.Ion.defaultAccessToken = globeConfig.cesiumIonAccessToken;
        }

        let terrainProvider: InstanceType<CesiumNamespace["TerrainProvider"]>;
        if (globeConfig.terrainMode === "cesium-ion") {
          terrainProvider = await Cesium.createWorldTerrainAsync();
        } else if (
          globeConfig.terrainMode === "maptiler" &&
          globeConfig.mapTilerTerrainUrl
        ) {
          terrainProvider = await Cesium.CesiumTerrainProvider.fromUrl(
            globeConfig.mapTilerTerrainUrl,
          );
        } else {
          terrainProvider = new Cesium.EllipsoidTerrainProvider();
        }

        const imageryLayers: InstanceType<CesiumNamespace["ImageryLayer"]>[] =
          [];
        if (globeConfig.terrainMode !== "cesium-ion") {
          const imagery = new Cesium.UrlTemplateImageryProvider({
            url: globeConfig.imageryUrlTemplate,
            minimumLevel: 0,
            maximumLevel: 19,
            credit: globeConfig.attribution,
          });
          imageryLayers.push(new Cesium.ImageryLayer(imagery));
        }

        const viewer = new Cesium.Viewer(containerRef.current, {
          animation: false,
          timeline: false,
          baseLayerPicker: false,
          geocoder: false,
          homeButton: true,
          sceneModePicker: true,
          navigationHelpButton: false,
          fullscreenButton: false,
          vrButton: false,
          infoBox: false,
          selectionIndicator: false,
          terrainProvider,
          baseLayer:
            globeConfig.terrainMode === "cesium-ion"
              ? undefined
              : imageryLayers[0],
          requestRenderMode: true,
          maximumRenderTimeChange: Infinity,
        });

        viewer.scene.globe.depthTestAgainstTerrain = true;
        viewer.cesiumWidget.creditContainer.classList.add("text-[10px]");

        const heights =
          series.length > 0
            ? seriesToDegreesHeights(series)
            : (flightPath?.coordinates.flatMap(([lng, lat]) => [lng, lat, 0]) ??
              []);

        if (heights.length >= 6) {
          viewer.entities.add({
            name: "Flight path",
            polyline: {
              positions: Cesium.Cartesian3.fromDegreesArrayHeights(heights),
              width: 4,
              material: Cesium.Color.fromCssColorString("#4250AF").withAlpha(
                0.95,
              ),
              clampToGround: false,
            },
          });
        }

        if (homePoint) {
          viewer.entities.add({
            name: "Home",
            position: Cesium.Cartesian3.fromDegrees(
              homePoint.lng,
              homePoint.lat,
              0,
            ),
            point: {
              pixelSize: 10,
              color: Cesium.Color.fromCssColorString("#22c55e"),
              outlineColor: Cesium.Color.WHITE,
              outlineWidth: 2,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            },
            label: {
              text: "Home",
              font: "12px sans-serif",
              fillColor: Cesium.Color.WHITE,
              outlineColor: Cesium.Color.BLACK,
              outlineWidth: 2,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
              pixelOffset: new Cesium.Cartesian2(0, -14),
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            },
          });
        }

        droneEntityRef.current = viewer.entities.add({
          name: "Drone",
          position: Cesium.Cartesian3.fromDegrees(0, 0, 0),
          point: {
            pixelSize: 14,
            color: Cesium.Color.fromCssColorString("#f97316"),
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
          },
        });

        if (heights.length >= 6) {
          const positions = Cesium.Cartesian3.fromDegreesArrayHeights(heights);
          const sphere = Cesium.BoundingSphere.fromPoints(positions);
          viewer.camera.flyToBoundingSphere(sphere, {
            duration: 0,
            offset: new Cesium.HeadingPitchRange(
              0,
              Cesium.Math.toRadians(-35),
              Math.max(sphere.radius * 2.5, 120),
            ),
          });
        }

        viewerRef.current = viewer;
        if (!disposed) {
          setViewerReady(true);
          setInitError(null);
        }
      } catch (error) {
        initializedRef.current = false;
        if (!disposed) {
          setInitError(
            error instanceof Error ? error.message : "3D viewer failed to load",
          );
        }
      }
    }

    void initViewer();

    return () => {
      disposed = true;
      viewerRef.current?.destroy();
      viewerRef.current = null;
      droneEntityRef.current = null;
      cesiumRef.current = null;
      initializedRef.current = false;
      setViewerReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init once when globe config arrives
  }, [globeConfig.loading, globeConfig.terrainMode]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const drone = droneEntityRef.current;
    const Cesium = cesiumRef.current;
    if (!viewer || !drone || !Cesium || !viewerReady) return;

    const pos =
      interpolateSeriesAtOffsetMs(series, currentOffsetMs) ??
      (flightPath?.coordinates.length
        ? {
            lat: flightPath.coordinates[0]![1],
            lng: flightPath.coordinates[0]![0],
            altMeters: 0,
          }
        : null);

    if (!pos) return;

    drone.position = new Cesium.ConstantPositionProperty(
      Cesium.Cartesian3.fromDegrees(pos.lng, pos.lat, pos.altMeters),
    );

    const heading = headingFromSeries(series, currentOffsetMs);
    if (heading != null) {
      drone.orientation = new Cesium.ConstantProperty(
        Cesium.Transforms.headingPitchRollQuaternion(
          Cesium.Cartesian3.fromDegrees(pos.lng, pos.lat, pos.altMeters),
          new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(heading), 0, 0),
        ),
      );
    }

    viewer.scene.requestRender();
  }, [series, currentOffsetMs, flightPath, viewerReady]);

  if (initError) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-xl border border-border bg-muted/30 p-4 text-center text-xs text-muted-foreground",
          className,
        )}
      >
        {initError}
      </div>
    );
  }

  return (
    <div className={cn("relative overflow-hidden", className)}>
      <div ref={containerRef} className="h-full w-full min-h-[200px]" />
      {globeConfig.loading || !viewerReady ? (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/40 text-xs text-muted-foreground">
          Loading 3D globe…
        </div>
      ) : null}
      {globeConfig.usingFallbackTerrain && viewerReady && !hideTerrainHint ? (
        <p className="pointer-events-none absolute bottom-1 left-2 right-2 text-[10px] text-muted-foreground/90">
          Flat terrain — set MapTiler in config.yml (map.provider + apiKey) for
          hills.
        </p>
      ) : null}
    </div>
  );
}
