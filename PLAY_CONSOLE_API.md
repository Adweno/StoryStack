# Google Play release automation

Story Stack can publish an already-built Android App Bundle through the Google Play Android Developer API. Credentials stay on the release machine and are never stored in this repository.

## One-time setup

1. In Google Cloud, enable the **Google Play Android Developer API**.
2. Create a service account and download its JSON key outside this repository, for example `C:\Users\adamw\Secrets\story-stack-play.json`.
3. In Play Console, open **Users and permissions** and invite the service-account email with the minimum permissions needed to manage testing releases and edit releases.
4. Build the signed bundle from `mobile/story_stack_mobile` using the existing Android release configuration.

## Publish a release

From the repository root:

```powershell
$env:PLAY_SERVICE_ACCOUNT_FILE = 'C:\Users\adamw\Secrets\story-stack-play.json'
npm run play:release -- --track internal --name 'Story Stack Beta 1' --notes 'Improved playback, downloads, and Android Auto support.'
```

If your testers are managed through a Google Group, include it in the same command:

```powershell
npm run play:release -- --track closed --tester-group story-stack-testers@googlegroups.com --notes 'Closed beta update.'
```

The command creates an edit, uploads the AAB, assigns it to the selected track, adds English release notes, commits the edit, and abandons the edit if a later step fails. `--track` accepts `internal`, `production`, or the custom ID of a configured closed-testing track.

Validate the bundle and arguments without contacting Google:

```powershell
npm run play:release -- --dry-run --notes 'Release validation'
```

The API supports Google Group testers, but does not support the individual tester email-list feature available in the Play Console UI. The initial track/country setup and any individual email list therefore remain account-level Play Console configuration; subsequent AAB publishing can be automated with this command.
