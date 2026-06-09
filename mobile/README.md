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
