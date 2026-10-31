# Drone Media Companion (Android)

Native app — not a WebView. After **DJI Quick Transfer** saves media to `DCIM/DJI Album`, scan this folder, skip files already in your library, and upload the rest in full resolution.

## Install

1. On GitHub open **Releases** and download **Drone Media Companion (latest)** (`companion-latest`), or grab the APK from the latest **Build companion APK** workflow artifact on `main`.
2. Install the APK (allow installs from your browser/files app if Android prompts).
3. In Drone Media on the web: **Account → Security → Create API key** (starts with `dm_`). Copy it once.
4. In the companion: set your server URL (e.g. `https://dronemedia.asb-servers.com`), paste the API key, **Test**, then **Scan DJI Album** → **Upload**.

## Server requirement

The server must include companion API-key auth on upload routes and `GET /api/companion/ping`. Deploy the web app from the same commit as this folder before the app can connect.

## Build locally

```bash
cd companion-android
gradle wrapper --gradle-version 8.10.2
./gradlew assembleRelease
```

APK: `app/build/outputs/apk/release/app-release.apk`
