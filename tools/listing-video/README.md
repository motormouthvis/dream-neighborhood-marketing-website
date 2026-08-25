# Listing Video Maker (internal, staging only)

A one-screen internal tool for marketing. Myles types in four fields, picks a
video type and a voice, presses **Make video**, and gets a shareable link he can
send to a realtor or brokerage.

**Staging only.** Nothing in here is wired into the production marketing site.
This is a separate Node service that lives in the repo but is not part of the
static site build, and it does not touch any Dream Neighborhood product code.
Do not put it in front of customers on production unless Bill says go.

---

## What it does

1. Opens the realtor or brokerage website that was typed in, finds a live
   listing page if it can, and screenshots it at 1920x1080. If no live listing
   turns up, it screenshots the homepage instead and says so, so Myles is never
   stuck with nothing.
2. Voices the approved script — either the built-in professional female AI voice,
   or Myles' own overdub (recorded in the browser or uploaded).
3. Draws one 1920x1080 still per line: the customer's page with the green house
   popup in the bottom right, then the free School Explorer card, and for the
   School + Neighborhood video the Neighborhood Explorer card in the same spot.
   Captions sit in a **top** bar only — a bottom bar would cover the popup button.
4. Stitches the stills and the voice into an mp4 with ffmpeg.
5. Publishes a public watch page at `/v/{id}` that anyone with the link can play.

## The two videos

Myles has to pick one; there is no default and **Make video** stays switched off
until he does.

| Choice | What is in it |
| --- | --- |
| **School only** | School Explorer only. Neighborhood Explorer is never mentioned. |
| **School + Neighborhood** | School Explorer first, then the Neighborhood Explorer tabs. |

The narration lives in `src/scripts.js`. It only makes claims that were already
approved. Do not add product claims, prices, or features there.

## Voice

- **AI** — one professional female English voice. Only the opening line is
  personalized, with the customer's first name and company.
- **Overdub** — record in the page (press, talk, stop, play it back) or upload an
  mp3, wav or m4a. When overdub is chosen, no AI voice is used at all. Dead air
  at the front of a take is trimmed, and every video starts with 0.6s of silence
  so the first word is never clipped.

Voice engines are tried in this order, and the tool always reports which one it
used:

1. ElevenLabs, if `ELEVENLABS_API_KEY` is set
2. OpenAI, if `OPENAI_API_KEY` is set
3. The built-in offline voice (Piper), if it is installed

If none of them are available, the AI option is switched off in the UI and Myles
is told to use overdub. It never silently swaps in a different voice.

## Email

The tool sends from one of two addresses: `marketing@dreamneighborhood.com` or
`myles@dreamneighborhood.com`.

If SMTP is not configured, the UI says **"Mailbox not connected"**, the send
button is switched off, and Myles gets the link plus the full email text to copy
and send himself. It never reports a send that did not happen.

---

## Running it

```bash
cd tools/listing-video
npm install
bash scripts/setup-voice.sh          # optional: installs the built-in AI voice
LISTING_VIDEO_TOKEN=pick-a-password npm start
```

Then open <http://localhost:8788/tools/listing-video>.

Needs Node 20+, `ffmpeg`/`ffprobe`, and Google Chrome or Chromium on the box.

### Settings

| Variable | What it does |
| --- | --- |
| `LISTING_VIDEO_TOKEN` | The shared password for the tool. **Set this.** Without it the server generates a throwaway password and prints it at startup, so the page is never left open to the public. |
| `LISTING_VIDEO_PUBLIC_URL` | Public origin used to build the share link, e.g. `https://staging.dreamneighborhood.com`. Falls back to the request host. |
| `LISTING_VIDEO_COOKIE_SECRET` | Signing key for the sign-in cookie. Set it so sessions survive a restart. |
| `LISTING_VIDEO_DATA_DIR` | Where jobs and finished mp4s are written. Defaults to `tools/listing-video/data` (git-ignored). |
| `PORT` | Defaults to `8788`. |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` | Hosted AI voice. |
| `OPENAI_API_KEY`, `OPENAI_TTS_VOICE` | Hosted AI voice, second choice. |
| `PIPER_BIN`, `PIPER_VOICE` | Point at a Piper install if `setup-voice.sh` put it somewhere unusual. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | Mailbox. Leave unset and the tool says "mailbox not connected". |
| `LISTING_VIDEO_CHROME` | Chrome path, if it is not found automatically. |

### Putting it behind the staging site

Run the service on the staging box and point staging at it. Nothing is added to
the repo's `_redirects`, because that file is served in production too. On
staging only, add:

```
/tools/listing-video/*  http://127.0.0.1:8788/tools/listing-video/:splat  200
/v/*                    http://127.0.0.1:8788/v/:splat                    200
```

Or just give Myles the service URL directly. The tool works fine on its own host.

## Routes

| Route | Who can reach it |
| --- | --- |
| `GET /tools/listing-video` | Myles, after the password |
| `POST /tools/listing-video/api/jobs` | Signed in only |
| `GET /tools/listing-video/api/jobs/:id` | Signed in only |
| `POST /tools/listing-video/api/jobs/:id/email` | Signed in only |
| `GET /v/:id` | Public watch page |
| `GET /v/:id/video.mp4`, `GET /v/:id/poster.jpg` | Public |

No `/popup/{address}` routes are added, and no product code is changed.

## Layout

```
server.js              routes, sign-in gate, upload handling, one-at-a-time queue
src/scripts.js         the two approved narration scripts
src/demo-data.js       the demo neighborhood shown inside the SE and NE cards
src/capture.js         opens the customer site, finds a listing, screenshots it
src/frames.js          turns each script line into a 1920x1080 still
src/audio.js           AI voice providers, overdub handling, 0.6s lead silence
src/video.js           ffmpeg assembly
src/mail.js            the two from-addresses, honest "not connected" state
views/frame.html       the frame: top caption bar, popup button, SE and NE cards
public/                the form, the watch page
```
