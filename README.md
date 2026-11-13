# NoSignal

NoSignal is an offline-first emergency response hub prototype. It stores check-ins, SOS beacon records, emergency contacts, survival guides, shelters, and timer state in SQLite. Browser actions are kept in a local queue until the server can be reached.

## Run locally

1. Install Node.js 18 or newer.
2. From this directory, run `npm install`.
3. Run `npm start`.
4. Open [http://localhost:3000](http://localhost:3000).

The SQLite database is created at `backend/resilinet.db` on first launch. Set the `PORT` environment variable to override port 3000. The server binds to `127.0.0.1` by default; configure `HOST` only when intentionally serving other devices.

## API

- `POST /api/checkin` accepts `{ "eventId": "unique-id", "message": "I am safe." }`.
- `POST /api/sos` accepts `{ "eventId": "unique-id", "latitude": 37.7, "longitude": -122.4, "batteryPercentage": 85 }`.
- `GET /api/contacts` lists emergency contacts. `POST /api/contacts` accepts `{ "clientId": "unique-id", "name": "Name", "phone": "+1 555 0100", "relationship": "Family" }`.
- `GET /api/guides` returns the built-in offline survival and first-aid guide index.
- `GET /api/shelters` returns locally configured shelter records. The directory starts empty rather than showing unverified or fictional evacuation sites.
- `GET /api/shelters/status` returns the latest crowd-sourced status for each configured shelter. `POST /api/shelters/status` accepts `{ "shelterId": 1, "status": "Open", "water": true, "power": true }`; shelter IDs must already exist in the trusted directory.
- `GET /api/triage` lists check-ins and SOS beacons for the responder view. `PATCH /api/beacons/:id/resolve` resolves an SOS beacon, and `GET /api/events` streams live updates using Server-Sent Events. Open `/responders` for the triage table.
- `GET /api/timer` returns the persisted countdown and preferences. `POST /api/timer` accepts `action: "configure"`, `"acknowledge"`, or `"trigger"` with a `timerId`; configure also takes `durationSeconds` and an optional ISO `deadlineAt`.
- `GET /api/health` reports whether the server is available.

Check-ins and SOS POST endpoints validate their input, assign a server-side ISO 8601 timestamp, and deduplicate retries by `eventId`. Contacts are deduplicated by `clientId`. The database is created and upgraded on startup; timer preferences and state are stored in the `settings` table.

The browser caches the app shell and downloaded guides, shelters, and contacts for later offline access. The interface can be switched between English, Hindi, Tamil, Telugu, Bengali, and Kannada; guide content and user-entered records retain their original language. Pending actions are stored in local storage and sync when connectivity returns. A medical/ID QR card is encoded locally and stays on the device. Shelter distance and bearing use a cached device location; the location button requests permission when needed. The SOS strobe flashes Morse code on screen and can use a supported camera torch after permission; the optional 3000 Hz whistle uses Web Audio. Battery telemetry uses browser APIs when available and is marked simulated when the fallback is used; below 15%, the interface switches to a pure-black display. The countdown needs this page open to run reliably; browser background throttling can delay it. Expiry records an SOS beacon but does not notify emergency services or contacts. Do not rely on this prototype in place of local emergency services or verified authority guidance.

Shelter records must be provisioned from a trusted local source in the `shelters` table before the directory can display them. The API intentionally does not invent evacuation locations.

The shelter directory can preview coordinates in Google Maps and open directions in Google Maps. Maps are provided by Google and require an internet connection; the rest of the app remains available offline. No Google Maps API key is stored in this app.

The prototype has no user authentication and stores contact numbers in the local SQLite file. Do not bind it to a public or untrusted network; a multi-device deployment needs authentication and transport security.
