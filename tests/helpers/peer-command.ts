import type { PeerMatch } from "../../src/network/peer-match";
import type { ClientMessage } from "../../src/network/protocol";
import type { Team } from "../../src/game/engine";

/** Direct model callers attach the round identity just like PeerRoomClient.send. */
export function sendPeerCommand(
  game: PeerMatch,
  team: Team,
  message: ClientMessage,
) {
  game.receive(team, { matchId: game.room.matchId, ...message });
}
