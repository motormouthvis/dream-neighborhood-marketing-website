"use strict";

/**
 * A stand-in realtor website for the capture tests, built to look like the
 * pages that have actually gone wrong.
 *
 *   /                       a marketing homepage: hero photo, "Search ... Homes"
 *                           and "Market Report" buttons, the office address in
 *                           the footer, and a cookie Accept banner. This is the
 *                           Fathom Realty page Bill's job filmed by mistake, and
 *                           it must never end up as a video background.
 *   /market-report          a market report page, also never a listing
 *   /listings               an index of listing cards, the way through
 *   /listings/123-main-st   a real listing detail page, the one to film
 *   /listings/88-ocean-view already has a Dream Neighborhood embed on it
 *   /search?...             an IDX search page with a map and a voice panel
 *   /about                  an about page
 *
 * Every page carries the cookie banner, so capture has to accept it everywhere.
 *
 * Run it on its own to poke at it by hand:
 *   node test/fixture-site.js 8899
 */

const http = require("http");

const CSS = `
body{font-family:Arial,Helvetica,sans-serif;margin:0;color:#1a2b33}
.site-header{background:#123;color:#fff;padding:16px 30px;display:flex;justify-content:space-between}
.wrap{padding:28px 40px;max-width:1100px}
h1{font-size:34px;margin:0 0 12px}
.hero{position:relative;height:330px;background:#4a7fa8 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8'%3E%3Crect width='8' height='8' fill='%234a7fa8'/%3E%3C/svg%3E");
  display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;text-align:center}
.hero h1{font-size:38px}
.hero .ctas{display:flex;gap:14px;margin-top:18px}
.hero .ctas a{background:#1e6fbf;color:#fff;padding:14px 22px;text-decoration:none;font-weight:700}
.price{font-size:30px;font-weight:800}
.gallery{display:flex;gap:12px;flex-wrap:wrap;margin:14px 0}
/* Sized in CSS, so counting the photos on a page still works while images are
   blocked during the crawl. Real listing sites size their containers too. */
.photo{background:#dde2ea;width:320px;height:220px;display:block;border:0}
.card{border:1px solid #ccd;padding:14px;margin:12px 0;max-width:560px}
.card .thumb{background:#dde2ea;width:220px;height:150px;display:inline-block;vertical-align:middle;margin-right:14px}
table{border-collapse:collapse}td{padding:4px 14px 4px 0}
footer{background:#12201c;color:#c9d6cf;padding:26px 40px;margin-top:40px;font-size:14px}
#map{width:900px;height:520px;background:#cfe3cf}
.filters{display:flex;gap:8px;margin:14px 0}.filters input,.filters select{padding:10px}
/* the cookie banner: pinned to the bottom, over everything */
#cookie-banner{position:fixed;left:0;right:0;bottom:0;z-index:9000;background:#101820;color:#fff;
  padding:20px 26px;display:flex;align-items:center;justify-content:space-between;gap:20px;font-size:16px}
#cookie-banner button{font:inherit;font-weight:700;padding:12px 22px;border:0;cursor:pointer}
#cookie-accept{background:#2f9e63;color:#fff}
.voice-command-modal{position:fixed;left:50%;top:46%;transform:translate(-50%,-50%);width:620px;background:#fff;
  border-radius:8px;box-shadow:0 20px 60px rgba(0,0,0,.35);padding:22px 26px;z-index:9999}
.voice-command-modal h3{color:#c0392f;margin:0 0 12px}
`;

// A real consent banner: it only goes away when Accept is pressed, and it locks
// the page behind it, exactly like the ones on realtor sites.
const COOKIE_BANNER = `
<div id="cookie-banner">
  <span>We use cookies to improve your experience on this site. See our cookie policy.</span>
  <span>
    <button id="cookie-manage">Manage settings</button>
    <button id="cookie-accept">Accept all cookies</button>
  </span>
</div>
<script>
  document.documentElement.style.overflow = 'hidden';
  document.getElementById('cookie-accept').addEventListener('click', function () {
    document.getElementById('cookie-banner').remove();
    document.documentElement.style.overflow = '';
    document.body.setAttribute('data-cookies-accepted', 'yes');
  });
  // "Manage settings" must not dismiss it, so a tool that presses the wrong
  // button gets caught.
  document.getElementById('cookie-manage').addEventListener('click', function (event) {
    event.preventDefault();
  });
</script>`;

const OFFICE_FOOTER = `
<footer>
  <div>Fathom Realty Long Beach</div>
  <address>2135 Bellflower Blvd, Long Beach, CA 90815</address>
  <div>+1 (562) 413-7655 &middot; 3 bedroom and 2 bathroom homes are our specialty</div>
  <nav><a href="/about">About</a> <a href="/contact">Contact</a> <a href="/privacy">Privacy</a></nav>
</footer>`;

function page(title, body, { cookies = true, extraHead = "" } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>${CSS}</style>${extraHead}</head><body>
<header class="site-header"><span>Fathom Realty</span><span>+1 (562) 413-7655</span></header>
${body}
${OFFICE_FOOTER}
${cookies ? COOKIE_BANNER : ""}
</body></html>`;
}

/* ---------------------------------------------------------------- */
/* the marketing homepage that must never be filmed                 */
/* ---------------------------------------------------------------- */
const HOMEPAGE = page(
  "Long Beach Real Estate & Homes For Sale",
  `<div class="hero">
     <h1>Long Beach Real Estate &amp; Homes For Sale</h1>
     <p>We help Long Beach buyers find the right home without stress or confusion. And sellers too.</p>
     <div class="ctas">
       <a href="/listings">Search Long Beach Homes</a>
       <a href="/market-report">Long Beach Market Report</a>
       <a href="/contact">Custom List Of Homes</a>
     </div>
   </div>
   <div class="wrap">
     <p>Long Beach real estate offers one of the most diverse housing markets in Southern California, with
     beachfront homes, walkable urban neighborhoods, quiet residential streets, and condo communities near
     shopping and dining. If you're exploring Long Beach homes or Long Beach condos, this guide gives you a
     clear, local overview of the neighborhoods, lifestyle options, and homes currently for sale &mdash; all
     updated daily from the MLS.</p>
     <h2>Popular Long Beach Home Types:</h2>
     <ul>
       <li>Single-family homes near the beach and coastal trails</li>
       <li>Condos and lofts in walkable urban neighborhoods</li>
       <li>Townhomes and gated communities with modern amenities</li>
     </ul>
     <div class="gallery"><span class="photo"></span><span class="photo"></span><span class="photo"></span></div>
   </div>`
);

const MARKET_REPORT = page(
  "Long Beach Market Report",
  `<div class="wrap"><h1>Long Beach Market Report</h1>
     <p>The median sale price in Long Beach is $865,000 this month. Inventory is up.</p>
     <p>Search Long Beach Homes to see what is available today.</p>
     <div class="gallery"><span class="photo"></span><span class="photo"></span><span class="photo"></span></div>
   </div>`
);

/* ---------------------------------------------------------------- */
/* the way through, and the listing to film                         */
/* ---------------------------------------------------------------- */
const LISTINGS_INDEX = page(
  "Our Listings - Fathom Realty",
  `<div class="wrap"><h1>Our Listings</h1>
     <div class="card"><a href="/listings/123-main-st"><span class="thumb"></span>123 Main St</a>
       <p>$925,000 &middot; 4 beds &middot; 3 baths &middot; 2,410 sq ft</p></div>
     <div class="card"><a href="/listings/88-ocean-view"><span class="thumb"></span>88 Ocean View Dr</a>
       <p>$1,450,000 &middot; 5 beds &middot; 4 baths &middot; 3,120 sq ft</p></div>
   </div>`
);

function listing({ address, city, price, beds, baths, sqft, mls, extraHead = "", extraBody = "" }) {
  return page(
    `${address} - Fathom Realty`,
    `<div class="wrap">
       <h1>${address}</h1>
       <p>${city}</p>
       <p class="price">$${price}</p>
       <p>${beds} beds &middot; ${baths} baths &middot; ${sqft} sq ft</p>
       <div class="gallery">
         <img class="photo" src="/photo.svg" alt="" /><img class="photo" src="/photo.svg" alt="" />
         <img class="photo" src="/photo.svg" alt="" /><img class="photo" src="/photo.svg" alt="" />
       </div>
       <h2>Property Details</h2>
       <table>
         <tr><td>MLS #</td><td>${mls}</td></tr>
         <tr><td>Year Built</td><td>1962</td></tr>
         <tr><td>Lot Size</td><td>6,200 sq ft</td></tr>
         <tr><td>Property Type</td><td>Single Family Residence</td></tr>
         <tr><td>Days on Market</td><td>11</td></tr>
       </table>
       <p>A lovely home with a big yard, a two car garage and a covered patio out back.</p>
       ${extraBody}
     </div>`,
    {
      extraHead: `<script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "SingleFamilyResidence",
        name: address,
        address: {
          "@type": "PostalAddress",
          streetAddress: address,
          addressLocality: city.split(",")[0],
          addressRegion: (city.split(",")[1] || "").trim().split(" ")[0],
          postalCode: (city.match(/\d{5}/) || [""])[0],
        },
      })}</script>${extraHead}`,
    }
  );
}

const MAIN_ST = listing({
  address: "123 Main St",
  city: "Long Beach, CA 90815",
  price: "925,000",
  beds: 4,
  baths: 3,
  sqft: "2,410",
  mls: "PW24118845",
});

// Already has our embed, so the two before-and-after scripts must skip it and
// the upgrade script must prefer it.
const OCEAN_VIEW = listing({
  address: "88 Ocean View Dr",
  city: "Long Beach, CA 90803",
  price: "1,450,000",
  beds: 5,
  baths: 4,
  sqft: "3,120",
  mls: "PW24118999",
  extraHead:
    '<script src="https://embed.dreamneighborhood.com/school-explorer.js" data-dn-address="88 Ocean View Dr"></script>',
});

/* ---------------------------------------------------------------- */
/* the IDX search page, with a voice panel for good measure          */
/* ---------------------------------------------------------------- */
const SEARCH = page(
  "Property Search - Fathom Realty",
  `<div class="wrap">
     <h1>What Are You Looking for in a Home or Condo Today?</h1>
     <div class="filters">
       <input placeholder="Add Another Location" name="location" />
       <select name="minprice"><option>Price</option></select>
       <select name="beds"><option>Beds</option></select>
       <select name="baths"><option>Baths</option></select>
       <select name="sort"><option>Newest Listings</option></select>
     </div>
     <p>Advanced Search &middot; 5 Filters Applied &middot; Save Search &middot; Reset</p>
     <div id="map"><p>Draw &middot; Search in Map &middot; Hide Map</p></div>
     <div class="card"><a href="/listings/123-main-st">123 Main St</a>
       <p>$925,000 &middot; 4 beds &middot; 3 baths &middot; 2,410 SQFT 123 Main St</p></div>
     <div class="card"><a href="/listings/88-ocean-view">88 Ocean View Dr</a>
       <p>$1,450,000 &middot; 5 beds &middot; 4 baths</p></div>
     <div class="card"><span>456 Pine Ave</span><p>$680,000 &middot; 3 beds &middot; 2 baths</p></div>
     <div class="card"><span>77 Harbor Way</span><p>$1,100,000 &middot; 4 beds &middot; 3 baths</p></div>
   </div>`,
  {
    extraHead: `<script>
      window.addEventListener('load', function () {
        var supported = ('webkitSpeechRecognition' in window) || ('SpeechRecognition' in window);
        if (!supported) return;
        var box = document.createElement('div');
        box.className = 'voice-command-modal';
        box.innerHTML = '<h3>Microphone access denied</h3><p>Say "Help" for a list of available voice commands.</p>';
        document.body.appendChild(box);
      });
    </script>`,
  }
);

const ABOUT = page("About Fathom Realty", '<div class="wrap"><h1>About us</h1><p>Selling homes since 1998.</p></div>');

// A listing photo. Kept as an SVG so the fixture stays readable, but it is
// still an image request, so it exercises the blocking during the crawl.
const PHOTO = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640">
  <rect width="960" height="640" fill="#b9c7d6"/>
  <rect x="120" y="300" width="720" height="300" fill="#8ea3b8"/>
  <polygon points="480,140 900,320 60,320" fill="#6f8399"/>
</svg>`;

const ROUTES = {
  "/": HOMEPAGE,
  "/photo.svg": { body: PHOTO, contentType: "image/svg+xml" },
  "/market-report": MARKET_REPORT,
  "/listings": LISTINGS_INDEX,
  "/listings/123-main-st": MAIN_ST,
  "/listings/88-ocean-view": OCEAN_VIEW,
  "/search": SEARCH,
  "/about": ABOUT,
};

/**
 * A listing whose cookie banner cannot be dismissed at all: Accept does
 * nothing, and an observer puts the banner back if anything tries to hide it.
 * Capture has to give up rather than film a listing with a bar across it.
 */
const UNCLOSEABLE_COOKIES = {
  ...ROUTES,
  "/listings/123-main-st": MAIN_ST.replace(
    "</body>",
    `<script>
       var bar = document.getElementById('cookie-banner');
       var accept = document.getElementById('cookie-accept');
       var clone = accept.cloneNode(true);
       accept.parentNode.replaceChild(clone, accept);
       new MutationObserver(function () {
         if (bar.style.display === 'none') bar.style.setProperty('display', 'flex', 'important');
         if (!bar.isConnected) document.body.appendChild(bar);
       }).observe(bar, { attributes: true, attributeFilter: ['style'] });
     </script></body>`
  ),
};

/**
 * A listing that throws up a lead-capture form a moment after the page settles,
 * over a dimming backdrop. Real IDX sites do this on a timer or on scroll, and
 * one got into a finished frame over a genuine listing.
 */
const LEAD_CAPTURE = {
  ...ROUTES,
  "/listings/123-main-st": MAIN_ST.replace(
    "</body>",
    `<style>
       #lead-backdrop{position:fixed;inset:0;background:rgba(8,10,14,.72);z-index:9500;display:none}
       #lead-modal{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:520px;
         background:#0e1218;color:#fff;border-radius:10px;padding:30px;z-index:9600;text-align:center}
     </style>
     <div id="lead-backdrop">
       <div id="lead-modal">
         <h2>Create Your Free Account</h2>
         <p>Get instant access to new inventory and price reductions.</p>
         <input placeholder="Full Name" /><input placeholder="Email" />
         <button>Create Account</button>
         <p>Already have an account? Sign in</p>
       </div>
     </div>
     <script>
       // On a timer, and again if the page is scrolled, which is exactly what
       // loading the photos for the screenshot does.
       function showLead() { document.getElementById('lead-backdrop').style.display = 'block'; }
       setTimeout(showLead, 1500);
       window.addEventListener('scroll', showLead);
     </script></body>`
  ),
};

/**
 * A site where every candidate page is slow, so the capture budget is what stops
 * it rather than a page count. Values are functions, so the server can delay.
 */
const SLOW_SITE = {
  "/": page(
    "Slow Realty",
    `<div class="hero"><h1>Slow Realty Homes For Sale</h1>
       <div class="ctas"><a href="/listings/slow-one">Search Homes</a></div></div>
     <div class="wrap">
       <div class="card"><a href="/listings/slow-one">101 Slow St</a><p>$500,000 &middot; 3 beds &middot; 2 baths</p></div>
       <div class="card"><a href="/listings/slow-two">202 Slow Ave</a><p>$600,000 &middot; 4 beds &middot; 3 baths</p></div>
       <div class="card"><a href="/listings/slow-three">303 Slow Rd</a><p>$700,000 &middot; 5 beds &middot; 4 baths</p></div>
     </div>`
  ),
  "/listings/slow-one": { delayMs: 3000, body: page("Slow one", '<div class="wrap"><h1>Coming soon</h1></div>') },
  "/listings/slow-two": { delayMs: 3000, body: page("Slow two", '<div class="wrap"><h1>Coming soon</h1></div>') },
  "/listings/slow-three": { delayMs: 3000, body: page("Slow three", '<div class="wrap"><h1>Coming soon</h1></div>') },
};

/** A site with no listings at all, to check the refusal. */
const NO_LISTINGS = {
  "/": page(
    "No Listings Realty",
    `<div class="hero"><h1>No Listings Realty</h1><p>Call us for a private showing.</p>
       <div class="ctas"><a href="/contact">Custom List Of Homes</a><a href="/market-report">Market Report</a></div>
     </div>`
  ),
};

function createServer(routes = ROUTES, hits = {}) {
  return http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    hits[url.pathname] = (hits[url.pathname] || 0) + 1;

    const route = routes[url.pathname];
    // A route can ask to be slow, so the capture budget can be exercised.
    const body = route && typeof route === "object" ? route.body : route;
    const delayMs = route && typeof route === "object" ? route.delayMs || 0 : 0;
    const contentType = (route && typeof route === "object" && route.contentType) || "text/html; charset=utf-8";

    const send = () => {
      res.writeHead(body ? 200 : 404, { "content-type": contentType });
      res.end(body || page("Not found", '<div class="wrap"><h1>Not found</h1></div>', { cookies: false }));
    };
    if (delayMs) setTimeout(send, delayMs);
    else send();
  });
}

/**
 * Start on an ephemeral port and hand back the origin, plus a live count of
 * requests per path so a test can check what was and was not fetched.
 */
function listen(routes = ROUTES) {
  return new Promise((resolve) => {
    const hits = {};
    const server = createServer(routes, hits);
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, hits, origin: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

module.exports = {
  ROUTES,
  NO_LISTINGS,
  UNCLOSEABLE_COOKIES,
  LEAD_CAPTURE,
  SLOW_SITE,
  createServer,
  listen,
};

if (require.main === module) {
  const port = Number(process.argv[2] || 8899);
  createServer().listen(port, () => console.log(`fixture realtor site on http://127.0.0.1:${port}`));
}
