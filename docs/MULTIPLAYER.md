# Friendly 1v1 — front end only

The default game is a static browser app. Two players connect directly with WebRTC; there is no game server, account, signaling service or database to deploy. The browser that creates the invite runs the match in a worker. Both players see their own blue towers at the bottom.

## Connect two players

1. Open the game on both devices and choose **Play with a friend**.
2. One player chooses **Create an invite** and sends the invite through **Share invite** on a supported phone, or **Copy invite**. Hosted games send a link. A game opened at `localhost` sends an invite code because a `localhost` link would point back to the friend's device.
3. The friend opens the link, or opens the game first and pastes the code into the join field, chooses **Join friend**, and sends the generated reply back with **Share reply** or **Copy reply**.
4. The inviting player pastes that reply and chooses **Connect friend**.
5. Review your battle deck, then both choose **Ready for battle**.

Keep the original tabs open during the exchange. Invites belong to that tab and expire when it closes or reloads. A reply only works with its matching invite. On an HTTP Wi-Fi address, browsers may hide the modern clipboard and share APIs. **Copy invite** and **Copy reply** then use a user-gesture copy command; if the browser refuses it, the code is selected for its manual Copy action. The connected lobby shows your confirmed battle deck; tap a card to inspect it. Close the menu to edit your deck or player name, then reopen it to review the accepted changes. A deck, order or name change clears both Ready checks. Changes saved after countdown begins are for future matches; the current match keeps its accepted deck and names.

After the result, choose **Play again with friend** to request another round. The other result shows who requested it, and **Cancel rematch request** withdraws your request. When both agree, both return to the same connected friend lobby with Ready cleared. Review or edit your decks and names, then both choose **Ready for battle**. The next round starts with a fresh shuffle and keeps a separate match record. Watching a replay or choosing **Back to arena** leaves the direct connection; the other player can create a new invite from their result.

## Wi-Fi and static hosting

```sh
npm ci
npm run dev
```

Open Vite's printed **Network** address on each phone. A phone's `localhost` refers to the phone itself. If the inviting browser is on `localhost`, the UI shares a portable code; open the Network address on the other phone before pasting it. Opening the game from the shared Network address on both devices lets the invite include a directly usable link. Guest Wi-Fi isolation can prevent direct connections.

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
- Placement feedback confirms the host accepted a card or names its rejection reason. Choose a card again to retry; rejected commands are not automatically replayed.
- Menus leave the match running while both tabs remain visible. Surrender produces the normal final result and replay. Friendly matches award no trophies, gold or chests.
- Spawn lifecycle events retain a birth position after a troop moves or dies; the guest rotates it with the board. Direct lobby protocol version 4 confirms private loadouts, scopes commands and snapshots to their round and detects incompatible older clients. Update both games before creating a fresh invite when versions differ. The CR1 invite/reply codec retains its existing format.
- Native King emotes and quick chat share a per-player cooldown enforced by the host. They remain transient and do not enter replay data.
- Ordered data messages are split into bounded chunks for phone browsers. Slow recipients receive the latest state instead of an unbounded snapshot queue. The worker also pauses if the host UI stops responding.

## Verification and retained server experiments

`tests/peer.test.ts` covers ready checks, deck and deployment validation, duplicate commands, private snapshots, pause/resume, reactions, replay equivalence and bounded signaling/data packets. `tests/browser/peer.spec.ts` uses two real browsers against static files, exchanges the actual invite and reply, deploys from both perspectives, shares reactions, pauses through visibility changes, surrenders and opens the replay. `tests/browser/peer-share.spec.ts` verifies that a localhost game shares the usable code through the phone share API. The peer suite also checks that the app makes no game WebSocket or `/api/` requests.

The earlier server implementation remains in source history and in opt-in regression code. It is not part of the default runtime or deployment. To reproduce those historical checks only, use `npm run build:legacy`, then `VITE_LEGACY_ROOMS=1 ARENA_PRODUCTION=1 npx playwright test tests/browser/multiplayer.spec.ts tests/browser/startup.spec.ts tests/browser/connection.spec.ts --project=desktop`. `dev:legacy` and `start:legacy` are explicitly separate commands. Default browser tests select the new peer flow.

Known verification limit: two WebKit peers on this Mac expose mDNS candidates but their data channels do not open within 15 seconds, including in a minimal page outside the game. The cause is not established. Chromium/WebKit pairs pass in both directions. Safari-to-Safari play and physical-device remote connectivity remain unverified; the default browser suite retains that failing case.


`tests/peer-loadout.test.ts` verifies validated lobby updates, private confirmations, readiness resets, copied state, countdown locking, version checks and replay equivalence. `tests/browser/peer-loadout.spec.ts` edits both players during signaling and in the connected lobby, then checks a real accepted match and recording. Local verification includes Chromium/Chromium and Chromium/WebKit in both host directions. It checks 320-pixel phone layouts, and a saved name change during play leaves the match identity fixed.

To reproduce the native connectivity baseline separately, run `ARENA_PRODUCTION=1 npm run test:rtc -- --project=mobile-safari` after a normal production build. This opt-in diagnostic loads only the SVG endpoint, creates two native data channels and attaches signaling/candidate metadata. Its local WebKit/WebKit failure and Chromium comparison are recorded in `docs/diagnostics/webkit-rtc-loopback.json`. The cause is not established, and physical-device connectivity remains unverified. [Playwright notes platform-dependent WebRTC support](https://github.com/microsoft/playwright/issues/31016).


`tests/peer-rematch.test.ts` verifies two-sided consent, cancellation, disconnect recovery, fresh countdowns, per-round commands and state, replay equivalence and distinct reward-free records. `tests/browser/peer-rematch.spec.ts` plays three complete rounds over one connection, changes accepted decks and names between rounds, checks reactions and both histories, and leaves for replay playback. As with the loadout case, WebKit runs against a Chromium counterpart in both host roles.
