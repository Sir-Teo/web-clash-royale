import { afterEach, describe, expect, it, vi } from "vitest";
import { DeploymentFeedback } from "../src/ui/deployment-feedback";
import { DirectRoomClient } from "../src/network/client-core";
import { PeerRoomClient } from "../src/network/peer-client";

afterEach(() => vi.unstubAllGlobals());
describe("deployment acknowledgement feedback", () => {
  it("ignores a reply without a sequence before or during a submission", () => {
    const feedback = new DeploymentFeedback();
    const malformed = { type: "ack", ok: true, reason: "" } as any;
    expect(feedback.acknowledge(malformed)).toBeNull();
    feedback.submit(4, "knight");
    expect(feedback.acknowledge(malformed)).toBeNull();
    expect(
      feedback.acknowledge({ type: "ack", seq: 4, ok: true, reason: "" })
        ?.announcement,
    ).toBe("Knight deployed.");
  });
  it("distinguishes submission from authoritative acceptance", () => {
    const feedback = new DeploymentFeedback();
    const submitted = feedback.submit(12, "knight");
    expect(submitted).toBe("Knight placement submitted.");
    expect(
      feedback.acknowledge({ type: "ack", seq: 12, ok: true, reason: "" }),
    ).toEqual({ submitted, announcement: "Knight deployed." });
    expect(
      feedback.acknowledge({ type: "ack", seq: 12, ok: false, reason: "old" }),
    ).toBeNull();
  });
  it("identifies the card the host rejected without changing the acknowledgement", () => {
    const feedback = new DeploymentFeedback();
    feedback.submit(15, "mini-pekka");
    const message = Object.freeze({
      type: "ack" as const,
      seq: 15,
      ok: false,
      reason: "Waiting for both players.",
    });
    expect(feedback.acknowledge(message)?.announcement).toBe(
      "Mini P.E.K.K.A not deployed. Waiting for both players.",
    );
    expect(message).toEqual({
      type: "ack",
      seq: 15,
      ok: false,
      reason: "Waiting for both players.",
    });
  });
  it("ignores an older acknowledgement while a newer card awaits acceptance", () => {
    const feedback = new DeploymentFeedback();
    feedback.submit(1, "knight");
    const submitted = feedback.submit(2, "goblins");
    expect(
      feedback.acknowledge({ type: "ack", seq: 1, ok: false, reason: "old" }),
    ).toBeNull();
    expect(
      feedback.acknowledge({ type: "ack", seq: 2, ok: true, reason: "" }),
    ).toEqual({ submitted, announcement: "Goblins deployed." });
  });
  it("correlates sequences even when two submissions use the same card and announcement", () => {
    const feedback = new DeploymentFeedback();
    feedback.submit(1, "knight");
    feedback.submit(2, "knight");
    expect(
      feedback.acknowledge({ type: "ack", seq: 1, ok: true, reason: "" }),
    ).toBeNull();
    expect(
      feedback.acknowledge({
        type: "ack",
        seq: 2,
        ok: false,
        reason: "Not enough elixir.",
      })?.announcement,
    ).toContain("not deployed. Not enough elixir.");
  });
  it("drops feedback across exits or new rounds and permits a new submission", () => {
    const feedback = new DeploymentFeedback();
    feedback.submit(8, "knight");
    feedback.reset();
    expect(
      feedback.acknowledge({ type: "ack", seq: 8, ok: false, reason: "old" }),
    ).toBeNull();
    feedback.submit(9, "archers");
    expect(
      feedback.acknowledge({ type: "ack", seq: 9, ok: true, reason: "" })
        ?.announcement,
    ).toBe("Archers deployed.");
  });
  it.each(["legacy", "peer"] as const)(
    "uses the sequence actually sent by the %s client",
    (kind) => {
      vi.stubGlobal("document", { addEventListener: vi.fn(), hidden: false });
      const client =
        kind === "legacy" ? new DirectRoomClient() : new PeerRoomClient();
      client.connected = true;
      const send = vi.spyOn(client, "send").mockReturnValue(true);
      const feedback = new DeploymentFeedback();
      expect(client.play("knight", 4, 24)).toBe(true);
      const message = send.mock.calls[0][0];
      expect(message.type).toBe("play");
      if (message.type !== "play") throw new Error("missing deployment");
      expect(client.playSequence).toBe(message.seq);
      feedback.submit(client.playSequence, message.card);
      expect(
        feedback.acknowledge({
          type: "ack",
          seq: message.seq,
          ok: true,
          reason: "",
        })?.announcement,
      ).toBe("Knight deployed.");
      expect(client.play("goblins", 4, 24)).toBe(false);
      expect(send).toHaveBeenCalledTimes(1);
      client.pending = false;
      expect(client.play("goblins", 4, 24)).toBe(true);
      const next = send.mock.calls[1][0];
      if (next.type !== "play") throw new Error("missing second deployment");
      expect(client.playSequence).toBe(next.seq);
      expect(next.seq).toBeGreaterThan(message.seq);
    },
  );
});
