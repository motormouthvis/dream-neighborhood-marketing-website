# Product decisions

## Homepage Neighborhood Explorer pricing

Authorized by William. The homepage sells Neighborhood Explorer by audience, not by metered listing-view allowances.

- **Solo** (realtor / broker): `$24.92/mo` billed annually or `$39/mo` month-to-month. Unlimited views. No 5,000-view cap and no “listing views included monthly” language.
- **Brokerage**: `$99.92/mo` billed annually or `$149/mo` month-to-month. For up to 50 agents. Unlimited views. No “unlimited agents” and no 25,000-view cap.
- **Enterprise**: homepage card for more than 50 agents. Price is Custom / Contact us — not an invented dollar amount. Do not describe Enterprise as note-only. Do not promise unlimited views on the Enterprise card or in homepage pricing notes; views are part of enterprise negotiation.
- **Partners**: 40% recurring revenue share and partner pricing stay on `/partners` (and Partner FAQ). Do not put a Partner price card on the homepage.

Homepage paid grid is four cards: Free / Solo / Brokerage / Enterprise. Free, Solo, and Enterprise use the same visible green border and mint fill so they read as cards on the white page. Brokerage stays the dark “MOST POPULAR” card. Do not rehash view-allowance or views-not-users pricing on the homepage or realtor FAQ. Keep these dollar amounts unless they are intentionally changed later. Homepage pricing cards say Free Support, not 24/7 Support.

## Phase 1 voice install helper (staging only)

Authorized by William. Marketing (DN Websites) owns the page shell and embed slot only. Dream Neighborhood owns the voice agent, URL sniff, savings, and draft-email logic — do not invent that logic here.

- Page: `/talk-through-install.html`, also `/talk-through-install` via Netlify pretty URLs (same as `/installation` and `/faq`).
- Embed slot: `#dn-voice-helper` with `data-dn-voice-helper="install"`.
- Product story on this page is only free School Explorer → paid Neighborhood Explorer. Do not invent pricing, features, or competitor claims.
- **Staging only.** Ship via an open PR / Netlify deploy preview. Do not merge to `main` (production / dreamneighborhood.com) until William says go.
- No voice helper script is loaded from this repo. Dream Neighborhood has not published a known staging script URL here. Leave the slot empty of scripts until they provide one.
- Nav and footer stay unchanged so the production homepage chrome stays clean if this later merges.
