import { CARD_MAP, type CardId } from "../game/cards";
import type { ServerMessage } from "../network/protocol";

type Acknowledgement = Extract<ServerMessage, { type: "ack" }>;

/** Correlate feedback with the latest submitted card, independently of snapshots. */
export class DeploymentFeedback {
  private latest: { seq: number; card: CardId; submitted: string } | null =
    null;
  submit(seq: number, card: CardId) {
    const submitted = `${CARD_MAP[card].name} placement submitted.`;
    this.latest = { seq, card, submitted };
    return submitted;
  }
  acknowledge(message: Acknowledgement) {
    if (!this.latest || message.seq !== this.latest.seq) return null;
    const { card, submitted } = this.latest;
    this.latest = null;
    const name = CARD_MAP[card].name;
    return {
      submitted,
      announcement: message.ok
        ? `${name} deployed.`
        : `${name} not deployed. ${message.reason}`,
    };
  }
  reset() {
    this.latest = null;
  }
}
