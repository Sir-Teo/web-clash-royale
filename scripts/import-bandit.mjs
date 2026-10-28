import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { csvRows } from "./lib/csv.mjs";
import { parseSC } from "./lib/sc.mjs";

const paths = [
  "reference/logic/spells_characters.csv",
  "reference/logic/characters.csv",
  "reference/sc/chr_bandit.bin",
  "reference/sc/chr_bandit_tex.png",
  "reference/sc/ui-spells.bin",
  "reference/client/dash-lifecycle-native-trace.json",
  "reference/client/dash-goals-native-trace.json",
  "reference/client/dash-admission-native-trace.json",
  "reference/client/dash-startup-native-trace.json",
  "reference/client/dash-recovery-native-trace.json",
];
const inputs = await Promise.all(paths.map((path) => readFile(path)));
const card = csvRows(inputs[0].toString()).find((row) => row.Name === "Assassin");
const unit = csvRows(inputs[1].toString()).find((row) => row.Name === "Assassin");
const model = parseSC(inputs[2]);
const portraits = parseSC(inputs[4]);
const native = JSON.parse(inputs[5]);
const goals = JSON.parse(inputs[6]);
const admission = JSON.parse(inputs[7]), startup = JSON.parse(inputs[8]);
const recovery = JSON.parse(inputs[9]);
if (createHash("sha256").update(inputs[9]).digest("hex") !== "678a1a62499b90d53da7d1ea286b23ebd9b3da5f6b5b3dd51db1acc112341fd0" ||
    recovery.profiles.loadTimeMs !== 600 || !recovery.cases.some((row) => row.fields.scenario === "chain" &&
      row.frames[26].hit && row.frames[27].clockMs === 950 && row.frames[27].reloadMs === 550))
  throw new Error("Recheck native Bandit immediate reentry evidence");
const recoveryWitnesses = [
  [recovery.cases.find((r) => r.fields.scenario === "hit"), 46],
  [recovery.cases.find((r) => r.fields.scenario === "miss"), 36],
  [recovery.controls.find((r) => r.fields.recoveryBuffs.join() === "Rage"), 42],
  [recovery.controls.find((r) => r.fields.recoveryBuffs.join() === "IceWizardSlowDown"), 57],
  [recovery.controls.find((r) => r.fields.recoveryBuffs.length === 2), 50],
];
if (recoveryWitnesses.some(([row, tick]) => row?.frames.find((f) => f.ordinaryRequests.length)?.step !== tick))
  throw new Error("Recheck native Bandit first ordinary recovery requests");
const ordinaryRequestCount = [...recovery.cases, ...recovery.controls].reduce((sum, row) =>
  sum + row.frames.reduce((count, frame) => count + frame.ordinaryRequests.length, 0), 0);
if (ordinaryRequestCount !== 104 || JSON.stringify(recovery.controls[0].frames.filter((f) =>
    f.ordinaryRequests.length).map((f) => f.step)) !== "[42,57,72,86]")
  throw new Error("Recheck native Bandit continuing ordinary cadence");
if (createHash("sha256").update(inputs[7]).digest("hex") !== "a772e93de669715acf0c798fce3c6cae75e0d425442ac1d2870e11e1ccc0dbce" ||
    createHash("sha256").update(inputs[8]).digest("hex") !== "cce10a224850d79720d667d507222f8bb381169e7f65720fd376376b5d9fff63" ||
    admission.profiles.dashMinimum !== 4000 || startup.profiles.retentionMaximum !== 7500 ||
    startup.cases[0].frames.find((frame) => frame.state === 4).step !== 20)
  throw new Error("Recheck native Bandit admission and complete startup evidence");
if (createHash("sha256").update(inputs[6]).digest("hex") !== "26422f0a0f651353044e75f39f9530c459a6754e00d67ee2fce40f414a636959" ||
    goals.profiles.headingScale !== 256 || goals.profiles.chunkUnits !== 250 ||
    !goals.controls.some((row) => row.fields.motion === "target-cleared" && row.frames.at(-1).state === 1 && row.frames.at(-1).targetHp === 1000) ||
    !goals.controls.some((row) => row.fields.motion === "dashing-target" && row.ordinaryHitCheck.returned === 0 && row.frames.at(-1).targetHp === 680))
  throw new Error("Recheck native Bandit goal, fixed movement and landing evidence");
if (createHash("sha256").update(inputs[5]).digest("hex") !== "91a9123774e707aadf59a1d706b9fa5af4e3695d6e3ba94415c36da6011a74eb" ||
    native.profiles.sourceJumpSpeed !== 500 || native.stepMs !== 50 ||
    !native.cases.some((row) => row.fields.damage === 121 && row.frames.some((frame) =>
      frame.state === 4 && frame.hp === 629 && frame.ordinaryHitBlocked &&
      frame.calls.movementFrame === 1 && frame.events.some((event) => event[0] === "hp"))))
  throw new Error("Recheck native Bandit movement and retained Poison evidence");
if (card?.Rarity !== "Legendary" || card.ManaCost !== "3" ||
    card.SummonCharacter !== "Assassin" || card.IconFile !== "bandit" ||
    unit?.Hitpoints !== "750" || unit.Damage !== "160" ||
    unit.Speed !== "90" || unit.Range !== "750" ||
    unit.HitSpeed !== "1000" || unit.LoadTime !== "600" ||
    unit.DashMinRange !== "4000" || unit.DashMaxRange !== "6000" ||
    unit.DashDamage !== "320" || unit.DashCooldown !== "1000" ||
    unit.JumpSpeed !== "500" || unit.DashFilter !== "filter_bandit_charge" ||
    unit.AttacksGround !== "true" || unit.AttacksAir === "true" ||
    !model.names.bandit_dash1_1 || !model.names.bandit_red_dash1_9 ||
    !portraits.names.bandit)
  throw new Error("Recheck archived Bandit card, dash and model");

const outputPath = "src/game/bandit-data.json";
const output = Buffer.from(JSON.stringify({
  card: card.Name,
  rarity: card.Rarity,
  cost: Number(card.ManaCost),
  sourceHitpoints: Number(unit.Hitpoints),
  sourceDamage: Number(unit.Damage),
  sourceSpeed: Number(unit.Speed),
  sourceRange: Number(unit.Range) / 1000,
  sourceHitSpeed: Number(unit.HitSpeed) / 1000,
  sourceLoadTime: Number(unit.LoadTime) / 1000,
  hitsGround: unit.AttacksGround === "true",
  hitsAir: unit.AttacksAir === "true",
  dash: {
    minimum: Number(unit.DashMinRange) / 1000,
    maximum: Number(unit.DashMaxRange) / 1000,
    damage: Number(unit.DashDamage),
    cooldown: Number(unit.DashCooldown) / 1000,
    speed: native.profiles.sourceJumpSpeed / 1000 / (native.stepMs / 1000),
    legacySpeed: Number(unit.JumpSpeed) / 60,
    startup: {
      stepMs: startup.stepMs,
      chargeMs: startup.profiles.dashCooldownMs,
      retentionExtensionUnits: startup.profiles.retentionMaximum -
        admission.profiles.dashMaximum - admission.profiles.targetRadius,
    },
    goal: {
      stepMs: goals.stepMs,
      unitsPerTile: goals.profiles.sourceUnitsPerTile,
      tileUnits: goals.profiles.goalTileSize,
      unitsPerStep: goals.profiles.sourceJumpSpeed,
      chunkUnits: goals.profiles.chunkUnits,
      headingScale: goals.profiles.headingScale,
      landingExtensionUnits: goals.profiles.landingRangeExtension,
    },
    filter: unit.DashFilter,
    startEffect: unit.DashStartEffect,
    travelEffect: unit.DashEffect,
    landingEffect: unit.LandingEffect,
  },
  blueExport: unit.BlueExportName,
  redExport: unit.RedExportName,
}, null, 2) + "\n");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
await writeFile(outputPath, output);
await writeFile("reference/client/bandit-manifest.json", JSON.stringify({
  source: "https://github.com/smlbiobot/cr",
  commit: "7fc7687e6de74690e902543ee4b59f562121e225",
  binarySource: "apk/1.8.1/com.supercell.clashroyale-1.8.1/assets/sc/chr_bandit",
  inputs: paths.map((path, i) => ({ path, sha256: sha256(inputs[i]) })),
  nativeDash: {
    stateEntry: "0x25cdf4 -> 0x214f60",
    movementFrame: "0x260c2c -> 0x2613f6",
    stepMs: native.stepMs,
    sourceUnitsPerStep: native.profiles.sourceJumpSpeed,
    unitsPerTile: 1000,
    retainedPoison: "0x218f48 -> 0x2601ae -> 0x2602d0",
  },
  nativeGoal: {
    launch: "0x25cd18 -> 0x263c4a",
    movement: "0x260c2c -> 0x2613f6 -> 0x26344e",
    landing: "0x2157eb..0x2159bc",
    fixedStepMs: goals.stepMs,
    landingExtensionUnits: goals.profiles.landingRangeExtension,
  },
  nativeStartup: {
    attackUpdate: "0x25c60c..0x25d068",
    admission: "0x25d852..0x25d946",
    cancellation: "0x25d4b0..0x25d6f2",
    stepMs: startup.stepMs,
    chargeMs: startup.profiles.dashCooldownMs,
  },
  nativeReentry: {
    attackUpdate: "0x25c60c..0x25d068",
    landingReload: "0x25c4fa..0x25c536",
    admission: "0x25d852..0x25d946",
    nextUpdateClockMs: 950,
    nextUpdateReloadMs: 550,
  },
  nativeRecovery: {
    attackUpdate: "0x25c60c..0x25d068",
    landingReload: "0x25c4fa..0x25c536",
    ordinaryReload: "0x25e681..0x25e69f",
    stepMs: recovery.stepMs,
    loadTimeMs: recovery.profiles.loadTimeMs,
    firstRequestAfterHitUpdates: 19,
    firstRequestAfterMissUpdates: 8,
    scope: "First ordinary request only; downstream damage and view bodies retain shared runtime behavior",
  },
  nativeCadence: {
    attackUpdate: "0x25c60c..0x25d068",
    ordinaryReload: "0x25e681..0x25e69f",
    stepMs: recovery.stepMs,
    ordinaryRequests: ordinaryRequestCount,
    rageRequestUpdates: [42, 57, 72, 86],
    scope: "Continuing post-landing ordinary requests; downstream damage and view bodies retain shared runtime behavior",
  },
  output: { path: outputPath, sha256: sha256(output) },
}, null, 2) + "\n");
console.log("Imported archived Bandit dash and model.");
