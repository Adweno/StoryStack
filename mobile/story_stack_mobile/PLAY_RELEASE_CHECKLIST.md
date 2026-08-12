# Google Play Release Checklist

## Automated checks completed

- Production npm dependencies have no known audit findings.
- Server tests pass.
- Web production build passes.
- Flutter analyzer and widget tests pass when the Flutter SDK is available.
- Android debug build passes.
- Android Auto service is permission-protected.
- Release builds refuse to use the debug signing key.

## Required before upload

- Create a private upload keystore and fill in `android/key.properties` from
  `android/key.properties.example`.
- Create the app in Google Play Console and enable Play App Signing.
- Build and inspect the signed `.aab` with:

  ```text
  puro flutter build appbundle --release
  ```

- Verify the application ID `com.storystack.story_stack_mobile` is the intended
  Play package name. It cannot be changed after publishing.
- Provide a public privacy policy covering account data, playback progress,
  downloaded audiobook files, local-device folder access, and casting.
- Complete the Play Data safety form and content rating questionnaire.
- Confirm audiobook distribution rights for every catalog source used by the
  published service.
- Prepare store listing screenshots, icon, feature graphic, support email, and
  release notes.
- Test the signed release on a physical phone, Android Auto, Chromecast, LAN
  mode, remote HTTPS mode, offline playback, and a fresh install.

## Known release considerations

- Local Network mode intentionally permits HTTP addresses. Remote deployments
  should use HTTPS, preferably through the configured Cloudflare tunnel.
- Store samples are client-limited to the configured preview window. A strict
  server-side 30-second media boundary would require generating a preview file
  or transcoding/segmenting the source audio.
- The current Flutter environment has a Puro cache issue that can prevent the
  wrapper command from starting even though direct Gradle Android compilation
  succeeds. Repair the Flutter/Puro installation before the final release build.
