# Clash Royale · Browser Arena

A private, independent browser fan game for Sir-Teo. Built with TypeScript, Three.js and Vite. AI battles work offline. Friendly two-player battles connect directly between browsers; the default build is front end only.

Build an eight-card deck from all 74 playable rows in the archived 1.8.1 card roster, deploy troops and spells in a real-time arena battle, and take down the opposing King Tower. Includes three battle modes, complete native troop animations and projectile artwork, Goblin Stadium scenery reconstructed from archived exports and placements, audio, local progression, victory chests and match replays.

Combat includes cancellable attack windups, defensive building pulls, homing shots, ballistic bombs, Fireball travel and knockback, single-hit Arrows and Zap charge resets. Cannon uses its native aiming frames; Tesla hides underground, rises to attack and retracts when idle. Princess Towers use their dedicated native character animations. The King plays its original wake-up sequence and waits 3.3 seconds before aiming and attacking. New matches record version-56 combat. Projectiles created during combat hold at their source muzzle until the following simulation step, with AI hit forecasts using the same timing. Combat also includes recovered source projectile ranges, circular Princess volleys, troop formations, summoning clocks, deployment times and distance-based charges. Replays retain their original rules; an explicit rules family also preserves recordings from the earlier local branch. See [integration notes](docs/INTEGRATION.md) for migration and ambiguous older files.

Princess Towers preserve the original base and foreground battlements, with the animated character placed between them using her authored origin and the archived attachment height.

Play against AI or challenge a friend over Wi-Fi or compatible remote networks. The connected friend lobby shows your confirmed battle deck. Close that menu to edit your deck or name; changes clear both Ready checks. The accepted deck and match names stay fixed once countdown starts. After a friendly result, choose **Play again with friend**. Both players must agree, then return to the connected lobby to change decks and Ready up again. Each round saves its own replay without exchanging another invite. Exchange an invite and reply to connect the browsers directly, then use ready checks, emotes and both players’ replays. The game follows the archived 1.8.1 roster rather than the current live game's balance. Phone browsers can add it to the home screen with a standalone launch icon; AI battles remain available after the first complete load. See [multiplayer setup](docs/MULTIPLAYER.md) for direct Wi-Fi play and static hosting.

Automatic friend setup returns to the invite screen if preparation, connection or the game handshake stalls for 25 seconds. Prepared invite and reply sharing stays available while the tab remains open, and Leave connection lets you cancel and try again.

Friendly deployment feedback distinguishes sending a placement from the host accepting it. A rejected placement names its card and reason; it does not spend or automatically replay the command. Later acknowledgements preserve a newer aiming hint.

Placement hints and red territory shading follow the selected card. The Log starts on your side; Miner can start on either half outside the river. Other troops and buildings can advance into a lane after its enemy Princess Tower falls. Mirror uses the repeated card's placement rules.

Classic and Double Elixir rotate between seventeen named AI opponents, including Giant push, Hog cycle, Lava Clone, Golem Night Witch, siege, hut reinforcements and Goblin Barrel pressure. Their decks cover all 74 cards, and a completed match prevents the same opponent from appearing immediately again. Training keeps the original Royal Trainer and slower decisions. Opponent names and exact decks are retained in saved replays. The AI evaluates Fireball, Arrows, Zap and Rocket across the arena, finishes vulnerable towers with an affordable spell, and accounts for friendly blasts already in flight. It weighs each swarm body separately and avoids waking a dormant King for chip damage. Rage supports an advancing troop push or engaged defenders; Freeze protects a nearby friendly fight and can interrupt a fatal King Tower windup; Poison evaluates groups and vulnerable towers. Heal restores wounded friendly troops, and Clone supports a forward push while avoiding nearby splash damage and harmful areas. Both can support troops still deploying. Existing effects and the extra cost of a mirrored area spell are considered before another cast.

On a quiet field, the AI can invest in an Elixir Collector near its rear corners while keeping two elixir in reserve. It avoids duplicate pumps, nearby enemy pushes, incoming blasts and harmful active spells. It saves that investment late in regulation and during sudden death, and chooses a defender when under pressure.

Reinforcement decks also save for Goblin Hut, Barbarian Hut and Furnace while the field is quiet, keeping two elixir after deployment. A push at the river cancels saving so the AI can respond. Useful spells and a ready Collector investment can take priority. Huts use legal central placements, avoid known spell danger and keep producing their original troop waves.

Siege decks can save for offensive X-Bow and Mortar placements with a two-elixir reserve. They choose reachable Crown Towers using health and crown value, respect Mortar's blind spot and avoid ground screens or known incoming blasts. An opened lane permits a forward siege against the King; the actual acquisition and projectile rules still decide each attack.

Miner decks use enemy-side tunnels to pressure weaker Crowns and exposed Elixir Collectors. They keep two elixir, check which target Miner can actually acquire, and favor landings with less defensive fire. Known hazards are checked against tunnel arrival time. A nearly defeated Crown or exposed Collector can interrupt siege savings, while an approaching enemy push brings the AI back to defense.

Against a moving building-seeker, a defensive Miner includes the tunnel in its intercept timing before deployment and windup. Known Freeze releases and current movement buffs affect the lead. Mirror uses the same tunnel at its actual card cost.

Goblin Barrel decks can pressure weaker Crowns and exposed Collectors on a quiet field. They check all three Goblins' landing positions, keep two elixir and avoid guarded sites or spells still active when the Barrel lands. A Barrel already flying toward a target prevents another immediate cast at the same spot. Normal troop support can follow as elixir regenerates.

Graveyard decks save the spell's cost plus two elixir and use placements near the arena edge to pressure a Princess while protecting the dormant King. The AI checks the whole possible spawn area, avoids guarded lanes and known harmful effects, and holds the investment when little match time remains. Huts, siege and Graveyard share a pressure budget; useful spell finishers and exposed-Collector counters can still take priority.

Golem, Lava Hound and Three Musketeers decks can save for their main army instead of continuously cycling cheaper support. They keep up to two elixir within the ten-elixir cap, account for saving and travel time, and check the full deployment formation against known spell danger. Existing tanks or a full Musketeer group prevent another duplicate investment. Defense, useful spells and Collector opportunities can interrupt saving; a viable Miner or Barrel can act before an unfunded army.

A battle’s Details view can export a replay-only JSON file. Open it from **Battle log → Open replay file** to preview both decks and watch the recording in another browser. Shared playback preserves the exporter’s name and viewing side through seeking and restart, and leaves local decks, progress and rewards unchanged. The imported preview also offers **Practice against this deck**: choose either recorded player’s deck for the AI and a practice pace. You use your active battle deck in a fresh reward-free battle under your own name. Practice saves its own replay; the imported recording stays separate. Progress backups remain a separate restore flow. Replays also retain a card played immediately before a recording ends, including a zero-duration recording, without adding an extra simulation step.

Replay controls show elapsed and recorded time, with ten-second back/forward buttons. Open **Plays** to jump directly to a recorded card play; simultaneous plays share one entry, labeled from the currently viewed side. Outside controls, use Left/Right to skip ten seconds, Home/End to jump to the beginning/end, square brackets to move between card plays and Space to pause or resume. Seeking preserves playback speed and the paused state; reaching the end pauses playback.

During a replay, the swap-arrows button beside Battle settings toggles **View opponent side**. The board, hand, elixir, names and play labels follow the selected side. Switching keeps the current time, playback speed and paused state; restart keeps the chosen side. Saved recordings and progress keep their original player identity.

Tap a replay hand card, or focus it and press Enter/Space, to inspect its current level-11 stats. Reading a card pauses playback. **Back to replay**, Escape or closing the dialog restores the previous playback state, speed and viewing side. Cards remain inspectable when unaffordable, before Mirror has a target and after the recording ends.

From a shared replay preview, choose a **Destination battle deck**, then **Use recorded player deck** or **Use recorded opponent deck** to copy those cards and select that slot. **Undo deck change** restores all previous saved decks and the active selection. Card inspection keeps the destination, practice choices and Undo available.

Search the battle log by opponent or cards in either starting deck, and combine that search with result, mode and battle-type filters. Choose Practice to see labelled practice recordings, AI battles for other AI matches, or Friends for friendly games. Opponent names remain visible on phones. Filters stay selected during the session; returning from Details restores the selected row, keyboard focus and scroll position. Clear filters restores the full saved log.

Battle log details show both starting decks, average elixir, the result and match duration. New recordings also retain your name from the start of the battle. Later profile edits apply to future battles; recorded details, replay openings/endings and exported files keep that battle name. Older recordings use the profile name when opened. Tap a card to inspect it or replay the match. From the lobby, copy either recorded deck into any of the three saved slots, with an immediate Undo action in the details view. Friend replays display the decks from your own side of the arena.

Open the battle-mode menu and choose **Practice a deck** to pick any of the seventeen named AI opponents. Search by opponent, play style or cards in the starting deck; multiple words narrow the matchups. Choose any of your three saved decks without changing your active battle deck. Preview both starting decks and their average elixir, or tap a card to inspect it before starting. Choose Training, Classic or Double Elixir pace. Training uses relaxed AI; the other paces use regular AI, and Double Elixir refills twice as fast from the start. **Practice again** keeps both decks and the pace. Every practice keeps trophies, gold and chests unchanged.

Below an opponent’s recorded cards, choose a pace and **Practice against this deck** to face those cards with your active battle deck. **Practice again** keeps the same opponent deck and pace; returning to the arena restores your selected battle mode. Practice results save their own replays and count toward your battle statistics. New records are labelled Practice in the battle log, details and shared replay previews. The practice pace stays selected for the session.

Open **Cards → Deck codes** to copy your current eight cards or preview a code from another player. Inspect the shared cards, choose a saved battle deck and select **Use this deck** to apply it. An immediate **Undo deck change** restores your previous deck selection. Choose a practice pace and **Practice against this deck** to face the shared cards with your active deck, with no trophies or rewards. Codes contain only ordered card IDs and work across browsers; they do not include progress or rewards. Select a deck card and use **Earlier** / **Later**, or **Alt + Left / Right** while it has focus, to arrange the saved order. Opening hands are shuffled.

Troop defense weighs nearby pushes using each visible attacker’s damage, health, approach time and the health of living Crown Towers. Non-projectile defenders can lead a moving building-seeker, placing ahead for their deployment and first attack instead of chasing from behind. The forecast accounts for current movement delays, Rage and a covering Freeze area, and stops at the attacker’s target. When an air push has no affordable direct counter, useful spell or legal building lure, the AI can defend a lower-ranked ground push instead of holding every card. Healthy swarms share pressure around the same target; distant or nearly dead bodies carry less weight. It prioritizes imminent lethal King hits, places defenders near the chosen attacker, and values splash support from nearby enemies that the defender can actually hit. When no affordable direct air counter is available, Cannon can draw an approaching Balloon away from a Crown Tower if a legal placement will intercept its targeting.

Freeze and Tornado account for pending King hits changing an active enemy Lightning spell’s targets. They avoid cancelling a nonlethal swing when that would redirect a fatal pulse from a nearby blocker onto their own King.

King defense also follows blockers moved by active Tornado spells. A Giant leaving Lightning’s circle can require immediate defense; a Giant entering it can absorb the pulse and let the AI save its Freeze.

Lightning attacks and follow-up spells also track blockers moved by active Tornado spells. Tornado can pull a blocker out of a pending bolt to finish the enemy King, and avoids pulling one in when that would spoil a known win. The AI compares the resulting pulse timing when choosing a finisher, reserving spell damage and racing an incoming King loss. It also accounts for Tornado moving enemies into or out of spells already in flight when deciding whether to cast again. New blast spells aim where the current pull will carry their targets before impact, and save costly casts when the targets will already be dead. The AI can also lead Hog Rider and Balloon approaches toward a stable building target, including known Rage, slow, Freeze, stun and deployment delays. Ordinary homing shots and plain Arrows already in flight preserve this forecast and contribute to target survival checks. Arrows reservations also follow these approaches, so a miss does not postpone a useful follow-up.

The AI also accounts for friendly Lightning killing or stunning attackers before release, saving Freeze when the current pulse already prevents a King loss. This includes stuns after a shield breaks; a pulse arriving after the attackers release still requires defense.

Log targeting follows known Tornado pulls when choosing a rolling lane, including competing and expiring pulls. It checks contact throughout the launch and roll, so troops leaving an old lane do not justify a wasted cast and troops pulled into reach can become useful targets.

In **Cards**, search plain names such as “pekka” or “Mini Pekka”, combine card type with elixir cost, and sort by elixir or name. The result count follows the active filters. Tap a collection card to inspect it; **Back to collection** preserves the search, filters and sort order. Select a deck card to move or replace it; select it again to cancel and return to inspection. Opening the builder again from the lobby starts with the full collection.

Use **Undo** and **Redo** to restore the latest 50 replacements and card moves from the current builder visit. **Ctrl/Cmd + Z** undoes; **Ctrl/Cmd + Shift + Z** or **Ctrl + Y** redoes. Search and code fields keep their normal text undo. Inspection and viewing deck codes retain the edit history; adopting a different deck clears older edits. Closing and reopening the builder starts a fresh undo history while retaining your saved deck.

Homogeneous troop card groups stagger their native deployment filters within the archived visual delay window. Three Musketeers uses 0, 100 and 200 ms offsets. Goblin Gang uses its recovered angular timing in new rules-22 matches: 100, 166, 233, 300, 366 and 33 ms in creation order. Every body retains its own visual clock through replays and friend snapshots. Combat deployment remains independent.

Card details show current arena stats: per-troop swarm health and damage, separate melee/Spear Goblin stats for Goblin Gang, separate shield hitpoints for Guards and Dark Prince, hit intervals, building lifetimes, Crown Tower spell damage, and timed spell effects. Utility buildings show Collector production, troop spawn timing, spacing within paired waves and Tombstone's death spawn. Golem, Lava Hound, Battle Ram and Night Witch show their released troops' count, stats, targets and deployment time, including Golem death blasts and Night Witch's Bat-wave clocks. Shielded troop details explain that a hit that breaks the shield does not damage the body. Rage identifies friendly targets and its boost; Poison shows damage per second and lingering time. Inferno Tower and Inferno Dragon list all three damage stages, total lock times and beam reset rules.

Mortar placement marks its 4.5-tile blind spot with an amber inner boundary. Its card details list that minimum range and the four-second setup time.

Three Musketeers adds three ranged Musketeer bodies for nine elixir, using the same normalized stats, native animations, projectiles and lifecycle sounds as the four-elixir Musketeer. It has its own original card portrait. Each body can attack ground and air; Fireball leaves the same remaining health as an ordinary Musketeer, and follow-up damage can clear the group. Musketeer Marshal brings it in a Hog-supported solo deck. The trio uses its recovered native triangular deployment pattern in new matches.

Minion Horde adds six flying Minions for five elixir, using the original Minion animations, projectiles, sounds and its own native card portrait. It attacks ground and air, and remains vulnerable to splash damage and Arrows. Sky Captain includes it in the Balloon Freeze deck.

The four original King emotes use complete native expressions and speech-bubble animations, with 16 voice variations. Six original quick-chat phrases use their native text bubbles, wooden selector and archived chat font. Each player has an independent bubble, a host-enforced cooldown and a persistent local mute option. The selector works with touch, mouse and keyboard; reduced motion uses still artwork.

Fireball impacts use the original layered smoke, glowing fragments, sparks, flames and lingering scorch effect. Native additive and screen blending keep fire and lightning bright, and particle motion follows the archived client’s linear deceleration and gravity integration. Sparks, fire, smoke and elixir splashes retain source tail delays and stretch their native artwork between projected motion endpoints; pause and replay seeking preserve their poses.

Zap impacts use the archived bolt, electricity, smoke, sparks and ground glow composition. Arrows cover their source four-tile radius with one damaging flight, 15 visible sprites and 15 native ground marks. Earlier version-2 through version-15 replays keep their three damage waves. Their source artwork and particle timing work in solo play, replays and browser-to-browser matches on desktop and phone. Bomber costs three elixir; Goblins deploy three units and Skeletons deploy four, matching their archived card rows.

The basic speed, attack reach and hit interval of 47 directly mapped troop cards now come from the pinned character table. Executioner's returning axe keeps dedicated timing. Balloon retains its dedicated bomb attack while moving at the archived speed of one arena tile per second in new matches. Versions 1–12 replay its previous 0.85-tile speed. Regenerate the source projection with `npm run assets:card-stats`.

Valkyrie, Bomber, Baby Dragon, Witch and Wizard now use their archived melee or projectile splash radii: 2, 1.5, 1.2, 1 and 1.2 tiles respectively. Versions 1–13 replays retain the previous curated hit areas. Regenerate these values with `npm run assets:card-splash`.

Troops, buildings and Crown Towers now use their archived collision radii for spacing and attack reach. The projection covers 61 playable and split-unit entries plus both tower types; versions 1–14 replay with the earlier estimated bounds. Regenerate it with `npm run assets:collision-radii`.

The attacking buildings also use their archived range, cadence and lifetime. Cannon and Tesla both fire every 0.8 seconds; Tesla lasts 40 seconds. Existing replays preserve the earlier building values.

Started projectile attacks can finish when their target moves up to half a tile beyond ordinary reach, when their attack-cycle clock is past its initial 50 ms guard. Troops, buildings and Crown Towers share this recovered range rule. Targets beyond that allowance still cancel the shot, and Mortar keeps its minimum distance. Earlier replays retain their original behavior.

Nine cards with large health or damage gaps now use source values at the roster's established rarity scales. This changes the health of Mini P.E.K.K.A., Bomber, Baby Dragon, Prince and P.E.K.K.A., and the damage of Goblins, Goblin Gang, Spear Goblins, Bomber and Witch. Earlier replays retain their previous values. Regenerate the projection with `npm run assets:card-vitals`.

Balloon's main bomb now uses its archived three-second hit interval, close attack reach and Epic-scaled damage. The delayed bomb it drops on death remains a separate attack. Versions 1–9 keep the earlier main-bomb values during replay.

King Tower health now uses the same source-to-roster scale as Princess Tower health and both towers' projectile damage: 5,232 health at this normalized level. Versions 1–10 replay with the previous 4,824 health.

Fireball, Arrows and Zap now deal their archived 40% damage to Crown Towers, matching Rocket and the pinned spell data. Versions 1–11 replays retain their previous 30% damage from those three spells.

Freeze costs four elixir and holds enemies within its three-tile circle for four seconds, including troops that enter later and hidden Teslas. Its original portrait, cast sound, snow particles and blue/red ground artwork work in solo play, replays and browser-to-browser matches. Frozen troops, buildings and towers use the archived icy color animation, also shared by Zap.

Poison costs four elixir and damages enemies across an eight-second, 3.5-tile area. Its damage buff lingers briefly after a troop leaves, while buried Teslas remain immune. It uses the archived portrait, cast and impact cues, rising skull particles, team-colored ground rings and a 37-frame green color filter for troops, buildings and towers. Solo play, direct two-player matches and replays share the same fixed-step area rules.

Heal costs three elixir and restores friendly ground and air troops inside a three-tile area for 3.05 seconds. The archived 50-ms area pulse refreshes a half-second buff that heals every half second; buildings and Crown Towers cannot receive it. Its original portrait, sound, blue/red rings, glowing lines, smoke and crosses render in solo play, replays and direct two-player matches. The source marks this card as an upcoming release in the archived roster.

Rage costs two elixir and boosts friendly troops' movement, attack and summoning speeds by 35% in a five-tile area. Its six-second source area reapplies the buff to troops entering later; the brief remaining buff cannot outlive the area. In new matches, Rage and slow also change troop run/idle animation and air-bobbing rates, with a continuous phase through buff expiry and replay seeking. Freeze and stuns pause those loops and bobbing until the troop recovers. It uses the original portrait, purple ground rings, sparkles, impact sound, 50-frame troop color filter and 25% higher troop-sound pitch. The same fixed-step rules run in solo play, direct matches and replays.

Rocket costs six elixir and flies at its archived speed before a two-tile explosion damages ground and air troops, knocks surviving troops back and deals 40% damage to Crown Towers. Its original portrait, missile, smoke/spark/glow trail, eight-part impact, sound and screen shake play in solo, direct matches and replays. The 700-point archived damage uses the roster's Fireball level-11 conversion; the missile's 3D orientation remains a visual approximation.

Lightning costs six elixir and strikes the three highest-health enemies inside a 3.5-tile area at separate source-paced intervals. Each bolt damages and briefly stuns one target, with reduced Crown Tower damage. Its archived portrait, sky bolt, sparks, smoke, debris, audio and shake work in solo play, direct two-player matches and replays. Damage uses the roster's Fireball level-11 conversion; selecting a distinct target per pulse is the browser rules interpretation.

The Log costs two elixir and launches from your side before rolling through enemy ground units. Its archived Legendary portrait, two projectile stages, rolling trail, hit and breakup effects, and native audio accompany source-paced travel, one hit per target, knockback and reduced Crown Tower damage.

Tornado costs three elixir and pulls enemy ground and air troops toward the center of a 5.5-tile area while dealing small periodic damage. Its archived portrait, 390-frame team rings, 27-frame animated whirl, rocks, clouds, glow and sound work in solo play, direct matches and replays. Buildings are unaffected.

Goblin Barrel costs three elixir and flies across the arena before its native wooden burst releases exactly three Goblins. The archived 194-frame projectile, shadow, five-part landing effect and sounds work in solo play, direct matches and replays.

Graveyard costs five elixir and summons Skeletons every half second inside a large ten-second area. Its original Legendary portrait, team-colored ground/radius animation, mist, embers, burial holes, Skeleton arrival and sound work in solo play, direct matches and replays.

Clone costs three elixir and copies friendly ground and air troops inside a short-lived area. The one-hitpoint copies carry the original troop art with the archived animated hologram colors. Its Epic portrait, team radius, green light shaft, sparkles and sound work in solo play, direct matches and replays.

Musketeer and Cannon shots share the archived cannon impact; Bomber, Baby Dragon and Wizard projectiles use their own native sparks, smoke, flame and debris compositions. These hit effects stay separate from each troop's death effect.

Destroyed towers leave native rubble for the rest of the battle. Their collapse uses original fire, smoke, flying plank and wall-fragment artwork. Debris pauses with the match and finishes settling after victory; replay seeking reconstructs the correct ruins.

Earned crowns spin out of destroyed towers and fly to the matching score counter. A King Tower awards the remaining crowns to reach three. The flights follow pause and replay speed, adapt when a phone rotates, and finish before the result panel appears.

Finished matches play the original “Match Over!” animation and red/blue score panels, including separate old, empty and newly earned crown states. Replay seeking holds a still final score, and reduced motion skips the animated entrance. The ending fits portrait and landscape phones and freezes while the browser is backgrounded.

Tower outcomes resolve after all impacts in the current simulation step. Both Kings falling together produces a draw; equal Princess Tower trades can continue into overtime. A destroyed King collapses its remaining Princess Towers, and rewards never exceed three battle crowns per side.

Battle countdowns and overtime notices use the original font, authored animation frames, colors and elixir artwork. Native countdown voices and horn cues follow the match; replay seeking restores the correct notice without playing skipped sounds. Pausing, muting or backgrounding stops active sound effects.

Battles open with the original animated arena title, crossed swords, red/blue player ribbons and FIGHT lettering. Combat, AI and elixir wait for the intro's authored action frame. The opening pauses with the game, fits long player names, adapts to phone rotation and plays when a replay restarts; seeking skips it.

All 74 cards use original unframed portraits with native hand/deck frames, cost drops and text. Mirror repeats your previous card for one extra elixir; its hand and next-card costs update with the copied card. Minion Horde and Three Musketeers deploy six Minions and three Musketeers; Goblin Gang uses its recovered six-position ring, with three melee Goblins ahead of three Spear Goblins in both the placement preview and actual deployment; Barbarians deploy four original animated melee fighters; Elite Barbarians deploy two faster original fighters from a six-elixir card; Ice Spirit fires one native icy splash projectile, freezing ground and air enemies for 1.5 seconds before vanishing; Fire Spirits deploy three fast one-use attackers, each launching an original fiery ground-and-air splash projectile; Ice Golem pursues buildings and leaves a damaging two-second slow area for ground and air enemies on defeat; Giant Skeleton drops an original three-second bomb whose blast damages and pushes ground and air defenders; Guards deploy three shielded melee skeletons and shed their native armor when hit hard enough; Royal Giant fires an original large cannonball at buildings; Mega Minion flies and attacks ground or air with its native shot; Dart Goblin fires rapid darts with their original trail and hit effects; Ice Wizard’s icy splash slows ground and air targets for two seconds with its native cold filter; Princess fires a long-range five-arrow volley whose center arrow deals splash damage; Inferno Dragon locks onto a ground or air target with a beam that ramps through three damage stages; Inferno Tower defends its lane with a matching three-stage beam, original building art, and native fire effects; X-Bow takes four seconds to deploy, then fires rapid native arrows at distant ground troops and Crown Towers; Elixir Collector pumps one extra elixir every 8.5 seconds while it survives, with its original animated building and collection sound; Goblin Hut releases one Spear Goblin about every five seconds with its original building, portrait, deployment and death effects; Tombstone spawns a Skeleton every 2.95 seconds and releases four more when it breaks, with both original team animations; Furnace sends out two Fire Spirits per wave, half a second apart, with its original ten-second building animation; Barbarian Hut releases two Barbarians per wave with its original building art; Electro Wizard Zaps nearby enemies on arrival and briefly stuns two targets with each attack; Miner tunnels to the enemy half and emerges behind defenses with reduced Crown Tower damage; Bowler rolls a boulder through ground troops and pushes survivors along its path; Dark Prince charges with a ground-splash mace and sheds his native shielded armor when the shield breaks; Battle Ram ignores defenders as it charges a building and releases two Barbarians when it breaks; Executioner throws one axe through ground and air defenders, then catches it after a second hit on the return path; Sparky charges a ground-only cannon that splashes and pushes back defenders, with Zap resetting its charge; Lumberjack drops a falling Rage bottle on death, leaving a 7.5-second friendly buff area; Bats deploy five small flying attackers with their original looping motion; Night Witch summons Bats every five seconds and releases four more when defeated; Bandit charges briefly before committing to a dash destination, can charge toward a ready distant follow-up after landing, uses native ordinary attack timing, retains recovery through target changes and finishes committed melee swings through distance changes, remains vulnerable while charging, and evades ordinary hits during the heavy landing dash while existing Poison and opposing dash strikes can still hurt her; Golem takes three seconds to deploy, ignores troop distractions, explodes against ground and air defenders and splits into two independently exploding Golemites; Lava Hound flies at its source height, fires homing coal from its original muzzle height, and releases six Lava Pups that fly at their source height when defeated. Selected cards show the original white outline, and newly drawn cards play the source reveal animation. The same artwork appears in the deck editor, details, next-card preview and drag controls; phone touch targets remain at least 44 pixels.

Flying troops, drag previews, death effects, projectile origins, and Inferno Dragon's beam use the individual heights and muzzle offsets from the archived character data. Their shadows and team markers stay on the arena floor while the troops bob overhead.

The match timer and vertical crown counters use the original HUD artwork and type. Overtime transitions into its native red panel, and each team's crown icon plays the source bounce when awarded crowns. Portrait and landscape use their separate archived layouts; crown flights land on the actual counter artwork.

Troops and towers use the original health bars, level badges, crown icons and hitpoint typography. Small, medium and large bars follow the archived character profiles; the King’s health display opens with its activation. Damage, pause and replay seeking preserve the correct fill and animation frame, including on phone rotations.

The elixir HUD uses native bar, drop, divider and card-cost artwork, with the original gain, spend, full-bar and regeneration animations. Narrow landscape layouts shorten the bar while keeping its number readable. All feedback follows the simulation clock and clears correctly when seeking a replay.

Troop deaths use source-specific elixir splashes, smoke, dust and ground marks. Knights leave their original sword behind, Giants have a larger burst, Skeletons have smaller effects, and Balloons release airborne clouds. Native particle geometry is batched on the GPU to keep large swarms practical on phone-sized screens.

Combat sound follows separate attack windups, projectile launches, impacts and spell casts. Native weapon sounds and voice variations use their archived delay, pitch and volume ranges. Interrupted attacks discard their pending windup cues; projectiles retain their sound even after the shooter dies. Audio follows replay speed, pause and both players' direct connection. Battle music switches among the pinned two-minute, last-minute, final-30-second and sudden-death tracks as the match clock advances; replay seeking resumes the matching passage. Music and sound-effect switches work independently.

Deployments use original troop-specific dust, shadows and rock bursts, including separate effects at each Archer’s spawn position. Source delays and late peer snapshots keep the burst at the birth location. Deployments also use each troop or building's own cues, including the Musketeer's delayed reload and troop voice variations. The Witch plays her original skeleton-summoning cue. Tesla plays its native opening and closing sounds as it rises and retracts. The Balloon death bomb uses its team-colored native drop animation, original sound cues, fire, smoke, debris and a fading ground mark. Fireball, Zap, Balloon impacts and tower destruction move the arena using the source shake durations and a decaying camera offset; controls remain fixed, pause freezes the frame, and reduced motion disables the movement. Swarm voices obey their source limits, and delayed voices stop when their owner dies.

## Development

```sh
npm ci
npm run dev
```

`npm run check` runs simulation and persistence tests, type checking and a production build. `npm run test:e2e` runs desktop Chromium and phone Chromium/WebKit browser tests (install both once with `npx playwright install chromium webkit`). Assets and fonts are bundled locally. The production build generates an offline cache; after its first complete load, the game can reload and start battles without a network connection. `npm run assets:app-icons` regenerates the install and touch icons from `public/app-icon.svg`.

Use `npm run test:fast` for quicker local iterations. It reuses unit-test workers with file isolation disabled. Run `npm run check` before committing to verify the tests with file isolation, type checking and the production build. Both unit commands accept file paths after `--` for focused checks.

To verify offline behavior, run `npm run preview -- --host 127.0.0.1 --port 5189 --strictPort` and then `npm run test:offline`.

`npm run assets` refreshes cards, renders and audio. `npm run assets:sprites` imports complete native animation sequences and lossless textures; `npm run assets:scenery` reconstructs tower and arena textures from the retained metadata. No asset generation is needed for normal development.

`npm run assets:combat` regenerates combat traits from retained historical CSVs. `npm run assets:effects` imports the original projectile and electrical-effect clips. `npm run assets:buildings` imports both teams’ Cannon, Tesla and layered King Tower timelines. Development inspection pages are available at `/tests/fixtures/animations.html`, `/tests/fixtures/effects.html`, `/tests/fixtures/buildings.html` and `/tests/fixtures/combat.html`; they are excluded from the production build.

`npm run assets:destruction` regenerates tower and troop death compositions from retained client/character tables and imports their native particle clips.

`npm run assets:death-audio` imports the corresponding native sound mappings and eight pinned audio files, preserving nested effects, team variants, volume/pitch ranges and delays.

`npm run assets:combat-audio` imports the complete troop/tower/spell sound profiles and pinned audio files from the retained logic, effects and sound tables. Card sources come from the native portrait bindings. Source and output hashes are retained in the combat-audio manifest.

`npm run assets:ui` imports five native battle announcement timelines, their text styles, font, elixir icon and sound mappings. `/tests/fixtures/timing.html` provides precise countdown/overtime inspection and is excluded from production.

`npm run assets:intro` imports the complete standard/training battle openings and derives their action-frame timing. `/tests/fixtures/intro.html` inspects source frames, player-name fitting and the transition into combat.

`npm run assets:elixir` imports eight native elixir HUD clips and their source geometry. `/tests/fixtures/elixir.html` provides amount, selected-cost, spending, regeneration and frame-step controls for visual inspection.

`npm run assets:cards` imports native card layers and all 74 source portraits. `/tests/fixtures/cards.html` provides the full gallery, selection states and a frame-stepped hand reveal.

`npm run assets:freeze` pins Freeze's archived cost, radius, duration and hidden-target rule. `npm run assets:destruction`, `npm run assets:effects` and `npm run assets:combat-audio` regenerate its original particles, ground/radius clips and cast sound. `npm run assets:cold-filter` imports the original character tint shared by Freeze and Zap.

`npm run assets:poison` pins Poison's cost, radius, duration, tick interval, damage buff and tower multiplier. `npm run assets:poison-filter` imports its original 37-frame troop color and squash timeline. The shared card, effect and audio imports include its portrait, skull particles, ground clips and cues.

`npm run assets:heal` pins Heal's cost, duration, radius, area refresh and buff cadence, healing amount and friendly troop targeting. Shared card, effect and audio imports add its archived portrait, seven-part team-colored particle effect and original cue. The browser normalizes the source Rare healing amount to the roster's level-11 scale.

`npm run assets:rage` pins Rage's cost, radius, duration, buff interval and three speed multipliers. `npm run assets:rage-filter` imports the original 50-frame purple troop color timeline. The shared card, effect and audio imports include its portrait, sparkles, ground clips and sound.

`npm run assets:rocket` pins Rocket's cost, radius, speed, damage, knockback and Crown Tower multiplier. The shared card, effect, impact and audio imports include its source portrait, 60-frame projectile, explosion and cues.

`npm run assets:lightning` pins the archived cost, radius, 1.5-second area, 460-ms pulse, highest-health targeting, projectile damage and half-second stun. Shared imports provide its original portrait, nine-part impact and sound.

`npm run assets:log` pins the archived launch and rolling projectile rules. Shared imports provide its original portrait, blue/red rolling art, shadow, dust, wooden breakup and sound.

`npm run assets:tornado` pins its archived area, buff, attraction and damage rules. Shared imports provide its original portrait, animated whirl, rings, particles and sound.

`npm run assets:goblin-barrel` pins its archived projectile, travel speed, landing radius and three-Goblin spawn. Shared imports provide the original portrait, flight animation, shadow, impact and sound.

`npm run assets:graveyard` pins its archived ten-second area, 1.5-second initial delay, half-second Skeleton cadence and deploy time. Shared imports provide the original portrait, team ground/radius clips, spawn effects and sound.

`npm run assets:clone` pins the archived short area, own-troop targets and hologram binding; `npm run assets:clone-filter` retains both native color timelines. Shared imports provide the portrait, ground/radius effects, sparkles and sound.

`npm run assets:golem` pins both source character profiles, the eight-elixir card, building targeting, deployment delay, death blasts and two-Golemite split. Shared imports provide the original portrait, 54 directional clips per character, blue/red art, dust and rock effects, death audio and health displays. Golem's four authored firefly emissions use their original blue/red animated particles and follow the unit through replay and peer snapshots; the client archive does not expose the loop period, so the browser repeats the 0/3/9/12-second pattern every 15 seconds. `/tests/fixtures/combat.html` inspects the animated split.

`npm run assets:lava-hound` pins the seven-elixir Legendary card, flying Hound and Pup profiles, both 45-point homing coal projectiles and six-Pup death release. Shared imports provide the original portrait, 54 Hound and 27 Pup directional clips, projectile trails and hit particles, effects, sound mappings and health displays. The archived Hound death sound group has no audio file; Pups retain generic death audio. `/tests/fixtures/combat.html` inspects the flight and split.

`npm run assets:health` imports 12 native health displays and ten fill timelines. `/tests/fixtures/health.html` inspects the original artwork; `/tests/fixtures/health-arena.html` exercises damage, King activation, pause, death and renderer rebuilding in the arena.

`npm run assets:hud` imports six native timer/crown clips and both responsive crown compositions. `/tests/fixtures/hud.html` provides precise timer, score, animation-frame and source-layout inspection.

`npm run assets:ending` imports five native match-ending and score timelines. `/tests/fixtures/ending.html` inspects exact frames, names, crown awards and still final scores.

`npm run assets:emotes` imports 17 native reaction/control clips, six quick-chat phrases, the chat font and four original voice groups. `/tests/fixtures/emotes.html` provides both player bubbles, expression/phrase selection, frame stepping, voice playback and mute controls.

## Phone play

Phones automatically use a 30-FPS presentation budget with smaller texture atlases and adaptive arena resolution. Controls and text retain the browser's normal resolution. Combat and replay clocks still advance at their fixed 30-Hz rate.

Open the Vite **Network** URL on a phone connected to the same Wi-Fi as the development computer. `localhost` on a phone refers to the phone itself. For a friendly match, use **Share invite** or **Share reply** when available, or the **Copy** buttons on an HTTP Wi-Fi address; a game opened at `localhost` shares a code that the other phone can paste after opening the Network URL. Portrait battles fill the available browser height; rotating into landscape moves the hand alongside the arena. Safe-area padding keeps controls away from display cutouts and the home indicator. Tap a card and then the arena, or drag a card onto the battlefield. Pause and settings use 44-pixel touch targets. AI battles pause when the browser goes into the background. Direct friendly battles pause when either player switches apps. Keep both tabs open; a reload requires a new invite.

If arena graphics are interrupted, local simulation and deployment wait for recovery, and direct friendly matches pause both players. A persistent notice remains until graphics return. A solo pause stays available to resume afterward; an existing manual pause is preserved. If the battle ends before recovery, its result and return-to-arena action remain available. Reload if recovery does not finish. The optional legacy server mode keeps its online battle running.

## Static hosting

Firebase Hosting is configured for `sir-teo-clash.web.app`, serving the front-end-only build from a dedicated site; the match still connects browser to browser. To publish the current checkout again, install the Firebase CLI and run `npm run deploy:hosting`. The command builds `dist/` with root-relative assets and publishes only that directory to the `sir-teo-clash` site in project `sincere-hybrid-203601`. Source, tests and reference files remain in the private repository.

GitHub Pages is also configured to deploy on every push to `main` through `.github/workflows/pages.yml` at https://teozeng.dev/web-clash-royale/. As of October 23, 2026, GitHub Actions rejects its jobs before the first step because of an account billing or spending-limit issue ([affected Pages run](https://github.com/Sir-Teo/web-clash-royale/actions/runs/40034244242)); that URL has an older build. Once the account issue is resolved, Pages can build the current `main` branch with `VITE_BASE_PATH=/web-clash-royale/`. The web app manifest resolves its launch scope and icons relative to that path.

`npm run test:hosting` builds at the Pages path, starts an isolated preview on port 5189, and verifies native assets, service-worker scope, offline reload and battle startup. CI runs this check before the production browser suite. For another preview address, set `ARENA_BASE_URL` when running `npm run test:offline`.

New releases wait while a game is open. When an update is ready, **Update game** appears in the lobby; close other arena tabs before applying it. Dismiss the notice to keep playing the current release. Battles, replays and friendly rooms keep their current release. Reloads can use that release offline until the update is applied, so a deployment cannot mix a new page with old cached artwork and rules.

## Controls

Open **Battle settings → How to play** for controls and placement rules on phones or desktop.

- Click a hand card, then click the arena, or drag the card into position.
- Placement previews show the complete troop formation in native artwork, with live elixir and territory feedback.
- Keys **1–4** select a card. **Escape** cancels a selection or pauses; **Space** pauses when the arena has focus. Focused buttons keep their normal keyboard activation. Selection, cancel and pause shortcuts act once per press. The pause menu focuses **Resume battle**; **Tab** reaches Leave and Close, and **Escape** resumes.
- To deploy by keyboard, select a card with **1–4** or its focused hand button, use the **Arrow keys** to aim, and press **Enter**. Arrows move half a tile; **Shift + Arrow** moves two tiles. The preview shows the same placement and elixir feedback as mouse and touch. **Tab** leaves the battlefield.
- Dialogs keep keyboard focus inside their controls. Deck selections retain focus while the builder updates; closing a dialog returns to its opener. The arena and lobby controls are inactive behind an open dialog.
- During a replay, **Plays** jumps to a recorded deployment; **[** and **]** move between plays when the arena has focus. The speed button cycles through 1×, 2×, 4×, 0.5× and 0.25×.
- Screen readers receive keyboard help for the focused battle or replay arena. Completed battles and the lobby preview have their own descriptions; a completed replay keeps its navigation shortcuts.
- Troops normally deploy on your half; most spells can target either half. The Log starts on your half, while Miner can tunnel to the enemy side. Destroying a Princess Tower opens deployment territory in that lane.
- Decks, results and preferences save automatically in this browser.
- From the lobby's **Battle settings**, use **Export progress** to save a JSON backup. **Restore backup** previews its player, rewards and replay count before replacing this browser's progress. Backups include all three decks, chests, preferences and the latest ten replays; they can move progress to another browser or device. If browser storage cannot save settings, the confirmation identifies the session-only change; Settings points to Export progress so those changes can still be kept in a backup.

See [architecture](docs/ARCHITECTURE.md), [asset provenance](docs/ASSETS.md) and [verification](docs/QA.md).

## Implementation steps

1. Project foundation and reproducible asset imports.
2. Deterministic battle simulation, card roster, AI and rules.
3. Original sprite and scenery reconstruction, 3D effects and fallback models.
4. Lobby, deck builder, battle controls and local progression.
5. Desktop/phone playtesting, offline verification and CI.

This project is unofficial and is not affiliated with, endorsed, sponsored, or specifically approved by Supercell. Clash Royale artwork, audio and trademarks belong to Supercell. See `docs/ASSETS.md` for sources. Bundled artwork is not covered by any code license.
