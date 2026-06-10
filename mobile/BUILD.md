# Build & ship Ringwood (Android + iOS)

This is the do-this checklist. The project is already configured: it wraps the
live site (`https://app.ringwood.ai`), has the icon/splash artwork in `assets/`,
and includes the camera plugin. You run the commands below on your own machine.

A cloud build server can't produce these binaries: iOS needs a Mac, and both
need signing keys that live on your machine / accounts.

---

## What you need to buy / have

| | Cost | Notes |
|---|---|---|
| **Google Play Developer account** | **$25 one-time** | Required to list on Play. Not needed if you only sideload an APK. |
| **Apple Developer Program** | **$99 / year** | Required for TestFlight and the App Store. |
| **A Mac** | (you provide) | Only for iOS. Any recent Mac with **Xcode** (free from the Mac App Store). No Mac? Use a cloud Mac (Codemagic, MacStadium) or skip iOS for now. |
| **Android Studio** | free | Any OS (Mac/Windows/Linux). For the Android build. |
| **Node.js 18+** | free | To run the Capacitor CLI. |

You do **not** need to buy anything to keep using the installable PWA.

---

## One-time project setup

```bash
cd mobile
npm install                 # installs Capacitor + camera + assets tooling
npm run assets              # turns assets/icon.png + splash.png into every size
npx cap add android         # creates the android/ project
npx cap add ios             # creates the ios/ project (Mac only)
npx cap sync                # wires config + plugins into both
```

`npm run assets` regenerates all icon/splash sizes from the masters in
`assets/`. Re-run it any time you change the artwork.

---

## Android (easiest first — no Mac, $25, fast review)

```bash
npx cap open android        # opens Android Studio
```

In Android Studio:
1. Let Gradle finish syncing.
2. **Run** on an emulator or a plugged-in phone to test.
3. To ship: **Build > Generate Signed Bundle / APK**.
   - First time, create a **keystore** and keep it safe (you sign every future
     update with it; losing it means you can't update the app).
   - Choose **Android App Bundle (.aab)** for Play, or **APK** to hand a client
     directly.
4. Upload the `.aab` at https://play.google.com/console -> your app -> a release
   track. Start with **Internal testing** (live in minutes, no public review)
   before **Production**.

Camera permission is added automatically from the plugin. No manual edits.

## iOS (Mac required, $99/yr)

```bash
npx cap open ios            # opens Xcode
```

In Xcode:
1. Select the **App** target -> **Signing & Capabilities** -> pick your **Team**
   (your Apple Developer account). Xcode provisions automatically.
2. Add the camera/photo usage strings to **Info** (so the app explains why it
   needs the camera):
   - `NSCameraUsageDescription` = "Ringwood uses the camera to photograph equipment and tickets."
   - `NSPhotoLibraryUsageDescription` = "Ringwood attaches photos to assets and tickets."
   - `NSPhotoLibraryAddUsageDescription` = "Ringwood saves photos you capture."
3. **Run** on a simulator or your iPhone to test.
4. To ship: set a build number, **Product > Archive**, then **Distribute App ->
   App Store Connect**.
5. In https://appstoreconnect.apple.com create the app record, then push the
   build to **TestFlight** (internal testers, near-instant) or submit for App
   Store review.

---

## After it's live: you keep your instant deploys

Both apps load the live site, so your normal "push to main" deploy updates the
installed apps on next open. You only rebuild and resubmit when you change the
**native shell**: app icon, name, permissions, plugins, or a new OS minimum.

## Recommended order

1. **PWA** (already live) for your own crews today.
2. **Android Internal testing** ($25, no Mac) — your first real installable build.
3. **iOS TestFlight** when you have a Mac.
4. **Public store listings** when you want discoverability.
