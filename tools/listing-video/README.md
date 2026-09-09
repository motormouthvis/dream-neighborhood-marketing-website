# Listing Video Maker (internal, staging only)

An internal tool for marketing. Bill and Myles pick a script, fill in the
customer, record their own voice over a silent video, hear it against the
pictures, add it to the video, review the finished file, and send a shareable
link.

The picture normally comes from one of the customer's own live listings. Some
sites refuse an automated browser and will go on refusing it, so the picture can
also be **uploaded** — a screenshot taken in a real browser, plus the address
picked from the Explorer's own suggestions — and their site is then never opened at
all. See
[When their site will not be filmed at all](#when-their-site-will-not-be-filmed-at-all).

Both Explorer popups in the video are **photographs of the live product** at that
listing's address. Neither is drawn by this tool. See
[Filming the Explorers](#filming-the-explorers).

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

The line about the same button upgrading plays on a **`listing-tap`** beat, so the
house button is in frame and being pressed while the words are said, and the
Neighborhood Explorer popup arrives from the button rather than from nowhere. It
used to play over a School Explorer card, which covers the button — so the button
the line is about was never seen. Same words, different scene.

The first two are the approved v11 videos and are a before-and-after: they need a
listing with nothing on it yet. The upgrade script is the opposite — it wants a
listing that already has School Explorer, because that is the customer it is
talking to. Each script says which it needs, and capture obeys it.

### 2. Fill in the customer

First name, company, website URL, customer email. There is also an optional
**Listing page URL** for when you already know the exact listing you want.

**Where does the listing picture come from?** is normally *their live site*, and
that is the whole flow below. The other choice — *a screenshot I upload* — is for
a site that refuses an automated browser outright, and is described in
[When their site will not be filmed at all](#when-their-site-will-not-be-filmed-at-all).

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

#### The last look, one line before the shutter

That check is made **twice**, and the second one is the one that counts: on the
page as it stands at the moment it is photographed.

It used to be made once, while capture was looking the site over, and that turned
out to be the wrong page. A capture loads the listing **twice** — cheaply for the
crawl, with images, fonts and every analytics host blocked, and then again at full
size with nothing blocked for the photograph. Everything in that gap is a way for
the Explorer to be in the picture having been absent from the check. The clearest
is a **tag manager**: our snippet is often installed through Google Tag Manager,
`googletagmanager.com` is on the blocked list, so the crawl sees a clean listing —
and then the shot loads the tag manager, the tag manager injects the Explorer, and
the "before" video opens on a listing that already has one.

Which is what Bill got. He picked *a listing with no Explorer on it yet* and the
Neighborhood Explorer was sitting on the listing in the finished video.

So the page is asked once more, after everything has loaded and the overlays have
been cleared, one line before the shutter. What is in **this** picture is the only
thing "the before shot" can mean.

- Under **absent**, an Explorer found there is a refusal, and the message says it
  appeared once the page had fully loaded — otherwise the refusal reads as
  nonsense to somebody who watched that page load clean.
- Under **prefer-present**, it drops the note promising School Explorer would be
  drawn onto the opening shot, which by then would tell whoever reviews the video
  the opposite of what they are looking at.

**Only a real embed refuses.** The words "School Explorer" in a page's own copy
stay a hint worth recording, not grounds for throwing away a listing that is
otherwise ready to photograph. Open **shadow roots** are searched as well as the
page itself, since a floating widget that renders into one is invisible both to
`querySelectorAll` and to `innerText`.

**Nothing can check an uploaded screenshot.** There is no live page on that path
and reading one off the pixels would be guessing, so an upload on a before-shot
script says so plainly in the notes beside the video, for the person who can see
the picture and settle it in a second.

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

Two more things an IDX heading does, both of which put the wrong place in the
video:

- **A road named by a number.** `252 COUNTY RD 156` came out as `252 County Rd`,
  because the pattern stopped at the street type. Numbered rural roads are matched
  first now, so `Highway 50 W`, `FM 1960 Rd W` and `State Route 9 N` parse too.
- **A state spelled out.** `ABIQUIU, NEW MEXICO 87510` was not recognised, because
  only two-letter codes were accepted, so the town fell through to whatever the
  page said elsewhere — `Placitas, NM 87043`, the agent's own patch, 150 miles from
  the house and where the Explorer would have been pointed. Full state names are
  accepted and normalised to the code, and a state-shaped string that is not a
  state gives no town at all rather than a wrong one.

#### A pasted listing has to stay put

The URL is judged on **where the browser landed**, not on where it was sent. IDX
sometimes answers a details URL by bouncing to its own search results, seeded with
that listing's county and city — `/idx/results/listings?county[]=146&city[]=34718`.
Trusting the pasted URL meant filming that results page as though it were the
house, and since a results page has no address on it, the job then died at the
Explorer with "did not give an address to look up".

Now that is a refusal that says what happened, with a picture of the page it
landed on.

#### Nothing that goes somewhere gets clicked

The overlay pass will not click a link with a real destination. A close control is
a button, or an anchor going nowhere — no `href`, `#`, or `javascript:`.

This is not hypothetical. IDX renders a listing's own field values as links to a
search for other listings with that value, and one of those values is the flood
zone: **`X`**. "X" is also the commonest close-button glyph there is, so the pass
clicked it, IDX navigated to `?a_floodZoneCode=X`, and the search results page got
filmed instead of 14918 Cranes Nest Court, Orlando.

#### No address, no video

The address is the tooltip on the house button and it is where the Neighborhood
Explorer gets pointed, so a page that gives up no street address is refused rather
than filmed. Otherwise the failure lands *after* the render, which is a far worse
place to find out. Nothing is guessed at.

It is read twice: once when the page is judged, and again just before the shutter,
because on a client-drawn listing the heading can arrive in between.

**IDX headings are assembled from spans**, one per part:

```html
<h1 id="IDX-detailsAddress">
  <span class="IDX-detailsAddressNumber">14918 </span>
  <span class="IDX-detailsAddressName">Cranes Nest Court</span>
  <span class="IDX-detailsEndAddressComma">,&nbsp;</span>
  <span class="IDX-detailsAddressCity">Orlando</span>
  <span class="IDX-detailsAddressStateAbrv">FL&nbsp;</span>
  <span class="IDX-detailsAddressZipcode">32824</span>
</h1>
```

Those parts are read individually and assembled — **including the direction**,
which is its own span and sits either before or after the street name. Leaving it
out turned `1908 SW MILES ST` into `1908 MILES ST`, a different quadrant of
Portland, and because the assembled candidate is tried before the heading it won.

The assembly now has to **agree with what is on the screen**: if the pieces it
read do not appear in the heading as written, some span it does not know about is
carrying part of the address, so the assembly is dropped and the heading is used
instead. That makes it safe by construction rather than by knowing every span
name.

The city/state pattern also accepts a space in front of the comma (that markup can
lay out as `14918 Cranes Nest Court , Orlando , FL 32824`) and a comma between the
state and the ZIP, which is how kvCORE writes a title:
`1978 Arvis Circle W, Clearwater, FL, 33764`. Without that, the town could not be
parsed from the title and an office address further down the page supplied
`Trinity, FL 34655` — 20 miles from the house, and where the Explorer would have
been pointed. **The town now comes from the same string as the street**, and a ZIP
in that string is kept even when the town will not parse, rather than importing a
different one from elsewhere on the page.

These pages carry no structured data at all and their title has no street in it,
so the heading is the only place the address exists.

#### Addresses that are not simply "number street type"

| Written as | Why it needed handling |
| --- | --- |
| `73-4474 ANIANI ST` | Hawaii puts the district before a hyphen. A bare house number was required, so the heading yielded nothing and the page only survived on its structured data. |
| `850 E Ocean Boulevard B3`, `1200 Main St #1`, `77 Harbor Way Unit 5` | A unit on the heading is part of the address, so it stays. The geocoder drops it for a looser lookup if the pair will not resolve. |
| `252 County Rd 156`, `1420 State Route 9` | A road named by a number. The route number is not taken when a spec row follows it, so `4497 Chase Drive 3 beds` is not Chase Drive number 3. |

#### A list of other things is not this page's subject

`ItemList`, `Event`, `ListItem` and friends are skipped in structured data, and the
walk does not go inside one. A Coldwell Banker city page carries an `ItemList` of
open house `Event`s, each naming a real house — reading one made a city landing
page look like a listing for that house. Now the search furniture on the page
decides, and it is correctly refused as a search page.

#### A site that opens on its own search

A homepage that bounces straight onto the site's IDX search — as
`homes.dukecitysunrise.com` does — has no listing on the page it lands on. Its
listings are still there, so one is fetched the site's own way rather than
refusing on the spot:

1. **Map Search** first, because that is the control on the page. On IDX the map
   is an Azure/Leaflet canvas that reports "Found 0 of 0" to a headless browser
   however long it is given, with or without WebGL, so this usually comes back
   empty — but it is still tried, because it is what a person would click.
2. Then their plain results list (`/idx/results/listings`), which is one page and
   is where the listing links actually are.
3. Then **exactly one** listing detail page is opened, cookies accepted, filmed.

One listing, because that is the number IDX counts. If the first one it reaches
is unusable — an account wall, an Explorer already on it, an overlay that will not
close — that is the end of it; there is no going back for a second, which is what
raises the wall. No account is created, no form is filled in, and nothing that
could register anybody is clicked.

If neither route reaches a listing, it refuses and asks for a listing URL. That
site loads perfectly well and its "MY SEARCH & LOGIN" link is optional, so the
refusal says its search came back empty — not that the site is missing or gated.

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
- **Both** cards are photographs of the live product at this listing's own
  address — the School Explorer's schools list, and each Neighborhood Explorer
  tab. See [Filming the Explorers](#filming-the-explorers).

#### Filming the Explorers

Neither card is drawn by this tool. Both are screenshots of the real product
opened at **this listing's address**, so nothing on screen can be about anywhere
else.

Both were drawn once, and both went wrong the same way:

- The **Neighborhood Explorer** card was ours, and between tab beats only the
  highlighted chip moved while the body stayed on Map and Summary — so Schools,
  Commutes and Walk & Bike all showed the same income and rent bars.
- The **School Explorer** card was ours too, drawn from a fixed list: the eight
  schools of the neighborhood in the approved reference video. Every video ever
  made showed *Smyrna, GA · Cobb County School District*, Nickajack Elementary and
  Griffin Middle, whatever address it was about. Bill found it on a listing at
  6031 N Rosemead Dr, Peoria, IL: he typed the Peoria address, and the School
  Explorer in the video was about Georgia. It was not the wrong address — the card
  was not the product.

Because each beat is now one photograph, nothing in a card can disagree with
anything else in it, or with the address the video is about.

How it runs, after the listing still is in hand:

1. The listing browser is **closed first**. It is deliberately starved to survive
   a small dyno, and the Explorer's map needs WebGL — without a GPU the widget
   sits on "Loading location..." forever. The walks get their own browser, so only
   one Chrome is ever alive at a time.
2. The address is turned into coordinates **once**, and both Explorers are filmed
   at that one point, so they cannot be about two different places. On the upload
   path the address is already a place the Explorer named and resolved before the
   job started — see
   [The address is picked from the Explorer's own suggestions](#the-address-is-picked-from-the-explorers-own-suggestions).
   Otherwise the address read off the realtor page is looked up: the Explorer's own
   geocoder first, since it is the one that decides what the Explorer shows, and
   OpenStreetMap behind it. Every answer is checked against the town and state the
   listing gave, because a loose geocode once put "123 Main St, Long Beach, CA" in
   Lake Huron. If only the town or postcode resolves, the job log says the Explorer
   was centred nearby.
3. The **School Explorer** embed is opened at that address and photographed. It
   refuses if it will not load schools, because a card of our own is the bug.
4. The **Neighborhood Explorer** widget is opened at the same coordinates, and each
   tab is clicked and photographed once its own content has arrived and stopped
   moving.

Where each one landed is written into the job and shown beside the silent video —
*"The School Explorer in this video is the live product at Peoria, IL · Peoria Sd
150 School District, showing 30 schools nearby"* — so the review can see it is
about the right house before anything is sent. That is the check nobody had on the
video Bill was sent.

#### The School Explorer beats

A script has more than one School Explorer beat, so the list is photographed
scrolled a little further each time and each beat gets its own picture, up to
three. A short list gives fewer, and the last one is held rather than running out.

It refuses rather than falling back to anything drawn by us:

| What happened | What it says |
| --- | --- |
| the address cannot be placed | it could not place that address, so it has no schools for it |
| it loads, but never lists schools | it did not load any schools for that address, try again in a minute |
| it takes too long to photograph | it took too long, try again |

Every refusal saves a picture of the popup as it stood, which usually answers
"why" faster than the message does: its own front door with the search box on it
means it never got the address at all.

#### How big the popup is, and how sharp

The shots used to be taken at **1340x764 at one device pixel per CSS pixel** and
dropped into a card that size inside a 1920x1080 frame. Sixteen-pixel text in the
widget stayed sixteen pixels in the video and went soft through H.264 — which is
why it read as small, washed out and hard to read.

Now the card is **1600x700** and the shot is taken at **twice the pixels**, so the
text is drawn at 2x and scaled down. Same layout, twice the detail.

That height is measured, not guessed. At 1600 wide the widget lays its content out
to about 664px whatever the viewport height, so a taller card only adds white
space — and white space inside the card is part of what made the popup look small.

#### It has to look like a popup, not a pale rectangle

The listing behind an explorer card is **dimmed**. It used to be washed with
`rgba(255, 255, 255, 0.5)` — white — which bleached the listing so that a white
card sitting on it had no edge to see. On a light listing the popup disappeared
into the page.

Around each Explorer shot the video draws that popup's own **chrome**: a border, a
strong shadow, a header bar with the product's name and the address being shown,
and an **X** in the corner. The shots are of the inner widget and the inner embed,
so the real popups' headers and close buttons are not in them — without this there
was no header and no way out anywhere in the video.

The Neighborhood Explorer's header is white with green type, as its own popup's is;
the School Explorer's is a solid green bar with white type, as its own popup's is.

That is chrome and nothing else. No tabs, no schools, no ratings and no Explorer
features are invented: everything inside the frame is the photograph of the real
product.

**Both cards are the same size and in the same place** — 1600x780 at 150,168 — so
the upgrade script's "same button, it just does more" cuts between two popups
rather than between two differently shaped rectangles. The School Explorer card was
1340x764, the size the approved v11 cuts used for the drawing; now that it holds a
photograph it is filmed and framed like the other one, which is also what fixed it
reading small and washed out.

There is a test that renders a card over a white listing and measures the pixels:
the listing has to get **darker**, the card has to stay bright, and the header and
the X have to be there.

#### Each tab is filmed in its own sections

A tab beat is worth **one still per shot of that tab**, and the beat's seconds are
shared out between them, so a scene is never a single still of the top of a tab
that carries on below the fold. The scene lengths the script asked for do not
change, and neither does the timing of a recorded voice.

The panel is found by which element actually overflows rather than by a class name
that could be renamed, and scrolling stops as soon as the panel will not move — so
a tab is never photographed twice in the same place. Up to three shots per tab.

In practice the bigger card means most tabs now **fit whole**: only Schools (a long
list of school cards) and What's Nearby have anything below the fold.

**What's Nearby is one shot on purpose.** It is a list, and three places make the
point without scrolling through it.

It refuses rather than falling back to anything drawn by us:

| What happened | What it says |
| --- | --- |
| the address cannot be placed on the map | that address could not be found, try a different listing |
| the page gave a street but no town | it is looked up on the street alone, and the job log says so, because there was nothing to check the answer against |
| the street is not on the map at all | the town or the ZIP is used instead, and the video is still made. The job log says the Explorer was only centred nearby, and `job.explorer.precision` records it. A missing street is common on new builds and rural roads, and refusing would block a video over something the reviewer can see for themselves. |
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
`#points-of-interest-switch`. A chip is looked for in this order:

1. its **current label**, so a box still showing an old label cannot win over a
   current one,
2. **what it used to be called** — `Mobility`, `Points of Interest`, `POI` — because
   staging and production are not always on the same build,
3. the **key** behind it, when a label is being flaky. The job log says when it
   fell back to the key.

Whichever name a script asks by, the shots come back under the current names, so a
frame and its caption cannot disagree with the product. A script saved before the
rename is brought up to date on boot — the pin, the spoken line and the caption —
and anything reworded by hand is left alone.

**On `&` versus the word "and":** the live widget draws `Walk & Bike` with an
ampersand, and there is a test that reads the chips off the product and fails if
that changes. Typing `Walk and Bike` into a script works anyway, because matching
treats the two as the same thing — but the stored chip, and the caption, use the
ampersand the product uses.

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

**The script sits beside the video, not under it.** On a desktop this step is two
columns — the pictures on the left, the words on the right — because it is the one
place two things have to be watched at once. The line being spoken is highlighted
and scrolls itself as the video plays, both while recording and while playing a
take back against it. The step is wider than the rest of the tool so the video does
not shrink to make room, and on a narrow screen the two stack.

Dead air is trimmed off the front of a take and a known 0.6s of silence is put
back, so the first word is never clipped. Dead air is trimmed off the **end** as
well — see [How long the finished video is](#how-long-the-finished-video-is).

You can also upload an mp3, wav, m4a or webm. That becomes a take like any
other, so it can be tried against the pictures before you commit to it.

### 6. Add the audio to the video

**Keep this take and add the audio to the video** is the only thing that burns
the voice onto the pictures. Nothing is muxed while you are still trying takes,
so re-recording is free and does not cost a render.

#### How long the finished video is

**The same length as the silent cut.** That is the picture that was approved, so
that is the video:

| Silent cut | Voice | Finished video |
| --- | --- | --- |
| 60s | 30s | **60s** — the picture holds, the audio stops |
| 12s | 12s | **12s** |

Nothing is padded on after the last word, and the picture is **never cut back to
the voice**. If a video should end sooner than the script does, that is a
person's call, made with [the trim](#trimming-the-end-off).

The one exception is a voice that runs *past* the script, and it exists so nobody
is clipped mid-word: the last scene is held to cover it.

Dead air is still cut off the end of the voice *track*, for a recorded take and
for the AI voice. That is about the audio, not the picture: a take stopped ten
seconds late would otherwise be ten seconds longer than the script and drag the
picture out with it.

One thing can make it shorter, and it is a person: [trimming on the final
review](#trimming-the-end-off).

Dead air is still cut off the end of the voice *track*, both for a recorded take
and for the AI voice. That is about the audio, not the picture — an AI line is
padded out to whatever the script allowed for, and a take is usually stopped a
moment after the last word, so a track can carry seconds of nothing. Left there,
that silence would push the video past the length of the script. It cannot make
the video shorter.

### 7. Final review, then send

The finished file plays with sound: picture and voice as one video, exactly what
the customer will see. **Send stays switched off** until you have watched it
through or ticked *I reviewed this*. The server refuses the send either way, so
there is no silent fake send. Going back and keeping another take clears the
review, because the new file has not been reviewed.

If SMTP is not configured the UI says **"Mailbox not connected"**, the send
button stays off, and you get the watch link plus the whole email text to copy
and send yourself. It never reports a send that did not happen.

#### Trimming the end off

The only thing that shortens a video, and it is deliberate rather than automatic.

On the final review, **pause the player exactly where you want the video to
finish** and press **Trim Remainder of Video**. Everything after the playhead
goes, picture and audio together. It asks first, and it cannot be undone.

The button is only live while the player is paused, because the playhead *is* the
cut — there is nothing being guessed at. It says what it is about to do ("would
end at 0:42, cutting 0:18") before you press it.

**The trim is a queued job, and the step is covered while it runs.** It used to
re-encode on the HTTP request, which is what Bill's "That video was not trimmed"
was: a minute of 1080p takes longer than Heroku's 30 second router timeout, and
the request also had to wait behind any render already in the queue, so the
browser was handed a dead connection for a trim that was still running. Now the
route accepts the trim, answers `202`, and the browser waits on the job the way it
waits on a capture.

While it runs, a cover sits over the whole review step: nothing can be sent,
marked reviewed, copied, or taken back to recording, and the send button reads
*Trimming…*. **Stop waiting** gets out of the wait — the trim carries on, and the
video will be there in the Library a minute later. A trim that fails puts the
reason on the job and the step back the way it was, with the original video
untouched; the cut is written beside it and only renamed over it once ffmpeg has
finished. ffmpeg's own last words are surfaced rather than a bare "that video was
not trimmed".

The cut is re-encoded rather than stream-copied. A stream copy cuts at the
previous keyframe, which would leave up to a couple of seconds of whatever you
wanted rid of.

A playhead and ffprobe disagree by a frame or so, and a cut is not refused over
that — the time is pulled just inside the end of the file instead. Only a genuine
"there is nothing left to remove" is refused, and the button is dead in that state
so the server is never asked for a cut it would decline. It writes over the finished file, so the watch link keeps working,
and it **clears the review** — what you approved is not what the file is now, so
send switches off until you have watched it again. Nothing shorter than three
seconds, and trimming at the end is refused rather than re-encoding for nothing.

Afterwards the player reloads the shorter file and **sits just before its new
end**, paused, so you can see where it now finishes without hunting for it.

That is the whole feature: pause, one button. There are no in and out handles, no
timeline, and no box to type a number of seconds into.

### 8. Hosting

Every finished video gets a public watch page at `/v/{id}`. Anyone with the link
can play it, no sign-in and no Loom. Once a video is deleted, that page and its
mp4 return 404.

### 9. Library

The **Library** tab lists every video on the box: customer, company, script,
date, status and watch link. Play it, copy the link, open it to send it, or
delete it. Delete asks for confirmation and then removes the mp4, the poster,
the stills and the record that makes `/v/{id}` work.

### When it fails, it says so afterwards

A capture that fails is not thrown away. The red box in the browser is gone as
soon as the tab is closed, and by the time anybody asks about it the dyno has
usually moved on, so every failure leaves three things behind.

**The job stays in the Library, marked "Did not finish."** Its card carries the
same message the maker showed, the error code, the HTTP status if the site gave
one, what the page was read as (search, wall, marketing, index), and the page it
stopped on.

**A picture of what Chrome actually saw**, taken before the browser closes,
because afterwards is too late. That is the useful part: "No single listing page
could be found" reads very differently next to a screenshot of a search form, an
account wall, or a 403. It lives in the job's own directory, so deleting the job
takes it too, and it is served only from there — a doctored path cannot read
anything else off the disk.

**A line in `failures.jsonl`** under the data dir. One JSON object per line,
appended, so a crash halfway through a write costs one record rather than the
lot, and it can be read with `tail`. Each line has:

| Field | What it is |
| --- | --- |
| `at` | when it happened |
| `jobId` | the job, so the Library card and the picture can be found |
| `firstName`, `company` | who it was for |
| `websiteUrl`, `listingUrl` | what it was given |
| `stage` | `capture`, `uploaded-picture`, `explorer-walk`, `geocode` or `render` |
| `errorCode` | `NO_LISTING_FOUND`, `SITE_BLOCKED`, `REGISTRATION_WALL`, `SITE_IS_SEARCH_ONLY`, `CAPTURE_TIMED_OUT`, `EXPLORER_TAB_MISSING`, `LISTING_IMAGE_NOT_AN_IMAGE`, and so on |
| `reason` | the message Bill saw, cut to one line |
| `httpStatus` | only when a status caused it. A refusal that was not about a status does not claim one — the last page to load might have been a 404 on a path we guessed at |
| `pageKind` | what the page was classified as, if it was |
| `pageUrl` | the page it stopped on, which is the page in the screenshot |
| `pagesChecked` | how many were looked at |
| `screenshot` | where the picture is |

`GET /tools/listing-video/api/failures` lists them newest first, behind the same
password as everything else, with `screenshotUrl` instead of the path on disk.
`?limit=` takes 1 to 200 and defaults to 50.

**There is no Slack from here.** This app has no bot token, and one is not being
added. The log and that endpoint are the report.

Both of these live on the dyno's own disk, so they go when it restarts — the same
as the jobs and the videos. They answer "what happened on that job just now", not
"what happened last month". See [Disk](#disk).

---

## When their site will not be filmed at all

Some sites refuse an automated browser and go on refusing it. Scott Rodgers Real
Estate answers 403 on every page that holds a listing; refusing us is what they
are paying for, and no user agent changes that.

Until this existed, that was the end of the road. Bill's panel said *"blocked the
capture on 4 pages (HTTP 403)"* and offered him one thing — paste a listing URL —
and the listing URL is refused in the same way. Nowhere to go.

### Upload the listing picture instead

Open the listing in your own browser, where it loads perfectly. Screenshot the
page. Upload it, with the address.

**No browser is opened on this path at all.** That is the point: their site is
never asked for anything, so it has nothing left to refuse. Everything after the
picture is identical — the scenes, both Explorer popups, the silent cut, the
voice, the review, the send.

It is offered in two places:

- **On the failure panel**, where the refusal actually happened. For a refusal by
  HTTP status it is open and explained, because at that point it is not an
  alternative, it is the answer. Other capture failures get it too, folded away,
  as a way out.
- **On the form**, so a site already known to block us does not have to fail once
  first. Picking it hides the Listing page URL box — a URL and a screenshot would
  be two answers to one question, and the upload would win silently.

### The address is typed in, and never read off the picture

There is no OCR here, on purpose, and no guessing from the file name.

The Explorers are pointed at **coordinates**. A house number misread off a
screenshot would film another street's schools, commutes and walk scores while
looking completely convincing — a wrong video that reviews as a right one. So the
address is typed by the person who can see the listing, or there is no video.

### The address is picked from the Explorer's own suggestions

Typing it is not enough on its own. It used to be four free-text boxes, and Bill's
Peoria job showed why that is not the same thing as an address: nothing checked
what he typed until a job was already running, and a geocoder will answer a loose
query with a street of the same name somewhere else. "123 Main St, Long Beach, CA"
comes back in El Segundo.

So the box is **the Neighborhood Explorer's own place picker** — not a second one
built here. As you type, the Explorer's `autocomplete` endpoint is asked what it
would offer, and the suggestion you pick is resolved by the Explorer's own
`geocode` endpoint. Both live beside the widget URL, so moving
`LISTING_VIDEO_EXPLORER_URL` to staging moves the picker with it, and the address
behind a job is one the Explorer itself named and placed.

They are proxied through `GET /api/places` rather than called from the browser, so
the tool stays one origin and CORS never comes into it.

What that buys:

- The address is settled **before the job exists**. An address the Explorer cannot
  place is a form to send back — "pick one of the suggestions" — not a video a
  minute later that filmed the wrong town.
- Both Explorers are filmed at exactly the point the picker resolved. Nothing is
  looked up a second time, so nothing can come back differently.
- Typing the whole address by hand still works, because a picker that will not
  suggest must not be a dead end. Free text is resolved the same way and checked
  against the town that was typed: if the Explorer places it somewhere else, the
  form says where and asks you to pick from the list.
- A picker that **cannot be reached** blocks nothing. The address goes on as typed
  and is looked up at render time, where the town check and OpenStreetMap are both
  still there. The form says the lookup was unreachable rather than looking like it
  has no suggestions.

### What is accepted

| | |
| --- | --- |
| Types | PNG or JPG. Checked by **signature**, not by what the upload claims — a browser will label a file whatever it likes |
| Size | Up to 12MB |
| Smallest | 320px on both sides; below that the video is just blurry |
| Shape | Anything. It is **fitted whole and never cropped** — the address is usually near an edge, and cropping to fill would cut off the one thing the video is about |

A screenshot of a browser window is about 16:9, so the common case scales to
exactly 1920x1080 and is padded by nothing at all. A full-page grab is shown
whole and small rather than cropped to its top strip.

### It says so afterwards

A video built this way is not a capture of their site, and nothing pretends it
is. The record step reads *"on the screenshot you uploaded for 6031 N Rosemead
Dr"* rather than *"filmed on their listing for…"*, there is no captured page URL
because no page was filmed, and a note names the file and repeats the address
that was typed so the map can be checked in the review.

Beside it, a note says where each Explorer was actually filmed — *"the live product
at Peoria, IL · Peoria Sd 150 School District, showing 30 schools nearby"* — which
is the line that would have said "Smyrna, GA · Cobb County School District" on the
video Bill was sent, and nothing said it at all.

Retrying with a listing URL means going back to the live site, so it drops the
upload. Leaving it in place would let the upload win silently while the pasted
URL looked ignored.

### Best-effort 403 hardening, and what it is not

Two things changed in how the site is *asked*, and one in **who is asking**.
None of them is a bypass.

- **A refusal is not retried.** Loading the same URL again seconds after being
  refused is the worst thing to do with one: the site has just decided about us,
  and a repeat hit is what rate limiters count. A timeout still gets a second go.
- **The crawl stops after two refusals** instead of collecting four. Bill's run
  walked four pages and was refused four times; pages three and four told us
  nothing the second had not, and left two more hits in their logs.
- **The request stopped contradicting itself**, which is the rest of this
  section.

#### One persona, and everything agreeing with it

`src/persona.js` holds the user agent, the client hints, the language and the
platform in one place, because the thing bot protection actually reads is not
any single header being wrong — it is **two of them disagreeing**. A browser
that answers the same question two different ways has said something no ordinary
visitor says, and the disagreement is worth more to a scoring engine than either
answer on its own.

Four disagreements have been live at different points, and all four are gone:

| It said | And it also said | Caught by |
| --- | --- | --- |
| `Chrome/131` in the user agent | `HeadlessChrome` in `Sec-CH-UA` | reading one header |
| `Chrome/131` in the user agent | Chrome **148** actually making the request | comparing to the TLS handshake, or just noticing a user agent a year behind stable |
| `macOS` in the user agent and hints | `Linux x86_64` in `navigator.platform` | one line of JavaScript |
| `navigator.webdriver === undefined` | every real Chrome answers `false` | one line of JavaScript |

The persona is now **built from the browser at launch** rather than typed into a
constant, so it cannot go stale when the dyno's Chrome is upgraded:

- The version comes from the running Chrome. The user agent carries the major
  with the minor parts zeroed, exactly as Chrome writes it, and the real full
  version goes out in `Sec-CH-UA-Full-Version-List`.
- The `Sec-CH-UA` brand list is **Chrome's own**, read from the live browser —
  including the deliberately silly GREASE entry, which is a different string in
  every Chrome version and is therefore the giveaway in any hand-written list.
  The one thing never taken from Chrome is a brand containing `Headless`.
- The operating system is named consistently in all three places a page can ask:
  the user agent string, `Sec-CH-UA-Platform`, and `navigator.platform`. Windows
  by default, because it is the least remarkable thing to be; see
  `LISTING_VIDEO_PERSONA`.
- `navigator.webdriver` answers `false`, which is what an ordinary Chrome
  answers. It used to be forced to `undefined`, and that is worse: a navigator
  with no `webdriver` property at all is not a browser anybody ships, so it swaps
  a known tell for a stranger one. Chrome launched with
  `--disable-blink-features=AutomationControlled` already answers `false` on its
  own, so the page script only steps in if it finds the bit still set.

#### The headers Chrome writes are left alone, on purpose

`Accept`, `Accept-Encoding` and the `Sec-Fetch-*` family are **not** set by this
tool, and that is a decision rather than an omission. Chrome already writes all
of them correctly, and differently for a navigation, a stylesheet and an image.
Pinning one value would put `Sec-Fetch-Dest: document` on every image on the
page, which is a louder tell than anything it would fix.

`Accept-Language` is set at **launch**, with `--accept-lang`, not with
`setExtraHTTPHeaders`. Two reasons, both found by reading the bytes that reached
a server rather than the code that sent them:

- **Order.** Chrome sends `Accept-Language` last, after `Accept-Encoding`. An
  extra header is appended by the automation layer and lands in the middle,
  ahead of `Accept`. Header order is a fingerprint in its own right, and an order
  no Chrome produces is a signal created by trying to help.
- **Value.** Chrome writes the q-values itself. Given `--accept-lang=en-US,en` it
  sends `en-US,en;q=0.9`; handed the q-values it applies them twice and sends
  `en-US,en;q=0.9,en;q=0.9;q=0.8`, which is stranger than sending nothing.

`AcceptCHFrame` was also removed from the disabled-features list. It is not a
memory feature — it is how Chrome answers a site that asks for client hints at
connection setup over HTTP/2 — and having it off meant staying silent where a
real Chrome would answer.

The whole navigation now leaves in Chrome's own order, with Chrome's own values:

```
sec-ch-ua, sec-ch-ua-mobile, sec-ch-ua-platform, upgrade-insecure-requests,
user-agent, accept, sec-fetch-site, sec-fetch-mode, sec-fetch-user,
sec-fetch-dest, accept-encoding, accept-language
```

`test/capture.test.js` asserts that against a real socket — the values, the
agreement between them, and the order — and `test/persona.test.js` covers the
rules behind them on a machine with no Chrome.

#### What headers cannot fix

**A site that fingerprints properly still knows**, and this is the honest list of
why. None of it is reachable from a header:

- **The IP.** The request comes from a Heroku dyno in a datacentre range. Bot
  protection buys that list, and for many products it alone is enough. This is by
  far the biggest one.
- **TLS and HTTP/2.** The handshake, the cipher order and the HTTP/2 SETTINGS
  frame are the real Chrome build's, and are what a JA3/JA4 check reads. They
  agree with the persona now that the version is honest, but they cannot be
  edited into agreement with something else.
- **The machine.** No GPU worth the name, no real fonts, a headless canvas and a
  clock in UTC. A US persona in a container's font list does not survive a
  serious fingerprint.
- **Behaviour.** No mouse ever moves, nothing hovers, pages are asked for faster
  than a person reads them, and the visit arrives with no history and no referer.
- **Being an unknown visitor every time**, which is deliberate: the throwaway
  profile that stops IDX view counters also means we never look like a returning
  human.

Scott Rodgers is expected to carry on refusing, and the upload is what actually
gets that video made there.

### A pasted detail URL is one house, not a search page

Worth calling out separately, because it was the other half of Bill's failure and
had nothing to do with the 403.

Scott Rodgers writes one listing as
`/property-search/detail/362/PA1269955/6031-n-rosemead-dr-peoria-il-61614`.
No single-listing URL pattern matched that shape, while `property-search` **does**
match the search pattern — so the URL he pasted was read as the site's search
page.

That is why his run crawled at all. Being taken for a search page made capture
ignore the house he had named and go hunting for one of its own choosing, and it
was those four crawl hops that came back 403. A pasted detail URL is now one hit
on the page he asked for. kvCORE, Real Estate Webmasters and Placester shapes are
covered too.

---

## Signing in to a realtor site (the QUAL account)

Separate problem, separate answer, and the two get confused.

An **account wall** is a door with a form on it: the site served us a page, and
that page asks us to log in. Capture used to refuse those outright and say "paste
a listing URL", which is no help when every listing is behind the same door. With
the QUAL account configured it fills the sign-in form in, and if the key turns it
opens the listing again and films it.

**It does nothing whatsoever for a 403**, and the difference matters. A 403 is bot
protection refusing to send the page at all — there is no form, no page and
nothing to sign in to. Credentials are not even offered to a site that has already
refused us. Scott Rodgers is that case, and the upload is what works there.

### Switching it on

Off unless **both** `LISTING_VIDEO_QUAL_EMAIL` and `LISTING_VIDEO_QUAL_PASSWORD`
are set. They are set on staging and not on production, and that is what keeps
this off production — not a flag somebody could flip by accident.

| Setting | What it does |
| --- | --- |
| `LISTING_VIDEO_QUAL_EMAIL` | The QUAL account's address. **Both this and the password are required**; either on its own is off |
| `LISTING_VIDEO_QUAL_PASSWORD` | Its password. Never logged, and never sent to the browser |
| `LISTING_VIDEO_QUAL_NAME` | Name to put in a registration form. Defaults to `Motormouth QUAL` |
| `LISTING_VIDEO_QUAL_PHONE` | Phone for a registration form that insists on one |
| `LISTING_VIDEO_QUAL_HOSTS` | Comma-separated hostnames. **Empty means any site**; a list is an allowlist, which is the safer way to switch this on one customer at a time |
| `LISTING_VIDEO_QUAL_REGISTER` | Allow **creating** an account. Off. See below |

### Why registering is its own switch, and off

Signing in to an account that already exists is quiet.

**Registering is not.** Creating an account on an IDX site is precisely how that
site's agent gets a "you have a new lead" email, and not emailing realtors is a
hard rule here. So it has to be turned on deliberately, ideally alongside
`LISTING_VIDEO_QUAL_HOSTS`, for a site where somebody has decided that is
acceptable.

### What it will and will not do

- Tried **once per capture**, and only when the page we were served was read as a
  wall.
- The sign-in form is preferred over the registration form on the same page. Two
  password boxes, or a "confirm password", means it is a registration form.
- A form mentioning card numbers, billing or payment is never touched.
- One hop to a "already have an account? sign in" link, and no more.
- Success is judged on the **page having stopped asking** — a sign-out link, an
  account link, or the password box being gone. A form that submits and comes back
  with the same password box on it has not signed anybody in.
- A wall it could not get past is still a refusal, and says the key was tried and
  did not turn, which is a different problem to there being no key at all.

A video filmed behind a login **says so on the job**, because the page a
signed-in visitor sees is not always the page the public sees, and whoever
reviews it should know which one they have.

---

## Editing scripts

A script is a list of **beats**. Each beat has:

| Field | What it is |
| --- | --- |
| Words you say | The teleprompter line. `{firstName}` and `{company}` are filled in. |
| Scene | `listing`, `listing-tap`, `se` or `ne`. These four are the only scenes. |
| Suggested seconds | How long that picture is held. Follows the words as you write them, and can be held at a number of your own — see below. |
| Top caption | Two optional lines for the top bar. |
| Tab | On a `ne` beat only: which Neighborhood Explorer tab is on screen. |

Plus a name, a notes field, whether the script is *School Explorer only* or
*School Explorer, then Neighborhood Explorer*, and what their listing should
already have on it.

### The suggested seconds follow the words

The duration used to be typed in by hand with nothing connecting it to the line
beside it, so rewriting a beat left the old number sitting there. Now the box
fills itself in as you type, and the running total at the bottom keeps up.

```
seconds = 1.5 + characters ÷ 16
```

**16 characters a second** is about 160 words a minute at the usual six
characters per word including the space — an ordinary voiceover pace, and what
the hosted voices actually read at. **1.5 seconds** is the part that is not
reading speed: the breath before the first word, the beat after the last one, and
the moment a viewer needs to take in a new picture. Under all of it is a floor of
**2.5 seconds**, so a beat is never too short to see and writing the first word
never makes it shorter than an empty one.

Neither number was taken from a table. Both are fitted to the listing beats of
the three shipped scripts, which were timed by hand against the approved
reference video, and land within half a second of them. A 69-character line was
timed at 5.7s and this suggests 5.8; a 162-character one was timed at 11 and 12
across two scripts and this suggests 11.6.

It reads a couple of seconds **long** against the shipped Explorer beats, and
that is the formula being right rather than wrong. Those were written as floors
and left deliberately short, because an Explorer beat is a still and the voice is
what should decide how long it stays up.

**Typing a number holds it.** That beat stops following and the hint under the
box says so. **Emptying the box hands it back** and it starts following again.
Opening a saved script only lets a beat follow if it is already sitting at exactly
the suggested length — a duration somebody chose is left alone, so editing an old
script never silently retimes it.

Getting it close matters in both directions but is not fatal either way: too short
and `src/audio.js` stretches the beat to fit the recorded line, too long and the
voice finishes while the picture hangs.

The arithmetic is in `public/js/beat-timing.js`, which the browser loads and Node
requires, so there is one copy of it and the test is checking the one the editor
runs.

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

### The shared lines are only spoken once

Every AI-voice job used to send the **whole script** to ElevenLabs, so the same
forty seconds of "here's the same page, with the Dream Neighborhood School
Explorer…" was paid for again for every realtor. Only the greeting differs
between customers.

Each line is now kept on disk under a key made of **what was said and who said
it**, so a second job on the same script and voice bills the greeting and nothing
else. The job log says how many lines were reused and how many characters were
actually billed, and the review step repeats it.

It is kept **per line**, not as one run-together bed, and that is deliberate:

- each line is still padded to its own scene length, so the picture timing is
  untouched — only the raw speech is kept, and the padding is worked out per job;
- a script that mentions the customer again halfway down simply misses the cache
  for that line, with no special case and no risk of a cached line containing
  somebody else's name;
- editing one line on the Scripts page only re-bills that line.

The key carries the **engine, the voice, the model and its settings**, so a cached
ElevenLabs line can never be spliced onto a Piper or OpenAI track, and changing
the voice or the words starts again. Tidying whitespace does not re-bill a line.
Only ElevenLabs is kept — it is the one that charges by the character.

Recording your own voice never touches any of this.

**On Heroku the cache lives on the dyno's disk and goes when the dyno restarts**,
so it saves within a working session rather than for ever. Nothing depends on it
surviving: a miss is just the line being spoken again, and a cache directory that
cannot be written costs money rather than breaking a video.

### Picking a male or female voice

The voice is chosen **on the make-a-video form**, beside the from-address, not
buried behind the AI button on a later step. It is kept on the job, so the AI path
uses the voice that was picked when the job was made, and the record step names it
rather than leaving it a surprise.

Two women and two men, by name — **Jessica is the default**, because she is the
voice that has been heard and approved. The choice only matters if the AI voice is
used at all; recording over the silent video is still the normal way.

Three of those four are **named choices, pinned by id**:

| | Voice | Id |
| --- | --- | --- |
| Female, default | Jessica | `cgSgspJ2msm6clMCkdW9` |
| Male | Dan | `PGqDc9SLzJTxDTy8SjYb` |
| Male | Adam | `wBXNqKUATyqu0RtYt25i` |

The men used to be whichever two the account listed first, and it lists them
alphabetically — so the picker offered **Adam and Bill**, which nobody had chosen
and Bill did not like. These two were asked for by id, so being first is no longer
what decides it. The fourth slot, the second woman, is still filled by whoever the
account offers next.

> **Worth knowing:** the second man is called Adam as well, and is *not* the Adam
> that was there before. That one was `pNInz6obpgDQGcFmaJgB`; this is a different
> recording of a different person. Worth checking the id before "fixing" the name
> back.

A pinned voice is offered **whether or not the account's list happens to carry
it**. Dropping a voice somebody chose by name because a list came back a little
different is the failure worth avoiding, and there is already a better check: a
401 at render time says a plan cannot speak with a voice, and that drops it from
the picker for good. The name still comes from the account wherever it has one, so
a rename upstream reaches the radio button without a deploy.

**The list is asked of the account, not written down here.** `GET /v1/voices` is
called with the existing key (header only — it is never logged, never put in a URL,
and never handed to the browser), the answer is filtered to the voices this plan
can actually speak with, and two of each sex are offered. The answer is cached for
ten minutes so loading the form is not a network call.

That matters because this is a **free plan**: only the premade/default voices work.
A Voice Library voice like Rachel or Charlotte answers 401, and hardcoding names
would mean offering a voice that fails at render time — after the silent video has
already been made. If a voice ever answers 401, 402 or 403, it is dropped from the
picker and another takes its place; the ones that work carry on.

A short hardcoded list (the three pinned voices plus Sarah) is used only when the
account cannot be asked at all, so the picker still offers something sensible.

> **Worth knowing:** ElevenLabs' Default voices expire on **31 December 2026**, and
> are only available to accounts created before March 2026. Asking the account
> rather than hardcoding is what stops that being a breakage — when they go, the
> picker will offer whatever the account has instead.

### Seeing an upgrade coming

A small **ElevenLabs** card sits on the make-a-video form, above the voice picker,
so running out of characters is not something you find out halfway through a
render. `GET /v1/user/subscription`, read server side, behind the password, cached
for five minutes.

| What it can read | What the card says |
| --- | --- |
| the subscription | The plan, characters left of the limit and the percentage, how many are used, and the date the allowance resets. **"Time to upgrade"** in amber when under 20% or under 10,000 characters are left — a script is a couple of thousand, so ten thousand is a handful of videos. |
| a 401 `missing_permissions` / `user_read` | That the key can *speak* but is not allowed to read usage, that a key with `user_read` would fill it in, and a link to [elevenlabs.io/app/usage](https://elevenlabs.io/app/usage) to check by hand. **No numbers, made up or otherwise.** This is the state staging is in today. |
| nothing, because there is no key | That the AI voice is switched off, and to record instead. |

Only ten fields ever reach the browser, as a whitelist rather than a copy with a
few things deleted — the subscription response carries billing dates, currency and
invoice amounts, and none of that should land in a page because a field was added
upstream. The key is sent as a header and appears nowhere else: not in a log, not
in a URL, not in the JSON. There are tests for each of those.

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
| `LISTING_VIDEO_PERSONA` | Which desktop capture says it is on: `windows` (default), `macos` or `linux`. The user agent, the client hints and `navigator.platform` all follow it together. Anything else falls back to `windows`. See [One persona](#one-persona-and-everything-agreeing-with-it). |
| `LISTING_VIDEO_EXPLORER_URL`, `LISTING_VIDEO_EXPLORER_PARTNER`, `LISTING_VIDEO_EXPLORER_WIDGET` | Which Neighborhood Explorer widget the tab beats are filmed from. Defaults to the one the marketing site's demo page loads. The address picker follows this URL, so pointing it at staging points the suggestions at staging too. |
| `LISTING_VIDEO_PLACE_SUGGEST`, `LISTING_VIDEO_PLACE_RESOLVE` | The Explorer's `autocomplete/` and `geocode/` endpoints, if they ever move away from beside the widget URL. |
| `LISTING_VIDEO_SCHOOL_EXPLORER_URL`, `LISTING_VIDEO_SCHOOL_EXPLORER_ACCENT` | Which School Explorer embed the school beats are filmed from, and its accent colour. Defaults to the embed the popup snippet loads on a realtor's page. |
| `LISTING_VIDEO_GEOCODER` | Address lookup for when the Explorer's own geocoder cannot place an address. Defaults to OpenStreetMap's Nominatim, which needs no key. |
| `LISTING_VIDEO_QUAL_EMAIL`, `LISTING_VIDEO_QUAL_PASSWORD` | The QUAL account, for realtor sites that put a listing behind a login. Off unless **both** are set, which is what keeps it off production. Nothing here helps with a 403. See [Signing in to a realtor site](#signing-in-to-a-realtor-site-the-qual-account). |
| `LISTING_VIDEO_QUAL_NAME`, `LISTING_VIDEO_QUAL_PHONE` | Details for a registration form. The name defaults to `Motormouth QUAL`. |
| `LISTING_VIDEO_QUAL_HOSTS` | Which sites the QUAL account may be used on. Empty means any; a comma-separated list is an allowlist. |
| `LISTING_VIDEO_QUAL_REGISTER` | Allow **creating** an account, not just signing in. Off, because registering on an IDX site is what emails that site's agent a new lead. |

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
| `GET /tools/listing-video/api/places?q=` | Signed in only. The Neighborhood Explorer's own address suggestions, proxied so the tool stays one origin |
| `POST /tools/listing-video/api/jobs` | Signed in only. Takes JSON, or multipart with a `listingImage` and the address fields |
| `POST /tools/listing-video/api/jobs/:id/recapture` | Signed in only. Goes back to the live site, dropping any uploaded screenshot |
| `POST /tools/listing-video/api/jobs/:id/listing-image` | Signed in only. Multipart: the listing screenshot plus the address — `addressPlace` as picked from the suggestions, with `addressStreet`, `addressCity`, `addressState`, `addressZip` split out of it |
| `POST /tools/listing-video/api/jobs/:id/audio`, `.../ai-voice` | Signed in only |
| `POST /tools/listing-video/api/jobs/:id/reviewed`, `.../email` | Signed in only |
| `POST /tools/listing-video/api/jobs/:id/trim` | Signed in only |
| `GET /tools/listing-video/api/jobs/:id/silent.mp4`, `.../video.mp4` | Signed in only |
| `GET /tools/listing-video/api/videos`, `DELETE .../videos/:id` | Signed in only |
| `GET /tools/listing-video/api/failures` | Signed in only |
| `GET /tools/listing-video/api/voice-usage` | Signed in only |
| `GET /tools/listing-video/api/jobs/:id/failure.png` | Signed in only |
| `GET /v/:id` | Public watch page |
| `GET /v/:id/video.mp4`, `GET /v/:id/poster.jpg` | Public |

No `/popup/{address}` routes are added, and no product code is changed.

## Layout

```
server.js                    routes, sign-in gate, uploads, one-at-a-time queue
src/templates.js             script templates on disk: load, save, validate, render
src/default-templates.js     the three shipped scripts
src/browser.js               Chrome, kept small, and killed for certain
src/persona.js               the user agent, client hints and language, all agreeing
src/capture.js               opens their site, accepts cookies, walks to a listing
src/site-account.js          signs in with the QUAL account at an account wall
src/listing-image.js         an uploaded screenshot, checked and fitted to the frame
src/page-analysis.js         is this one listing or a landing page, and what address
src/frames.js                turns each beat into a 1920x1080 still
src/video.js                 ffmpeg: the silent cut, then the voiced cut
src/audio.js                 recorded takes, the optional AI voice, 0.6s lead silence
src/render.js                phase one (silent picture) and phase two (attach audio)
src/store.js                 jobs on disk, the library list, delete
src/mail.js                  the two from-addresses, honest "not connected" state
src/ne-tabs.js               the seven chips, their old names, and the order they are walked
src/explorer.js              films the live Neighborhood Explorer, one tab at a time
src/school-explorer.js       films the live School Explorer at the listing's address
src/places.js                the Explorer's own address suggestions and geocoder
src/geocode.js               the listing's address as coordinates, checked against its town
views/frame.html             the frame: top caption bar, popup button, SE and NE cards
public/js/place-picker.js    the address box: the Explorer's suggestions as you type
public/js/beat-timing.js     how long a beat should be, from the words in it
public/                      the three tabs and the public watch page
test/                        node --test smoke tests
test/fixture-site.js         a stand-in realtor site built from the pages that broke
test/client.test.js          the front end in Chrome: a lost job must not hang
test/uploaded-listing.test.js  the 403 dead end, the upload out of it, and its address
test/persona.test.js         the persona's rules, with no browser needed to check them
test/beat-timing.test.js     the suggested seconds, against the hand-timed scripts
test/school-explorer.test.js Peoria's schools for a Peoria listing, not Smyrna's
test/places.test.js          the address is a place the Explorer named, not free text
test/site-account.test.js    the QUAL account, and what it must not be used for
```
