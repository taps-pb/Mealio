# Mealio for Android (private sideload)

This is an online-only Android WebView shell for `https://mealio-two.vercel.app/`. It is **not** a separate nutrition app: the existing private owner login, meal data, and server-side estimates still live on the website. Website changes appear without rebuilding the APK; changes to the wrapper or icon require a newly signed APK.

Only this HTTPS host can navigate inside the WebView. Other HTTPS links open the system browser; HTTP, local files, custom schemes, third-party cookies, mixed content, WebView file access and JavaScript bridges are disabled. First-party session cookies are allowed, and Android backup is disabled. Do not put credentials in the app or the repository. Android 8.0+ (API 26) is required.

## Build

Install JDK 17, Android SDK platform 35 and build-tools 35.0.0. Set `JAVA_HOME` to the JDK and `ANDROID_HOME` to the SDK. Keep a **persistent** signing keystore and its password file outside the Git repository (for example, in `../.secrets/` relative to the repo). Protect both with owner-only permissions, keep a secure backup, and never commit or share them. Losing the signing key means future APK updates cannot install over the previous version.

Set `MEALIO_KEYSTORE` to the keystore path, `MEALIO_STOREPASS_FILE` to a file containing the password, and run `bash android/build-apk.sh`. By default the signed APK is written to `../worktree/Mealio-Android-v2.apk`, **outside** this Git repository. `OUTPUT_APK` can override this path. `android/build.*` intermediates are ignored by Git. The script verifies the APK signature after signing. Bump `android:versionCode` in `android/AndroidManifest.xml` before distributing another update.

The hand-drawn four-color icon is in `android/icon.svg` and `android/icon-foreground.svg`; their rasterized Android resources are under `android/res/`. It follows the existing light palette and the four meal-ring arcs. The design-only HTML preview is in the private parent `plan/android-icon-preview.html`.

To install, transfer the APK to your Android phone, open it, and allow your file manager to install unknown apps when Android prompts. Only install a file you obtained directly from this build; sideloaded apps are not vetted by the Play Store. Test login/logout, estimate → correct → save → history → edit → delete, Back navigation and an offline/retry cycle on the actual device. The APK has not been Play Store reviewed.

In History, tapping **Export shown meals · PDF** opens Android's document picker. Choose a destination for the private PDF; the app downloads only the authenticated Mealio export from its exact HTTPS host, checks the PDF response, and writes it to that destination. It does not silently write to public Downloads. Keep exported PDFs private, and check export/login/offline behavior on a real phone after installing the new APK.
