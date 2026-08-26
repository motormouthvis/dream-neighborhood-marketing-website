# Listing Video Maker (internal, staging only)

An internal tool for marketing. Bill and Myles pick a script, fill in the
customer, record their own voice over a silent video, hear it against the
pictures, add it to the video, review the finished file, and send a shareable
link.

**Staging only.** Nothing in here is wired into the production marketing site.
This is a separate Node service that lives in the repo but is not part of the
static site build, and it does not touch any Dream Neighborhood product code. No
`_redirects`, `index.html` or `styles.css` changes, and no `/popup/{address}`
routes. Do not put it in front of customers on production unless Bill says go.

---

## The flow

Three tabs: **Make a video**, **Library**, **Scripts**.

### 1. Pick a script

Every script is a file on this box, editable from the **Scripts** tab. Three ship
by default:

| Script | Who it is for | What is in it |
| --- | --- | --- |
| `vanessa-se-only-v11` | A new customer | School Explorer only. Neighborhood Explorer is never mentioned. |
| `vanessa-se-ne-v11` | A new customer | School Explorer first, then the seven Neighborhood Explorer tabs. |
| `se-to-ne-upgrade` | Somebody who **already has** the free School Explorer | Opens on their listing with School Explorer on it, then the same button becomes Neighborhood Explorer and walks every tab in order. |

The first two are the approved v11 videos and are a before-and-after: they need a
listing with nothing on it yet. The upgrade script is the opposite — it wants a
listing that already has School Explorer, because that is the customer it is
talking to. Each script says which it needs, and capture obeys it.

### 2. Fill in the customer

First name, company, website URL, customer email. There is also an optional
**Listing page URL** for when you already know the exact listing you want.

### 3. The tool finds a listing detail page

It has to be a listing **detail** page: one address, beds and baths, a price and
photos. Not a search page, not a map, not a results grid, not the homepage.

What it does about an Explorer already being on the page depends on the script:

| The script needs | What capture does |
| --- | --- |
| a listing with no Explorer on it yet | Skips any listing that already has one. If they all have one, it refuses and says so. |
| a listing that already has School Explorer | Prefers one that has it. A clean listing is kept in reserve and used if none turns up, and the video says School Explorer was added to it for the opening shot. |

Every page it opens is classified first. It is treated as a search or index page,
and skipped, if it has search controls on it, a big map, three or more different
prices, a grid of links to other listings, or a URL that reads like a search. A
page's result rows often contain something street-like, so looking street-like is
not enough to make it a listing.

It checks the entry page, the listings it links to, and a few likely index paths
such as `/listings` and `/properties`. If you paste a search URL it crawls from
there rather than filming it.

If it cannot find a clean listing it **stops and says so**, with a box to paste
one listing URL and try again. The homepage and a search page are never used as
a stand-in. The last DOMO listing that worked was 4697 Wehunt Commons Drive SE,
Smyrna, GA 30082, at a DOMO listing URL rather than their homepage.

A page with our script, iframe or `data-dn-*` attribute on it is refused
outright. A page that only *mentions* School Explorer in its copy is skipped
during the search, but allowed with a warning if you pasted that URL yourself.

#### Nothing may cover the page

A finished video once went out with the site's own "Microphone access denied"
voice-command panel sitting in the middle of frame. Three things stop that now:

- Speech recognition and `navigator.mediaDevices` are removed before the page
  loads, so a voice widget never starts and never asks for anything.
- Chrome answers any microphone request with a fake device rather than a denial,
  so a site that asks anyway gets a yes instead of drawing an error panel.
- Whatever is left — cookie bars, chat bubbles, newsletter popups, consent
  dialogs — is dismissed by clicking its own close control and then force-hidden.

The screenshot is only taken once nothing is floating over the middle of the
page or over the bottom strip where the house button goes. A page that cannot be
cleared is skipped rather than filmed.

#### The address

The tooltip on the house button uses the address of the page being filmed, and
that address once read "032 SQFT 4497 Chase Drive" — the tail of "1,032 SQFT"
glued onto the next listing's street. The address is now read from the page's own
structured data first, then a heading, and only then the body text, and any
candidate is thrown away if it has a leading-zero house number, a thousands
separator, a price, or a listing-spec word such as SQFT, BEDS or BATHS inside the
street name. If no address can be read the tooltip just says "explore this
neighborhood" rather than guessing.

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

### 5. Record and try it, on one screen

Press **Record while it plays**. The silent video restarts from the beginning and
the microphone opens once the picture is moving, so the words land on the right
scenes. The words and each picture's length are listed beside the player and the
current beat is highlighted as it plays.

When you stop, the take appears on the same screen. **Nothing is burned into the
video yet.** From here you can:

- **Play the video and this take together** — the picture and your take run at
  the same time, from two separate players, so you can hear whether your words
  land on the right pictures. They are kept in step as they play.
- Play the take on its own.
- **Record again**, which throws the old take away and starts a new one.
- **Throw this take away** and start from the top.

Dead air is trimmed off the front of a take and a known 0.6s of silence is put
back, so the first word is never clipped.

You can also upload an mp3, wav, m4a or webm. That becomes a take like any
other, so it can be tried against the pictures before you commit to it.

### 6. Add the audio to the video

**Keep this take and add the audio to the video** is the only thing that burns
the voice onto the pictures. Nothing is muxed while you are still trying takes,
so re-recording is free and does not cost a render.

### 7. Final review, then send

The finished file plays with sound: picture and voice as one video, exactly what
the customer will see. **Send stays switched off** until you have watched it
through or ticked *I reviewed this*. The server refuses the send either way, so
there is no silent fake send. Going back and keeping another take clears the
review, because the new file has not been reviewed.

If SMTP is not configured the UI says **"Mailbox not connected"**, the send
button stays off, and you get the watch link plus the whole email text to copy
and send yourself. It never reports a send that did not happen.

### 8. Hosting

Every finished video gets a public watch page at `/v/{id}`. Anyone with the link
can play it, no sign-in and no Loom. Once a video is deleted, that page and its
mp4 return 404.

### 9. Library

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
| Tab | On a `ne` beat only: which Neighborhood Explorer tab is on screen. |

Plus a name, a notes field, whether the script is *School Explorer only* or
*School Explorer, then Neighborhood Explorer*, and what their listing should
already have on it.

**The tab field** is how a script guarantees the Demographics tab is on screen
while the voice is saying "Demographics". Name the tab and it is pinned; leave it
empty and the tabs are handed out in the order the `ne` beats appear, which is
what the v11 script does. `Housing and Market Trends` and
`Housing & Market Trends` are the same tab. The seven tabs, in the official
order, are the only ones there are: Map and Summary, Demographics, Schools,
Housing & Market Trends, Commutes, Mobility, Points of Interest.

The Scripts tab can create, edit, save, duplicate and delete. Making an "other
video" means writing a new script here and saving it; it shows up in the picker
next time. There is no way to add a new scene type or a new piece of Explorer UI
from this page, by design.

Bad edits are refused with a message you can act on: a Neighborhood Explorer
beat in a school-only script, a Neighborhood Explorer beat before School
Explorer, an unknown scene, or a duration outside 0.5-120s.

Scripts live in `<data dir>/templates/*.json`, one file per script. The shipped
scripts are seeded on boot, one id at a time: a data dir that already has the two
v11 scripts picks up a newly shipped third one the next time the server starts,
and the startup log says which ones it added. A default that somebody deleted
stays deleted, because the marker records what has already been offered.
**Put the shipped scripts back** on the Scripts tab restores all of them exactly
as they ship.

## Voice

Recording over the silent video is the default and the recommended path, because
it is the only one where you get to hear the words against the pictures before
anything is committed.

The AI voice is optional and secondary. When a voice is connected it appears
under *Other ways to add the voice*. It goes straight to adding the audio, since
there is no take to try first, and it still has to pass the same final review
before anything can be sent. It uses one engine for the whole script, so two
voices are never spliced together. Engines are tried in this order and the tool
always reports which one it used:

1. ElevenLabs, if `ELEVENLABS_API_KEY` is set
2. OpenAI, if `OPENAI_API_KEY` is set
3. The built-in offline voice (Piper), if it is installed

If none are available the AI button is switched off and says so.

## Email

The send picker offers three from-addresses:

- `marketing@dreamneighborhood.com`
- `myles@dreamneighborhood.com`
- `bill@dreamneighborhood.com`

Whichever is picked becomes the From and the Reply-To. It does **not** change
which mailbox the message is sent through: that is always `SMTP_USER`, which is
a different address. If a mailbox refuses to send as an address it does not own,
that is an SMTP-side setting, not something this tool decides.

The email only mentions Neighborhood Explorer when the script the customer just
watched covered it.

---

## Running it

```bash
cd tools/listing-video
npm install
npm test                             # scripts, job delete, address reading, page classification
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
src/default-templates.js     the three shipped scripts
src/capture.js               opens their site, clears overlays, screenshots a listing
src/page-analysis.js         is this one listing or a search page, and what address
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
