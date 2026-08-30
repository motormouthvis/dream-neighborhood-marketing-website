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

It has to be a listing **detail** page: one property, with its street address,
price, beds, baths and photos of that house. The hero is the house, not a city
skyline with "Search Homes" buttons over it.

These are never filmed, whatever else is on them:

- the homepage
- a city or neighbourhood landing page
- a market report or home-valuation page
- a blog, about, contact, agents or team page
- a search form, a map or a results grid
- a bare listings index

Getting this wrong is what produced two bad videos, so the bar is deliberately
high. A page only counts as one listing when **both** of these hold:

1. **The page says which house it is about.** The address has to come from the
   page's own structured data, a heading, or an element marked up as the
   listing's address. An address merely found somewhere in the running text does
   not count, because that is usually the office address in the footer — that is
   where "2135 Bellflower Blvd" on Bill's video came from. An address belonging
   to an agent or an organisation in structured data is ignored for the same
   reason.
2. **It carries at least two things only a listing page has.** Structured data
   describing a home at that address; beds, baths and a price or size together in
   one block; an MLS number; two or more listing detail fields such as Year
   Built, Lot Size, Property Type or Days on Market; a price alongside beds and
   baths. Photos only count when there is a spec row beside them.

Photos plus the words "bed" and "bath" somewhere in the copy used to be enough.
It is not: a city landing page has both.

What it does about an Explorer already being on the page depends on the script:

| The script needs | What capture does |
| --- | --- |
| a listing with no Explorer on it yet | If the one listing it opens already has one, it refuses — and points at the *SE to NE upgrade* script, since a customer who already has School Explorer is that pitch rather than a dead end. It does not go looking through more listings. |
| a listing that already has School Explorer | Uses the one listing it opens. If that listing does not have School Explorer yet, the video says School Explorer was drawn on for the opening shot. To target a listing that really has it, paste its URL. |

Both of those used to look through several listings to find the right one. They
cannot any more — see [the account wall](#the-account-wall).

The walk is up to three clicks, and ends at the first listing it opens: their
site, then a listings or homes page, then the house. Links are ranked, so a concrete listing URL like
`/listings/123-main-st` on a card showing a price, beds and baths and a photo is
tried before a link to another index. Pages that are not listings still get
harvested for links, because that is how you get from a homepage to a listing —
missing that hop is what left capture stuck on the homepage.

Links are matched on the **path**, never the whole URL. `redwagonteam.com`
contains "team", and testing the whole URL against the exclusion list threw away
every link on that site.

**One listing, and a minute.** Exactly **one listing detail page** is opened per
video. IDX sites count how many listings a visitor has looked at and stop showing
them after a few, so this does not go poking through three or eight of them.
Homepages, listings indexes and search pages are not listing views and do not
count against that one.

The whole search is capped at 60 seconds. When the budget runs out it refuses and
asks for a listing URL rather than wandering. Progress lines say which page is
being checked and how long is left, so a wait is never a silent hang.

#### A pasted listing URL is taken at its word

If you paste a listing URL, that one page is opened and nothing else: cookies
accepted, screenshot, done. No other listing links are followed from it.

A URL is treated as one house on its **shape alone** — `/idx/details/listing/...`,
`/listing/...`, `/listings/123-main-st`, `/properties/listing/...`, `/property/...`,
`/homes/...`. No search or index page looks like that, and somebody who pastes one
has said exactly which house they mean. So the page furniture cannot overrule
them: an IDX details page carries the site's own search box in its header, a
neighbourhood map in the middle of the page and often a "See school ratings near
&lt;address&gt;" widget, and none of that makes it a page of search results.

The page this was checked against, opened with no login,
`andyharrisrealestate.idxbroker.com/idx/details/listing/b001/114051774`, is one
house: 1908 SW MILES ST, Portland, OR 97219, $560,000, 3 bed, 2 bath, 1,502 sq ft,
listing ID 114051774, a gallery of about 44 photos, branded FORIS / eXp. No cookie
banner and no account wall. It is filmed as it is.

It still has to be free of an [account wall](#the-account-wall), free of
[our own Explorer](#which-listing-gets-filmed) and free of overlays. Those are
about whether the page can be filmed, not about which page you meant.

A pasted listing is also loaded **with its photos on the first pass**, so it is
fetched once. Loading it lean and then again for the shutter costs a second
listing view on a site that counts them, and it is the repeat hit that gets
noticed: Andy Harris's IDX answered the first request with a 200 and the second
with a 403.

Two things had this refusing URLs Bill had pasted himself:

- `/idx/` was in the pattern for "this URL looks like a search", which condemned
  every page on an idxbroker-hosted site, details pages included. The IDX search
  paths — `/idx/search`, `/idx/results`, `/idx/map`, `/idx/city` and so on — are
  named individually now.
- street types only matched in mixed case, so the heading
  `1908 SW MILES ST, Portland, OR 97219` yielded no address at all and an address
  from the "Similar Listings" rail further down the page was used instead. IDX
  headings shout, so both spellings are matched.

#### A site that has nothing but search

A homepage that bounces straight onto the site's own IDX search — as
`homes.dukecitysunrise.com` does, landing on IDX advanced search — is refused on
the spot and asks for a listing URL. Its listings are only reachable by walking
the search results, and walking IDX results is the thing that raises the account
wall. That site loads perfectly well and its "MY SEARCH & LOGIN" link is optional,
so the refusal says it is a search page, not that the site is missing or gated.

#### A brand-new browser every time

IDX sites count listing views in a cookie and stop showing listings after a few.
That counter is why an account wall appears at all: open the same listing URL in
a clean profile and the whole house is there, with nothing but an optional
"Sign In" link in the header.

So every job gets **its own throwaway Chrome profile**, running incognito on top
of that, and the profile directory is deleted when the browser closes. Nothing is
ever carried over from a previous job and no view counter starts part-used. There
is a test that sets a view-counter cookie, closes the browser, opens a new one and
checks it came back empty.

#### The account wall

Some sites really do gate a listing behind an account. **We do not get past that,
and we do not try.** No accounts are created, no registration form is ever filled
in or submitted, and nothing is clicked that could be a step in one — "Continue",
"Next", "Submit" and "Sign up" are excluded from every button this tool presses,
and nothing inside a box containing an email or password field is touched at all.
That last one matters because a registration form's small print mentions cookies
and privacy, so it can otherwise look like a consent banner.

When a page gates the listing, capture stops there and says:

> This site asks for an account after a few listing views. Paste a listing URL.

A gate is decided by **structure, not wording**:

- a box carrying gate wording, with a way to register in it, that covers a good
  part of the page or sits over the middle of it, or
- a page that *is* the registration form, with no listing on it.

Both are looked for **before** the overlay pass runs, because that pass hides
exactly these boxes and a gate we have hidden is still a gate.

Wording on its own is never enough. The phrases that count are the narrow set
that say you must register to see *this* — "register to view", "register to
continue", "sign in to see", "sign up to view", "please register", "become a
member", "you have viewed 3 of 3". An optional "Sign In" link in a header cannot
match one, and neither can a "Create Your Free Account — get instant access"
marketing promo, which is dismissed like any other popup rather than treated as a
locked door.

**One page at a time.** Each page is closed before the next is opened, so a
renderer's memory goes back rather than piling up. Images, fonts, analytics and
session recording are blocked for the whole search; the one page that actually
gets photographed is loaded again with everything allowed. See
[Memory](#memory) for why all of that matters.

If you paste a URL it is used when it is a listing, and crawled from when it is
not, so pasting a homepage still gets you a listing.

#### What a refusal says

If it cannot open a clean listing detail page it **stops and says so**, naming
what it found instead, with a box to paste one listing URL and try again. The
last DOMO listing that worked was 4697 Wehunt Commons Drive SE, Smyrna, GA
30082, at a DOMO listing URL rather than their homepage.

A page with our script, iframe or `data-dn-*` attribute on it is refused
outright. A page that only *mentions* School Explorer in its copy is skipped
during the search, but allowed with a warning if you pasted that URL yourself.

An HTTP status is reported as what it means, because "there is no page there" sent
Bill looking for a typo in a URL that was fine:

| Status | What it says |
| --- | --- |
| 401, 403, 451 | The site blocked the capture. Sites refuse automated browsers even when the page opens fine in your own browser. Paste a listing URL. |
| 429 | The site is rate limiting us. Wait a minute. |
| 404, 410 | There really is no page at that address. |
| 5xx | The site errored. Try again in a minute. |

When every page a site served was a 403, the refusal says the site blocked us
rather than that it has no listings.

#### Cookie banners

Every page gets its cookie banner accepted before anything is judged or
photographed. In order:

1. The accept button of the consent tools that actually turn up on realtor sites,
   by name: OneTrust, Cookiebot, Quantcast, Osano, CookieYes, Iubenda, Complianz,
   HubSpot, Didomi, TrustArc and friends. Consent dialogs in their own iframe are
   included.
2. Failing that, the banner is found by its wording and the **Accept** button
   inside it is pressed. Never Reject and never Manage settings, because those
   either leave the banner up or bring it straight back.
3. Then it waits and checks the banner is actually **gone**, not merely clicked.
   That is retried a few times, since some tools show a second banner.
4. If it still will not go, the banner is taken off the page.
5. The screenshot is only taken when nothing cookie-shaped is left. If a banner
   survives even being hidden, the capture is refused rather than filmed — a
   cookie bar in the frame is a failed capture, not a video.

#### Nothing else may cover the page either

Finished videos have gone out with the site's own "Microphone access denied"
voice-command panel in the middle of frame, and with an IDX "Create Your Free
Account" form over the listing. Three things stop that now:

- Speech recognition and `navigator.mediaDevices` are removed before the page
  loads, so a voice widget never starts and never asks for anything.
- Chrome answers any microphone request with a fake device rather than a denial,
  so a site that asks anyway gets a yes instead of drawing an error panel.
- Whatever is left — cookie bars, chat bubbles, newsletter popups, consent
  dialogs — is dismissed by clicking its own close control and then force-hidden.

Anything floating counts: fixed, or absolutely positioned on a high layer, which
is how a modal inside a dimming backdrop is usually built. Lead-capture forms are
also matched on their wording.

The check runs **more than once, with a pause between**, because these forms are
on a timer and scrolling the page to load its photos is exactly what sets them
off. Anything that reappears is hidden again. The screenshot is only taken once
nothing is over the middle of the page or over the bottom strip where the house
button goes, and a page that cannot be cleared is skipped rather than filmed.

#### The address

The tooltip on the house button uses the address of the page being filmed. It has
been wrong twice: once reading "032 SQFT 4497 Chase Drive" — the tail of
"1,032 SQFT" glued onto the next listing's street — and once reading
"2135 Bellflower Blvd", the office address out of a footer.

So the address is read in this order, and the footer is skipped entirely:

1. the page's own structured data, but only from a node that says it is a home.
   Every WordPress SEO plugin emits a site-wide `Place` for the agent's office,
   and that is where "2135 Bellflower Blvd" came from on a page about
   850 Ocean Blvd
2. an element marked up as the listing's address, outside the footer
3. a heading: `h1`, `og:title`, the page title, then `h2`
4. the running text, as a last resort — good enough to caption a tooltip, but
   never good enough to decide the page is a listing

Any candidate is thrown away if it has a leading-zero house number, a thousands
separator, a price, or a listing-spec word such as SQFT, BEDS or BATHS inside the
street name. If no address can be read, the tooltip says "explore this
neighborhood" rather than guessing.

A footer is decided by **where it is**, not only what it is called: a wrapper
called `page-footer-wrap` around the whole document used to swallow the listing's
own heading. A named footer only counts when it actually sits low on the page.

One more signal helps with IDX systems that draw the price and beds after load,
which can make a real listing page look bare at the moment it is read: when the
**URL and the heading name the same house** — as in
`/properties/listing/CRMLS/OC26141010/850-E-Ocean-Boulevard-B3-…` — that counts
as evidence on its own. A homepage or a market report can never have a street
address in its path, so this cannot let one of those through.

### 4. The silent video is rendered first

One 1920x1080 still per beat, held for that beat's suggested duration, with **no
audio track at all**:

- Captions sit in a **top** bar only. A bottom bar would cover the house button.
- The house button hovers in the bottom right of their own page.
- The School Explorer and Neighborhood Explorer cards are about 70% of the frame,
  in the same place and at the same size as each other.
- School Explorer is always the first explorer on screen. Neighborhood Explorer
  beats only run after it, and only in a `se-ne` script.
- Each Neighborhood Explorer beat is a **photograph of that tab in the live
  product**, taken at this listing's own address. See
  [Filming the Explorer](#filming-the-explorer).

#### Filming the Explorer

The seven Neighborhood Explorer tabs each show genuinely different data, so each
tab beat is a screenshot of that tab **in the live product, at this listing's
address**. Nothing about a tab's contents is drawn by this tool.

It used to be. The card was ours, and between tab beats only the highlighted chip
moved while the body stayed on Map and Summary — so Schools, Commutes and
Walk & Bike all showed the same income and rent bars. Because each beat is now one
photograph, the highlighted chip and the body underneath it cannot disagree.

How it runs, after the listing still is in hand:

1. The listing browser is **closed first**. It is deliberately starved to survive
   a small dyno, and the Explorer's map needs WebGL — without a GPU the widget
   sits on "Loading location..." forever. The walk gets its own browser, so only
   one Chrome is ever alive at a time.
2. The address captured from the realtor page is turned into coordinates. Every
   answer is checked against the town and state the listing gave, because a loose
   geocode once put "123 Main St, Long Beach, CA" in Lake Huron, and filming that
   would have put another town's schools in the video. If only the town or
   postcode resolves, the job log says the Explorer was centred nearby.
3. The live widget is opened at those coordinates, and each tab is clicked and
   photographed once its own content has arrived and stopped moving.

It refuses rather than falling back to anything drawn by us:

| What happened | What it says |
| --- | --- |
| the address cannot be placed on the map | that address could not be found, try a different listing |
| the Explorer never loads data for it | it has no neighborhood data for that address |
| it reports "Unknown location" | same, and it names what the Explorer reported |
| a tab is missing, or the walk runs over its budget | which tab, and how far it got |
| every tab came out the same picture | nothing is rendered, because that is the bug this replaces |

#### The seven chips, and their spelling

The chips are matched against the live widget, so how they are spelled is not
cosmetic — a chip spelled wrong is never found, and the beat is refused rather
than filmed from the wrong panel. Left to right:

| # | Chip | Note |
| --- | --- | --- |
| 1 | Map and Summary | the word "and" |
| 2 | Demographics | |
| 3 | Schools | |
| 4 | Housing & Market Trends | ampersand |
| 5 | Commutes | |
| 6 | Walk & Bike | ampersand, **not** the word "and". Was called Mobility. |
| 7 | What's Nearby | Was called Points of Interest. |

"Ask AI" is not one of the seven and is never walked.

Two chips were renamed, and their internal keys did not change — `data-view=mobility`
with `#mobility-switch`, and `data-view=points-of-interest` with
`#points-of-interest-switch`. So a chip is found by its visible text first, and by
that key when a label is being flaky; the job log says when it fell back to the key.
The old names are still accepted from a script, and a script saved before the
rename is brought up to date on boot: the pin, the spoken line and the caption.
Anything reworded by hand is left alone.

The **spoken** line says "Walk and Bike", because that is how anybody reads it
aloud. The **chip** is "Walk & Bike". Those are deliberately different.

No `/popup/{address}` or `/embed/{address}` page is created for any of this. The
widget is opened at coordinates through the parameters it already supports —
`popup=true` for the tabbed build, since `variant=full` is one long scrolling
report with no tabs at all. The defaults point at the same widget the marketing
site's own demo page loads, and `LISTING_VIDEO_EXPLORER_URL`,
`LISTING_VIDEO_EXPLORER_PARTNER` and `LISTING_VIDEO_EXPLORER_WIDGET` can move it.

The School Explorer card is still drawn from `src/demo-data.js`. Only the
Neighborhood Explorer tabs changed.

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
back, so the first word is never clipped. Dead air is trimmed off the **end** as
well — see [Where the video ends](#where-the-video-ends).

You can also upload an mp3, wav, m4a or webm. That becomes a take like any
other, so it can be tried against the pictures before you commit to it.

### 6. Add the audio to the video

**Keep this take and add the audio to the video** is the only thing that burns
the voice onto the pictures. Nothing is muxed while you are still trying takes,
so re-recording is free and does not cost a render.

#### Where the video ends

**On the last spoken word**, with a breath after it and nothing else.

Videos used to run on for two or three seconds after "Give us a call": the
picture was held for a hardcoded extra second, on top of whatever silence the
voice track already ended with. An AI line is padded out to whatever the script
allowed for, so that silence was often a second or two on its own.

Now the voice track is cut back to its last audible sound, a 0.35s breath is put
after it, and the finished video is exactly as long as that track. If the voice
runs past the planned scenes the last scene is held to cover it; if it finishes
early, the video stops rather than sitting on the card in silence. This applies
to a recorded take and to the AI voice alike.

The silent preview is not trimmed — it stays the script's own length, because it
is what the voice is recorded against.

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
Housing & Market Trends, Commutes, Walk & Bike, What's Nearby.

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
npm test                             # scripts, job delete, address reading, page classification,
                                     # and a real capture against test/fixture-site.js
bash scripts/setup-voice.sh          # optional: installs the built-in AI voice
LISTING_VIDEO_TOKEN=pick-a-password npm start
```

Then open <http://localhost:8788/tools/listing-video>.

Needs Node 20+, `ffmpeg`/`ffprobe`, and Google Chrome or Chromium on the box.
Recording in the browser needs a microphone and a secure context, so use
`localhost` or https.

`npm test` includes a real capture run in Chrome against `test/fixture-site.js`,
whose homepage is the marketing page that got filmed by mistake: a hero photo,
"Search Long Beach Homes" and "Market Report" buttons, the office address in the
footer, and a cookie banner that only closes when Accept is pressed. Starting
from that homepage, capture has to end up on `/listings/123-main-st` with the
banner gone. Those tests skip themselves with a message if there is no Chrome.
To poke at the fixture by hand:

```bash
node test/fixture-site.js 8899      # then open http://127.0.0.1:8899
```

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
| `LISTING_VIDEO_EXPLORER_URL`, `LISTING_VIDEO_EXPLORER_PARTNER`, `LISTING_VIDEO_EXPLORER_WIDGET` | Which Neighborhood Explorer widget the tab beats are filmed from. Defaults to the one the marketing site's demo page loads. |
| `LISTING_VIDEO_GEOCODER` | Address lookup. Defaults to OpenStreetMap's Nominatim, which needs no key. |

### Memory

Headless Chrome is the expensive part of this tool, and on staging it has already
taken the web process down: a capture climbed to 1012MB on a 512MB dyno, Heroku
killed it with R14, and because the disk is ephemeral the half-finished job went
with it.

What keeps it bounded now:

- one browser, one page, and each page closed before the next opens
- images, fonts, analytics and session recording blocked while searching; only
  the page being photographed loads them
- a 1024x768 window while searching, 1920x1080 only for the shot
- Chrome launched in low-end device mode, with its caches capped, its GPU process
  folded into the browser, one renderer, and a 128MB cap per V8 heap — so a
  runaway page fails on its own instead of taking the dyno with it
- DOM scans capped, since reading `innerText` across every element on a large
  page forces a layout each time
- a 60 second budget, and Chrome killed outright if it stops answering

Measured against `www.redwagonteam.com`, the site from the failing run:

| | Before | Now |
| --- | --- | --- |
| Peak Chrome (fair share of shared pages) | 1012MB observed on staging | ~550-620MB |
| Time to finish or refuse | 3+ minutes, then a restart | 15-28 seconds |
| Chrome left running afterwards | leaked on a wedged browser | none |

**A 512MB dyno is still tight.** Chrome idles at about 150MB before it loads
anything, and one real estate page in a renderer is another 250-300MB. If staging
keeps hitting R14, the fix is a bigger dyno — Standard-2X has 1GB — rather than
more tuning here. What has changed is that the failure is now bounded and
recoverable instead of a silent hang.

### Disk

Each job keeps its stills so a re-recorded take can be re-timed against the same
pictures without opening Chrome again. That is roughly 5-10MB per video on top of
the mp4. Deleting a video from the Library takes all of it.

The staging disk is **ephemeral**: if the dyno restarts, jobs in progress and
finished mp4s go with it. The tool copes rather than hanging — a poll that comes
back 404 now says the server restarted and offers to start again — but a watch
link for a video made before a restart will 404.

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
src/browser.js               Chrome, kept small, and killed for certain
src/capture.js               opens their site, accepts cookies, walks to a listing
src/page-analysis.js         is this one listing or a landing page, and what address
src/frames.js                turns each beat into a 1920x1080 still
src/video.js                 ffmpeg: the silent cut, then the voiced cut
src/audio.js                 recorded takes, the optional AI voice, 0.6s lead silence
src/render.js                phase one (silent picture) and phase two (attach audio)
src/store.js                 jobs on disk, the library list, delete
src/mail.js                  the two from-addresses, honest "not connected" state
src/demo-data.js             the demo neighborhood shown inside the School Explorer card
src/explorer.js              films the live Neighborhood Explorer, one tab at a time
src/geocode.js               the listing's address as coordinates, checked against its town
views/frame.html             the frame: top caption bar, popup button, SE and NE cards
public/                      the three tabs and the public watch page
test/                        node --test smoke tests
test/fixture-site.js         a stand-in realtor site built from the pages that broke
test/client.test.js          the front end in Chrome: a lost job must not hang
```
