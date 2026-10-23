# Friendly 1v1 — front end only

The default game is a static browser app. Two players connect directly with WebRTC; there is no game server, account, signaling service or database to deploy. The browser that creates the invite runs the match in a worker. Both players see their own blue towers at the bottom.

## Connect two players

1. Open the game on both devices and choose **Play with a friend**.
2. One player chooses **Create an invite** and sends the invite link to their friend.
3. The friend opens the link (or pastes it into the join field), chooses **Join friend**, and sends the generated reply back.
4. The inviting player pastes that reply and chooses **Connect friend**.
5. Both choose **Ready for battle**.

Keep the original tabs open during the exchange. Invites belong to that tab and expire when it closes or reloads. A reply only works with its matching invite. Copy controls fall back to selecting the text when clipboard access is unavailable. Choose the deck before connecting; leave the connection to change it.

## Wi-Fi and static hosting

```sh
npm ci
npm run dev
```

Open Vite's printed **Network** address on each phone. A phone's `localhost` refers to the phone itself; create the invitation from the shared Network address so the link works on both devices. Guest Wi-Fi isolation can prevent direct connections.

```sh
npm run build
npm start -- --port 5189
```

The build produces `dist/`, which any ordinary static HTTPS host can serve. `npm start` is a local static preview; no game backend runs. No remote site or paid hosting has been provisioned.

Remote play uses Google's public STUN endpoint to discover routes, then carries match data directly between browsers. No TURN relay is configured. Some cellular, corporate and restrictive NAT networks cannot connect directly; use the same Wi-Fi or another network if the connection times out. This is a connectivity limitation, not a requirement to deploy the game server. See the [WebRTC peer connection guide](https://webrtc.org/getting-started/peer-connections).

## Match behavior

- The inviting browser runs the 30-Hz simulation in a dedicated worker and sends snapshots at approximately 15 Hz. Both players' commands use the same elixir, placement and sequence validation. The host necessarily owns the complete state, so this is for friendly games rather than adversarial ranked play.
- The guest's snapshots mask the opposing hand, queue and elixir. The final replay contains both decks and all accepted actions. Both perspectives reuse the existing canonical simulation and replay format.
- Both game tabs must remain open. Hiding either tab pauses the shared match; returning resumes it. A temporary connection interruption pauses combat. If the data channel closes, the host reloads or ICE connectivity fails, create a fresh invite. There is no server-backed reload/rejoin.
- Menus leave the match running while both tabs remain visible. Surrender produces the normal final result and replay. Friendly matches award no trophies, gold or chests.
- Native King emotes and quick chat share a per-player cooldown enforced by the host. They remain transient and do not enter replay data.
- Ordered data messages are split into bounded chunks for phone browsers. Slow recipients receive the latest state instead of an unbounded snapshot queue. The worker also pauses if the host UI stops responding.

## Verification and retained server experiments

`tests/peer.test.ts` covers ready checks, deck and deployment validation, duplicate commands, private snapshots, pause/resume, reactions, replay equivalence and bounded signaling/data packets. `tests/browser/peer.spec.ts` uses two real browsers against static files, exchanges the actual invite and reply, deploys from both perspectives, shares reactions, pauses through visibility changes, surrenders and opens the replay. It also checks that the app makes no game WebSocket or `/api/` requests.

The earlier server implementation remains in source history and in opt-in regression code. It is not part of the default runtime or deployment. To reproduce those historical checks only, use `npm run build:legacy`, then `VITE_LEGACY_ROOMS=1 ARENA_PRODUCTION=1 npx playwright test tests/browser/multiplayer.spec.ts tests/browser/startup.spec.ts tests/browser/connection.spec.ts --project=desktop`. `dev:legacy` and `start:legacy` are explicitly separate commands. Default browser tests select the new peer flow.

Known verification limit: two WebKit peers on this Mac expose only mDNS candidates and do not form a candidate pair, including in a minimal page outside the game. Chromium/WebKit pairs pass in both directions. Safari-to-Safari play and physical-device remote connectivity remain unverified; the default browser suite retains that failing case.
