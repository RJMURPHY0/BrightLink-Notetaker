# FTC Transcribe — Chrome extension

One click on the toolbar icon records the meeting in the current tab. No
screen-share picker, and speakers get their real names from the meeting's own
participant list.

## Why this exists

A web page cannot record a meeting in one click. Chrome mandates the "Choose
what to share" picker for `getDisplayMedia` on every website, and no flag,
permission or origin trial removes it — it is a deliberate security boundary,
not a gap. Every product that does one-click meeting recording has left the web
page to do it: Granola is a desktop app taking system audio, Fireflies sends a
bot into the call, Otter ships an extension.

An extension can use `chrome.tabCapture`, which captures the active tab's audio
from a toolbar click with no picker at all. It can also run a content script
inside the meeting page, where the attendee names are ordinary text on screen.

## What it captures

Your microphone on the **left** channel, the call on the **right**, as two
discrete channels rather than a blend. This is the same layout the web recorder
produces (`channelLayout: 'mic-sys'`) and the server's diarisation pipeline
already knows how to read it. Keeping the two apart is the single most useful
thing a recorder can do for speaker attribution: your channel is provably one
person, and the remote channel can be clustered without your voice in it.

The call keeps playing through your speakers as normal. `tabCapture` diverts
the tab's audio by default, so `offscreen.js` explicitly routes it back to the
`AudioContext` destination — forgetting that line is the classic way this
feature ships broken.

## Speaker names: two qualities of signal

**The roster is reliable.** Every platform renders attendee names as plain
text. Even with nothing else, a roster turns "Speaker 2" into a real name
whenever the counts line up, and gives the summariser real candidates to match
self-introductions against.

**Who is speaking is best-effort.** Every platform signals it through styling
whose class names are obfuscated and rebuilt on their own release schedule. So
`content/participants.js` tries several independent selectors per platform and,
when none match, reports the roster with no speaking spans. The server then
falls back to the acoustic pipeline.

That degradation is the design. `lib/participant-names.ts` only renames a
segment when one participant clearly owns it (>50% overlap, >20% margin over
the runner-up); everything ambiguous keeps its acoustic label. A wrong name on
a quotable sentence is far worse than a "Speaker 2" the user can fix in one
click, and these transcripts get forwarded to customers.

**Selectors will break.** When Meet or Teams ships a redesign, attribution
quietly degrades to roster-only rather than failing loudly. That is the correct
behaviour but it does mean this file needs checking periodically. For
attribution that is exact rather than inferred, use the bot path
(`lib/recall.ts`) — Recall.ai gets a separate audio stream per participant from
the platform itself.

## Install (development)

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select this `extension/` folder
3. Copy the extension ID Chrome shows under the entry
4. Start the app (`npm run dev`) and open `/extension`
5. Paste the ID, click **Connect this account**

The connect page hands over the Supabase session the browser is already
holding, so there is no second login. The extension refreshes that token itself
once the hour is up — meetings outlast an access token, and without refresh the
uploads would die two thirds of the way through.

Pairing also records which origin you paired from, so connecting from
`http://localhost:3000` points the extension at your dev server with no
rebuild.

## Record

1. Open the Teams / Meet / Zoom tab
2. Click the FTC Transcribe icon
3. **Record** → **Stop and transcribe**

Any tab playing call audio works; the meeting platforms just also give names.

## Permissions, and why each is needed

| Permission | Why |
|---|---|
| `tabCapture` | The audio itself. The only API that captures a tab without a picker. |
| `offscreen` | A service worker has no DOM, so it cannot hold a `MediaStream` or run a `MediaRecorder`. |
| `storage` | The paired session and the in-flight recording, which must survive the service worker being killed mid-meeting. |
| `tabs` | Reading the active tab's URL to detect the platform. |
| Meeting host permissions | The content script that reads the participant list. |
| App host permission | Uploading chunks to your Transcribe instance. |

No `<all_urls>`, no history, no cookies, no analytics. Audio goes to your own
Transcribe instance and nowhere else.

## Before the Chrome Web Store

- [ ] Replace `icons/` with properly rendered 16/48/128 px files — these are
      scaled copies of the app's favicon
- [ ] Set `NEXT_PUBLIC_EXTENSION_ID` and `EXTENSION_IDS` to the published ID,
      which removes the manual ID field from the connect page
- [ ] Replace the `http://localhost/*` entries in `manifest.json` and
      `externally_connectable` with the production origin only
- [ ] Privacy policy URL (the store requires one for `tabCapture`)
- [ ] First review typically takes 1–2 weeks

## Layout

```
manifest.json            MV3 manifest
background.js            Lifecycle + every API call. Holds the token.
auth.js                  Supabase session storage and refresh
config.js                Which Transcribe instance to talk to
offscreen.html/.js       Capture, mix to 2 channels, encode, upload
content/participants.js  Reads the roster and who is speaking
popup.html/.js           One button
```
