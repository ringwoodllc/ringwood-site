# Build in the cloud with Codemagic (no Mac)

The build config lives at the repo root: `codemagic.yaml`. It has two workflows:
**android** (free, no accounts, gives you an installable APK) and **ios** (cloud
Mac -> TestFlight, needs the Apple account + an API key). Do these once.

## 0. Sign up and connect the repo
1. Go to https://codemagic.io and sign up (free) with your GitHub.
2. Add the application -> pick the **ringwoodllc/ringwood-site** repository.
3. Choose "yaml" configuration (it will find `codemagic.yaml` automatically).

## 1. Android first (zero accounts, ~10 min)
1. In Codemagic, open the **"Ringwood Android (APK)"** workflow and click
   **Start new build**.
2. When it finishes, download the **app-debug.apk** artifact.
3. Email/AirDrop it to an Android phone, tap to install (allow "install from
   this source"). It opens the live Ringwood app. This is your proof it works,
   with no Google account yet.

When you're ready for the Play Store, you'll create a keystore + a Play service
account and switch the build to `bundleRelease` (I can wire that when you get there).

## 2. iOS via TestFlight (needs the $99 Apple account)
1. Join the **Apple Developer Program**: https://developer.apple.com/programs ($99/yr).
2. In **App Store Connect** (https://appstoreconnect.apple.com):
   - **Apps -> +** -> create the app. Bundle ID **ai.ringwood.app**, name
     "Ringwood".
   - **Users and Access -> Integrations -> App Store Connect API** -> generate a
     key with **App Manager** access. Download the **.p8** file and copy the
     **Key ID** and **Issuer ID** (you can't re-download the .p8, so save it).
3. In **Codemagic**: **Teams -> Integrations -> App Store Connect -> Connect**,
   upload the .p8 with the Key ID + Issuer ID, and **name it `ringwood_asc`**
   (must match `codemagic.yaml`).
4. Open the **"Ringwood iOS (TestFlight)"** workflow -> **Start new build**.
   Codemagic builds on a cloud Mac, signs with your key, and uploads to
   TestFlight. No Mac on your end.
5. In App Store Connect -> **TestFlight**, add yourself/crew as testers; install
   the **TestFlight** app on the iPhone and accept the invite.

## Cost reality
- Codemagic: **free** tier = 500 Mac-minutes/month. An iOS build is ~10-15 min,
  so that's roughly 30+ builds/month free. Android builds run on free Linux
  minutes.
- Apple Developer: **$99/year** (only thing you must buy for iOS).
- Google Play: **$25 once** (only when you want a public Android listing; not
  needed for the sideload APK above).

## After it's live
Both apps load https://app.ringwood.ai, so your normal push-to-main deploys
update the installed apps instantly. You only rerun a Codemagic build when you
change the native shell (icon, name, permissions, plugins).

## Note
`codemagic.yaml` is a solid starting point but CI configs sometimes need a small
tweak on the first real run (Xcode/Gradle versions move). If a build fails, send
me the failing step's log and I'll adjust the yaml.
