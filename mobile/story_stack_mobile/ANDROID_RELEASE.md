# Android release signing

Release builds use a private upload keystore. Copy
`android/key.properties.example` to `android/key.properties`, replace the
placeholder values, and keep both `key.properties` and the keystore outside
source control. The Android project ignores those files.

For Google Play, use this key as the upload key and enable Play App Signing
when creating the app in Play Console. Never commit the keystore or its
passwords.

The app permits cleartext HTTP because Local Network mode supports a local
server address such as `http://192.168.x.x:4100`. Remote Access deployments
should use an HTTPS address, such as a Cloudflare Tunnel URL.

Build the release bundle with:

```text
puro flutter build appbundle --release
```
