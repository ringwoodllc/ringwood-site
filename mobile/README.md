# Ringwood mobile (iOS + Android)

This is a thin native shell, built with [Capacitor](https://capacitorjs.com),
that wraps the live web app at **https://app.ringwood.ai**. The app is the same
field-ops tool you use in the browser — tickets, assets, service, QR lookup,
login — running inside a native iOS/Android container. Because it loads the
deployed site, every web deploy updates the app instantly. No app-store review
needed for day-to-day changes; you only resubmit when you change the native
shell (icon, name, permissions, plugins).

## One-time setup (on a Mac for iOS; Mac/Windows/Linux for Android)

You need Node, and for iOS: Xcode. For Android: Android Studio.

```bash
cd mobile
npm install
npx cap add ios        # creates the ios/ Xcode project
npx cap add android    # creates the android/ project
npx cap sync           # pulls config into both
```

## Run / test

```bash
npm run ios       # opens Xcode -> pick a simulator or your iPhone -> Run
npm run android   # opens Android Studio -> Run
```

## Camera & photos (required for the asset/ticket photo features)

In Xcode, open `ios/App/App/Info.plist` and add:

- `NSCameraUsageDescription` = "Ringwood uses the camera to photograph equipment and tickets."
- `NSPhotoLibraryUsageDescription` = "Ringwood attaches photos to assets and tickets."
- `NSPhotoLibraryAddUsageDescription` = "Ringwood saves photos you capture."

Android picks these up automatically; nothing to add.

The web app ships `/native-camera.js`, which detects the native shell and adds a
"Take photo" button (using the `@capacitor/camera` plugin) beside each photo
field, feeding the capture back through the normal flow. On the web / PWA it
does nothing, so the same site works everywhere. After `npm install` the camera
plugin is included; run `npx cap sync` so the native projects pick it up.

## App identity

- App ID: `ai.ringwood.app`  (change in `capacitor.config.json` before first build if you want a different bundle id)
- App name: `Ringwood`
- Icon / splash: drop a 1024x1024 PNG and run `npx @capacitor/assets generate` (install `@capacitor/assets` first), or set them by hand in Xcode / Android Studio.

## Submit

- iOS: in Xcode, set your Team (Apple Developer account), bump the version/build,
  Product -> Archive -> Distribute App -> App Store Connect. Then submit for
  review in App Store Connect.
- Android: in Android Studio, Build -> Generate Signed Bundle (AAB), upload to
  the Google Play Console.

## Note on review

Apple's guideline 4.2 can flag apps that are "just a website." Ringwood is a
real tool (login, camera capture, AI nameplate reading, offline shell), which is
the kind of functionality that clears that bar. If review pushes back, the usual
fix is to lean on the native capabilities (camera, push) rather than presenting
as a plain web view.

---

## Before the native build: the app is already an installable PWA

The web app now ships a web manifest (`/manifest.json`) and a service worker
(`/sw.js`), so it installs and runs offline-capable with no app store at all:

- **Android (Chrome):** open https://app.ringwood.ai, menu -> "Install app" (or
  the install prompt). It lands on the home screen, runs full screen, and
  updates instantly with every web deploy.
- **iPhone (Safari):** open the site, Share -> "Add to Home Screen".

For internal crews and pilot clients this is the fastest path: zero review,
instant updates, free. Use the native builds below when you want a store listing
or TestFlight / Play distribution.

## Accounts and tools you need for the store builds

| Need | iOS | Android |
|------|-----|---------|
| Developer account | Apple Developer Program, **$99/year** | Google Play Console, **$25 one-time** |
| Build machine | **Mac** with Xcode (or a cloud Mac like Codemagic) | Android Studio on **any OS**, free |
| Review time | usually < 24h | usually a few hours to ~1 day |
| Test track | TestFlight (100 internal, ~no review; 10k external, light review) | Play Internal Testing / Internal App Sharing (near-instant) |

## Android-only options worth knowing

- **Direct APK:** Android Studio -> Build -> Generate Signed Bundle/APK. You can
  hand the APK/AAB straight to a client to sideload, no Play listing needed.
- **TWA (Trusted Web Activity):** because the PWA is solid, you can wrap the PWA
  into a Play-store app with [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap)
  (`npx @bubblewrap/cli init --manifest https://app.ringwood.ai/manifest.json`).
  Lighter, but Capacitor is the better choice if you want native camera/push
  later, so stick with Capacitor unless you specifically want the TWA route.

## Keeping the "instant deploy" flexibility

Both shells load the live site (`server.url` in `capacitor.config.json`), so
your normal push-to-main deploy updates the installed apps with no resubmission.
You only resubmit for native changes: icon, name, permissions, plugins, or a new
OS minimum. If you later bundle web assets in the binary, add an OTA layer
(Capacitor Live Updates / Capgo) to keep that instant-update behavior.
