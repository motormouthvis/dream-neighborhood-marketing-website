# Listing Video Maker (internal, staging only)

An internal tool for marketing. Bill and Myles pick a script, fill in the
customer, record their own voice over a silent video, review it, and send a
shareable link.

**Staging only.** Nothing in here is wired into the production marketing site.
This is a separate Node service that lives in the repo but is not part of the
static site build, and it does not touch any Dream Neighborhood product code. No
`_redirects`, `index.html` or `styles.css` changes, and no `/popup/{address}`
routes. Do not put it in front of customers on production unless Bill says go.

---

## The flow

Three tabs: **Make a video**, **Library**, **Scripts**.

### 1. Pick a script

Every script is a file on this box, editable from the **Scripts** tab. Two ship
by default, matching the approved v11 videos:

| Script | What is in it |
| --- | --- |
| `vanessa-se-only-v11` | School Explorer only. Neighborhood Explorer is never mentioned. |
| `vanessa-se-ne-v11` | School Explorer first, then the seven Neighborhood Explorer tabs. |

### 2. Fill in the customer

First name, company, website URL, customer email. There is also an optional
**Listing page URL** for when you already know the exact listing you want.

### 3. The tool finds a live listing

It opens their site and looks for a live listing page that does **not** already
have School Explorer or Neighborhood Explorer on it. It checks the entry page,
the listings it links to, and a few likely index paths such as `/listings` and
`/properties`.

If it cannot find one it **stops and says so**. The homepage is never used as a
stand-in. You get a message and a box to paste one listing URL and try again.
The last DOMO listing that worked was 4697 Wehunt Commons Drive SE, Smyrna, GA
30082, at a DOMO listing URL rather than their homepage.

A page with our script, iframe or `data-dn-*` attribute on it is refused
outright. A page that only *mentions* School Explorer in its copy is skipped
during the search, but allowed with a warning if you pasted that URL yourself.

### 4. The silent video is rendered first

One 1920x1080 still per beat, held for that beat's suggested duration, with **no
audio track at all**:

- Captions sit in a **top** bar only. A bottom bar would cover the house button.
- The house button hovers in the bottom right of their own page.
- The School Explorer and Neighborhood Explorer cards are about 70% of the frame,
  in the same place and at the same size as each other.
- School Explorer is always the first explorer on screen. Neighborhood Explorer
  beats only run after it, and only in a `se-ne` script.
- Between Neighborhood Explorer beats only the highlighted tab moves. The card
  body stays the real Map and Summary view; no per-tab screens are invented.

### 5. Record while it plays

Press **Record while it plays**. The silent video restarts from the beginning and
the microphone opens once the picture is moving, so the words land on the right
scenes. The words and each picture's length are listed beside the player and the
current beat is highlighted as it plays.

Play the take back, then **Use this take** or **Record again**. Dead air is
trimmed off the front of a take and a known 0.6s of silence is put back, so the
first word is never clipped.

You can also upload an mp3, wav, m4a or webm instead.

### 6. Review, then send

The muxed video plays with sound. **Send stays switched off** until you have
watched it through or ticked *I reviewed this*. The server refuses the send
either way, so there is no silent fake send. Re-recording the voice clears the
review, because a new take has not been reviewed.

If SMTP is not configured the UI says **"Mailbox not connected"**, the send
button stays off, and you get the watch link plus the whole email text to copy
and send yourself. It never reports a send that did not happen.

### 7. Hosting

Every finished video gets a public watch page at `/v/{id}`. Anyone with the link
can play it, no sign-in and no Loom. Once a video is deleted, that page and its
mp4 return 404.

### 8. Library

The **Library** tab lists every video on the box: customer, company, script,
date, status and watch link. Play it, copy the link, open it to send it, or
delete it. Delete asks for confirmation and then removes the mp4, the poster,
the stills and the record that makes `/v/{id}` work.

---

## Editing scripts

A script is a list of **beats**. Each beat has:

| Field | What it is |
| --- | --- |
| Words you say | The teleprompter line. `{firstName}` and `{company}` are filled in. |
| Scene | `listing`, `listing-tap`, `se` or `ne`. These four are the only scenes. |
| Suggested seconds | How long that picture is held. Editable per beat. |
| Top caption | Two optional lines for the top bar. |

Plus a name, a notes field, and whether the script is *School Explorer only* or
*School Explorer, then Neighborhood Explorer*.

The Scripts tab can create, edit, save, duplicate and delete. Making an "other
video" means writing a new script here and saving it; it shows up in the picker
next time. There is no way to add a new scene type or a new piece of Explorer UI
from this page, by design.

Bad edits are refused with a message you can act on: a Neighborhood Explorer
beat in a school-only script, a Neighborhood Explorer beat before School
Explorer, an unknown scene, or a duration outside 0.5-120s.

Scripts live in `<data dir>/templates/*.json`, one file per script. The two
shipped scripts are seeded on first run. A deleted default stays deleted;
**Put the two v11 scripts back** on the Scripts tab restores them exactly as
they ship.

## Voice

Recording over the silent video is the default and the recommended path, because
it is the only one where the words are guaranteed to land on the pictures.

The AI voice is optional and secondary. When a voice is connected it appears
under *Other ways to add the voice*, it uses one engine for the whole script so
two voices are never spliced together, and it still has to go through the same
review step before anything can be sent. Engines are tried in this order and the
tool always reports which one it used:

1. ElevenLabs, if `ELEVENLABS_API_KEY` is set
2. OpenAI, if `OPENAI_API_KEY` is set
3. The built-in offline voice (Piper), if it is installed

If none are available the AI button is switched off and says so.

## Email

Sends from `marketing@dreamneighborhood.com` or
`myles@dreamneighborhood.com`. The email only mentions Neighborhood Explorer
when the script the customer just watched covered it.

---

## Running it

```bash
cd tools/listing-video
npm install
npm test                             # template load/save/duplicate/delete, job delete
bash scripts/setup-voice.sh          # optional: installs the built-in AI voice
LISTING_VIDEO_TOKEN=pick-a-password npm start
```

Then open <http://localhost:8788/tools/listing-video>.

Needs Node 20+, `ffmpeg`/`ffprobe`, and Google Chrome or Chromium on the box.
Recording in the browser needs a microphone and a secure context, so use
`localhost` or https.

### Settings

| Variable | What it does |
| --- | --- |
| `LISTING_VIDEO_TOKEN` | The shared password for the tool. **Set this.** Without it the server generates a throwaway password and prints it at startup, so the page is never left open to the public. |
| `LISTING_VIDEO_PUBLIC_URL` | Public origin used to build the share link, e.g. `https://staging.dreamneighborhood.com`. Falls back to the request host. |
| `LISTING_VIDEO_COOKIE_SECRET` | Signing key for the sign-in cookie. Set it so sessions survive a restart. |
| `LISTING_VIDEO_DATA_DIR` | Where scripts, jobs and finished mp4s are written. Defaults to `tools/listing-video/data` (git-ignored). |
| `PORT` | Defaults to `8788`. |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` | Hosted AI voice. |
| `OPENAI_API_KEY`, `OPENAI_TTS_VOICE` | Hosted AI voice, second choice. |
| `PIPER_BIN`, `PIPER_VOICE` | Point at a Piper install if `setup-voice.sh` put it somewhere unusual. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | Mailbox. Leave unset and the tool says "mailbox not connected". |
| `LISTING_VIDEO_CHROME` | Chrome path, if it is not found automatically. |

### Disk

Each job keeps its stills so a re-recorded take can be re-timed against the same
pictures without opening Chrome again. That is roughly 5-10MB per video on top of
the mp4. Deleting a video from the Library takes all of it.

### Putting it behind the staging site

Run the service on the staging box and point staging at it. Nothing is added to
the repo's `_redirects`, because that file is served in production too. On
staging only, add:

```
/tools/listing-video/*  http://127.0.0.1:8788/tools/listing-video/:splat  200
/v/*                    http://127.0.0.1:8788/v/:splat                    200
```

Or just give them the service URL directly. The tool works fine on its own host.

## Routes

| Route | Who can reach it |
| --- | --- |
| `GET /tools/listing-video` | Bill and Myles, after the password |
| `GET/POST/PUT/DELETE /tools/listing-video/api/templates...` | Signed in only |
| `POST /tools/listing-video/api/jobs` | Signed in only |
| `POST /tools/listing-video/api/jobs/:id/recapture` | Signed in only |
| `POST /tools/listing-video/api/jobs/:id/audio`, `.../ai-voice` | Signed in only |
| `POST /tools/listing-video/api/jobs/:id/reviewed`, `.../email` | Signed in only |
| `GET /tools/listing-video/api/jobs/:id/silent.mp4`, `.../video.mp4` | Signed in only |
| `GET /tools/listing-video/api/videos`, `DELETE .../videos/:id` | Signed in only |
| `GET /v/:id` | Public watch page |
| `GET /v/:id/video.mp4`, `GET /v/:id/poster.jpg` | Public |

No `/popup/{address}` routes are added, and no product code is changed.

## Layout

```
server.js                    routes, sign-in gate, uploads, one-at-a-time queue
src/templates.js             script templates on disk: load, save, validate, render
src/default-templates.js     the two shipped v11 scripts
src/capture.js               finds a live listing with no Explorer on it, or refuses
src/frames.js                turns each beat into a 1920x1080 still
src/video.js                 ffmpeg: the silent cut, then the voiced cut
src/audio.js                 recorded takes, the optional AI voice, 0.6s lead silence
src/render.js                phase one (silent picture) and phase two (attach audio)
src/store.js                 jobs on disk, the library list, delete
src/mail.js                  the two from-addresses, honest "not connected" state
src/demo-data.js             the demo neighborhood shown inside the SE and NE cards
views/frame.html             the frame: top caption bar, popup button, SE and NE cards
public/                      the three tabs and the public watch page
test/                        node --test smoke tests
```
