# Friendly 1v1

The same server supports phones and computers on Wi-Fi and remote HTTPS connections. Both players open the same address, choose **Play with a friend**, and create or join a six-character room. Share the invite link or enter the room code, then both press **Ready for battle**. Each player sees their own blue towers at the bottom. The chosen deck is locked when joining; leave the room to change it. Classic and Double elixir work in friendly rooms.

## Run on your Wi-Fi

```sh
npm ci
npm run dev
```

Open the printed Network address on both devices, for example `http://10.0.0.15:5173`. The room screen opened on localhost offers an invite using the computer's network address. A phone's localhost points to the phone. Both devices must be able to reach the computer; guest Wi-Fi isolation can prevent this. Vite includes the multiplayer server and uses the same port as the game.

For a production server:

```sh
npm run build
npm start
```

The server listens on `0.0.0.0`, using `PORT` or 5173. It serves the built game, `/health`, and the `/battle` WebSocket endpoint. `npm run preview` previews static assets only; use `npm start` for multiplayer.

## Remote hosting

A remote deployment has not been provisioned automatically. `render.yaml` prepares a single Node web service: connect the private `Sir-Teo/web-clash-royale` repository in Render and create a Blueprint. The build is `npm ci --include=dev && npm run build`; the start command is `npm start`. Share the resulting HTTPS URL. The client automatically uses secure WebSockets on HTTPS.

Render's [web service documentation](https://render.com/docs/web-services) and [WebSocket guide](https://render.com/docs/websocket) describe the shared HTTP/WebSocket port. The supplied free plan can sleep between sessions and rooms disappear on restart. For sustained play, use a continuously running service. No paid service is created by these files.

A Docker build is also supplied for an existing host:

```sh
docker build -t browser-royale .
docker run --rm -p 5173:5173 browser-royale
```

Put HTTPS in front of the container using a reverse proxy that forwards WebSocket upgrades. Keep the origin host intact, or set `PUBLIC_ORIGIN=https://your-game.example` to the exact public origin. Run one instance; room state is in process memory and is not distributed across replicas. Static-only hosting cannot run this server.

## Match behavior

- The server simulates combat at 30 Hz and broadcasts authoritative state at 15 Hz. It validates cards, elixir, placement, room membership and input sequence numbers. Clients cannot choose their team or advance time.
- Only your own hand, queue and elixir are sent during play. The final replay reveals both decks and the complete action log.
- The server uses canonical blue/red coordinates. Red's presentation rotates positions, projectile paths, events and lanes by 180 degrees, then swaps team colors. Replays retain canonical commands and a perspective flag, so their simulation is unchanged.
- Menus and background tabs do not pause a friendly battle. Disconnections allow 30 seconds to reconnect, then the disconnected side loses. Returning to the same browser tab offers **Reconnect to your room**. Session credentials stay in session storage; invite URLs contain only the room code.
- Emotes reach both players, with a server cooldown. Surrender is resolved by the server.
- Friendly battles save results and replays but award no trophies, gold or chests. Duplicate reconnects to a completed room do not record the match twice.
- Waiting rooms expire after ten minutes; completed rooms remain resumable for two minutes. Server restarts clear rooms. There is no matchmaking, account identity, spectator mode or cross-server room discovery.

The transport uses bounded messages, rate limits, connection limits, heartbeat detection and backpressure limits. This is a private-room game server, not a distributed ranked service.

## Verification

`tests/network.test.ts` opens real WebSocket connections to an ephemeral server and checks synchronization, hidden hands, forged/duplicate moves, deck/version validation, multiple-room isolation, ready checks, reconnect credentials and disconnect forfeits. `tests/browser/multiplayer.spec.ts` plays with two browser contexts through the UI, checks both perspectives, reload/rejoin, surrender, friendly rewards and the red-side replay. It runs on desktop Chromium, phone Chromium and phone WebKit.
