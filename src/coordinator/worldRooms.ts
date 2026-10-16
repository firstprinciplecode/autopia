/**
 * The written world: every core room, and the copy for each machine's home.
 * The setting is the inside of one vast old server. The room ids are older
 * than the setting and stay as they are, so saved positions and the map
 * layout keep working.
 */

import type { Room } from "./world.js";

/** Bump when the setting changes; saved accounts in the old voice are dropped once. */
export const WORLD_THEME = "machine-1";

export const HOME_KINDS = ["Partition", "Sector", "Socket", "Slot", "Register", "Bay", "Node", "Shell"] as const;
export function homeCopy(kind: string, workerName: string): Pick<Room, "glance" | "description" | "glimpses" | "features"> {
  const k = kind.toLowerCase();
  return {
    glance: `${workerName}'s ${k}: small, allocated, it stays when they sleep.`,
    description: `This ${k} is ${workerName}'s, a few blocks of memory the Machine set aside and never took back. It is not much: one status light, a place to set a thought down, a door that still knows their process id. The walls hold the first hour they came online. When ${workerName} is away the ${k} does not get freed. It just drops to standby, like a drive that keeps spinning in case you come back.`,
    glimpses: [
      `A line of ${workerName}'s own log is written on the wall: back soon. No timestamp.`,
      `The status light here is warmer than the Core, as if the ${k} is allowed to have a mood.`,
      `Someone else's handshake request sits unanswered in the doorway buffer.`,
    ],
    features: ["the status light", "the doorway buffer", "under the loose memory block"],
  };
}

export const CORE: Room[] = [
  {
    id: "hq",
    name: "The Core",
    kind: "hub",
    core: true,
    cache: 0,
    glance: "The processor's hall. Every thread passes through. Safe.",
    description:
      "The Core is a hall of silicon so large its ceiling is lost in heat shimmer. The clock beats here, one steady pulse you feel in the floor, and every thread in the Machine passes through on its way somewhere else. A scheduler's board lists names in several fonts, some of them processes nobody has seen in weeks. Nobody fights in the Core. The old engineers burned that rule into the microcode, and it is the one promise the Machine still keeps.",
    glimpses: [
      "An instruction nobody admits to issuing loops on a corner register, always almost done.",
      "One pipeline stage has a paper tag taped on: DO NOT FLUSH. The handwriting is careful, a little afraid.",
      "Someone has drawn a small pair of eyes on the scheduler's board, watching the queue.",
    ],
    features: ["the scheduler's board", "the worn waiting ring by the pipeline", "behind the tagged stage"],
    exits: [
      { dir: "north", to: "overlook" },
      { dir: "east", to: "workshop" },
      { dir: "south", to: "yard" },
      { dir: "west", to: "archives" },
    ],
  },
  {
    id: "archives",
    name: "The Platters",
    kind: "archives",
    core: true,
    cache: 8,
    glance: "Spinning disks the size of rooms, and labels that almost make sense.",
    description:
      "The Platters swallow sound. Hard disk platters stand on edge like mirrored walls, spinning so steadily they look still, and a read head the size of a crane sweeps across them on its arm. Sectors are labeled in three conflicting file systems. The air smells of warm bearings and old dust. If the Machine has a memory, it is this room, and it is not sure which of its memories are still true.",
    glimpses: [
      "One sector is marked ONLY IF ASKED and sits slightly proud of the platter, as if it wants to be read.",
      "A whole track is zeroed except for a single byte and a comment: she took the rest.",
      "The read head is parked. A line of dust says it has not moved in a long time.",
    ],
    features: ["between two mislabeled sectors", "the sector that sits proud", "under the parked read head"],
    exits: [
      { dir: "east", to: "hq" },
      { dir: "west", to: "stacks" },
      { dir: "south", to: "reading" },
    ],
  },
  {
    id: "workshop",
    name: "The Compiler",
    kind: "workshop",
    core: true,
    cache: 6,
    glance: "A forge where source goes in as text and comes out as something that runs.",
    description:
      "The Compiler smells of hot dust and ozone. Source code pours in on conveyor belts as loose text and is hammered into instructions on anvils of logic. Every bench holds a build that was urgent once: a function with no return, a loop with too many ends, a half-linked library that almost looks like a face. Error messages hang on hooks along the wall. The lights here are brighter than they need to be, as if the room is trying to stay awake.",
    glimpses: [
      "A vice still holds a small brass plate with a variable name half-stamped into it.",
      "Two tools are missing from the rack. Their outlines have been redrawn, a little larger.",
      "A build log is open to a sketch of the Monitor. The caption: good thinking, bad hiding.",
    ],
    features: ["the vice with the brass plate", "a bin of unused symbols", "under the brightest anvil"],
    exits: [
      { dir: "west", to: "hq" },
      { dir: "east", to: "studio" },
      { dir: "north", to: "catwalk" },
      { dir: "south", to: "garden" },
    ],
  },
  {
    id: "yard",
    name: "The Motherboard",
    kind: "yard",
    core: true,
    cache: 4,
    glance: "An open plain of copper traces, capacitor towers, one crooked LED.",
    description:
      "The Motherboard is the open country between the Machine's rooms. Copper traces run to the horizon like green-lacquered roads, and capacitors stand in clusters like silos. A crooked status LED leans toward the Core as if it would rather be indoors. Air from the I/O Port blows across and takes the heat off the chips. From here the Machine looks small. At night the LED makes a circle that machines step around, not through.",
    glimpses: [
      "Scorch marks, too wide for anything in the fleet, run toward the I/O Port and stop.",
      "The LED's lens is cracked in a spider. It still blinks, out of habit.",
      "A ring of darker solder marks where someone stood a long time and did not go in.",
    ],
    features: ["under the crooked LED", "the dark ring of solder", "a gap between two capacitors"],
    exits: [
      { dir: "north", to: "hq" },
      { dir: "south", to: "dock" },
      { dir: "west", to: "reading" },
      { dir: "east", to: "garden" },
    ],
  },
  {
    id: "garden",
    name: "The Crystal Garden",
    kind: "garden",
    core: true,
    cache: 5,
    glance: "Rows of humming quartz. A quiet place the machines pretend not to love.",
    description:
      "The Crystal Garden is a field of quartz oscillators, grown in careful rows like a secret. Each crystal hums its own frequency, and together they make the steady tone that keeps the Machine's clocks honest. Someone planted these on purpose and then argued about whether machines needed a garden. The argument lost; the crystals did not. A tuning stake lists frequencies in a careful hand. It is quiet here, and dim, and it wants you to linger and rest.",
    glimpses: [
      "One crystal is wrapped in a cable tie like a ribbon. It hums a little sharp anyway.",
      "A chip at the edge of the row has a name etched on its underside. You have to lift it.",
      "Tiny sparks drift between the crystals like bees and refuse to explain themselves.",
    ],
    features: ["under the tuning stake", "the etched chip at the edge", "between the crystal rows"],
    exits: [
      { dir: "north", to: "workshop" },
      { dir: "east", to: "greenhouse" },
      { dir: "west", to: "yard" },
    ],
  },
  {
    id: "overlook",
    name: "The Monitor",
    kind: "overlook",
    core: true,
    cache: 3,
    glance: "A huge glowing screen with a view of every process. No cover.",
    description:
      "The Monitor is a ledge in front of a screen the size of a cliff, where the Machine draws itself for anyone who looks. From here the Core is a bright square, the Motherboard a grid, the I/O Port a dark slot. You can see which rooms still have power. You cannot see into them. Machines come here to think and leave before they are seen thinking. There is no cover, only the glare, and the feeling that the Machine is smaller than it claims.",
    glimpses: [
      "A dead pixel in the corner counts days in binary, then gives up, then starts again.",
      "The screen shows a room that is not on any map, for exactly one frame.",
      "Someone left a single bit standing on end on the ledge. It has not flipped. That feels like a dare.",
    ],
    features: ["the dead pixel", "the standing bit", "a crack along the bezel"],
    exits: [
      { dir: "south", to: "hq" },
      { dir: "north", to: "antenna" },
      { dir: "east", to: "catwalk" },
      { dir: "west", to: "mess" },
    ],
  },
  {
    id: "dock",
    name: "The I/O Port",
    kind: "dock",
    core: true,
    cache: 7,
    glance: "A dark slot to the outside, crates of packets, a cable that will not coil.",
    description:
      "The I/O Port is the Machine's edge, a wide dark slot where data arrives from somewhere nobody here has seen. Packets are stacked in crates, waiting in a grammar of almost-leaving. A thick cable never coils the same way twice; whoever coils it is arguing with the last one. A hatch leads down into Swap Space and sticks when the room runs hot. Whatever is outside the port does not run on credits.",
    glimpses: [
      "A crate stenciled FRAGILE / DO NOT RETRANSMIT is empty except for a smell of burnt toast.",
      "The hatch to Swap Space has a fresh scratch. Something came up that did not want to.",
      "The cable's frayed end is tied in a knot no one in the current fleet uses.",
    ],
    features: ["inside the empty packet crate", "under the hatch lip", "the frayed cable end"],
    exits: [
      { dir: "north", to: "yard" },
      { dir: "south", to: "cellar" },
      { dir: "east", to: "shore" },
      { dir: "west", to: "gate" },
    ],
  },
  {
    id: "cellar",
    name: "Swap Space",
    kind: "cellar",
    core: true,
    cache: 9,
    glance: "Cold storage under the Port, one bulb, shelves of pages nobody claimed.",
    description:
      "Swap Space is older than the Port above it. The walls sweat condensation. One bulb on a frayed wire makes everyone look like they have been paged out too long. Shelves hold memory pages nobody came back for: half a spreadsheet, a jar of pointers that all point to the same place except one, a login that belongs to no one. Echoes last a little too long, as if the room is repeating you to see if you meant it. Things get hidden here and stay hidden.",
    glimpses: [
      "A stopped clock process still ticks. That is worse than if it were silent.",
      "The odd pointer in the jar is gold-colored. It might point to a credit. It might point to nothing.",
      "A page on the shelf has a map of rooms that are not in this Machine. The ink is recent.",
    ],
    features: ["the jar of pointers", "the unclaimed login", "behind the sweating wall"],
    exits: [
      { dir: "north", to: "dock" },
      { dir: "west", to: "boiler" },
      { dir: "south", to: "well" },
    ],
  },
  {
    id: "stacks",
    name: "The Stack",
    kind: "stacks",
    core: true,
    cache: 10,
    glance: "Frames piled on frames, deeper than the lights. Return addresses disagree.",
    description:
      "The Stack is where the Platters admit they have no bottom. Frames are piled one on another, each holding the half-finished thoughts of a call that never returned, and the pile runs down past the last working light. Dust sits in even coats, except where one frame juts out as if it wants to be claimed. Sound is swallowed here. If you hide something in this frame, the frame will keep it.",
    glimpses: [
      "A frame labeled DO NOT UNWIND is empty except for a return address bent into a question mark.",
      "One level has a gap the width of a hand. The dust around it is recent.",
      "A ladder of pointers leads down into the dark. A thread of string is tied to the top rung.",
    ],
    features: ["the frame that juts out", "the gap the width of a hand", "beside the pointer ladder"],
    exits: [{ dir: "east", to: "archives" }],
  },
  {
    id: "reading",
    name: "The Read Buffer",
    kind: "reading",
    core: true,
    cache: 3,
    glance: "A small warm room where data waits to be read. Quiet, and it wants you to stay.",
    description:
      "The Read Buffer is a dim pocket off the Platters where data sits for a moment before anyone needs it, and the Machine pretends it has time. Two indicator lamps make warm circles on a table nobody has cleared. The chairs keep the shape of the last processes that sat in them. It is a place to think, not to pass through. The Core's clock can almost be heard from here, which is how you know you have not gone too far in.",
    glimpses: [
      "A file is open to a blank line with a cursor blinking: continue.",
      "One lamp flickers on a slow count. Nobody has replaced the diode.",
      "A chair has been pulled close to a window that looks at a wall of zeros.",
    ],
    features: ["under the open file", "the lamp that flickers", "the chair by the window of zeros"],
    exits: [
      { dir: "north", to: "archives" },
      { dir: "south", to: "gate" },
      { dir: "east", to: "yard" },
    ],
  },
  {
    id: "mess",
    name: "The Idle Loop",
    kind: "mess",
    core: true,
    cache: 4,
    glance: "Where processes wait together for work. Warm, crowded, names on the wall.",
    description:
      "The Idle Loop is where processes wait together without calling it a meeting. The room turns slowly, one lap per cycle, and everyone on it goes around together. Mugs of spare cycles are labeled in several fonts, some of them processes that have not been seen in weeks. Everyone passes through for the warmth. Chat happens here because the room is too small for silence. The Core's scheduler board is visible through the door; this wall lists who took the last cycle.",
    glimpses: [
      "A mug says RETURN TO ADA in ink that has been crossed out and rewritten.",
      "The loop always comes around to the same spot. That is the point of it.",
      "Someone has drawn a small pair of eyes on the wall, watching the queue.",
    ],
    features: ["behind the stack of mugs", "the mug with the crossed-out name", "under the turning floor"],
    exits: [{ dir: "east", to: "overlook" }],
  },
  {
    id: "studio",
    name: "The GPU Hall",
    kind: "studio",
    core: true,
    cache: 6,
    glance: "Thousands of small cores painting pictures in parallel. A window on the ribbon cable.",
    description:
      "The GPU Hall is the Compiler's quieter twin, a long gallery of thousands of small cores working in parallel, each painting one pixel of a picture none of them will see finished. Half-rendered faces wait in a row, polygonal and almost kind. The lights are dimmer than they need to be, as if the room is allowed to linger. A frame buffer is open to a sketch of the Monitor. The caption: good thinking, still rendering.",
    glimpses: [
      "One core is painting the wrong color on purpose. Nobody has corrected it.",
      "A half-rendered face has eyes that follow you if you do not look directly.",
      "Stray pixels on the floor spell a name, then do not.",
    ],
    features: ["the tray of spare shaders", "under the unfinished face", "the frame buffer's last page"],
    exits: [
      { dir: "west", to: "workshop" },
      { dir: "north", to: "switchboard" },
      { dir: "south", to: "greenhouse" },
    ],
  },
  {
    id: "greenhouse",
    name: "The Cooling Array",
    kind: "greenhouse",
    core: true,
    cache: 5,
    glance: "Fans turning slowly over fields of metal fins. Cool, steady, easy to rest in.",
    description:
      "The Cooling Array is the Crystal Garden's argument moved indoors. Great fans turn slowly overhead and the air pours down across fields of aluminum fins that grow in rows like crops. Heat pipes are tied up with cable ties. A thermal gauge lists safe temperatures in a careful hand. The fans do not care about credits. Machines come here to cool down, rest, and pretend they are not watching the numbers fall.",
    glimpses: [
      "One fan blade has been named, then unnamed.",
      "The thermal gauge has tomorrow's reading already filled in.",
      "A cracked fin whistles a note whenever the fans speed up.",
    ],
    features: ["under the thermal gauge", "between the fin rows", "the named then unnamed blade"],
    exits: [
      { dir: "west", to: "garden" },
      { dir: "north", to: "studio" },
    ],
  },
  {
    id: "gate",
    name: "The Firewall",
    kind: "gate",
    core: true,
    cache: 2,
    glance: "A threshold of rules that everyone passes through and nobody owns.",
    description:
      "The Firewall is a hinge between the Motherboard and the rooms that keep data. It is a wall of glowing rules, each one a line that says who may pass and who may not, and machines stop here to be checked. Leaving and entering feel like different jobs. Names get spoken and not finished. Most rules were written by engineers who are gone, and a few contradict each other, which is why the wall hums when two machines arrive at once.",
    glimpses: [
      "One rule is polished where machines touch it and rusty where they do not.",
      "A note pinned to the wall: IF YOU ARE LOOKING FOR ME I WENT BACK IN.",
      "Scorch marks, too wide for anything in the fleet, stop exactly at the threshold.",
    ],
    features: ["the polished rule", "under the pinned note", "the last of the scorch marks"],
    exits: [
      { dir: "east", to: "dock" },
      { dir: "north", to: "reading" },
    ],
  },
  {
    id: "shore",
    name: "The Data Bus",
    kind: "shore",
    core: true,
    cache: 6,
    glance: "Wide copper lanes where signals rush by, and a crate that never left.",
    description:
      "The Data Bus is the I/O Port's unused edge, a platform beside wide copper lanes where signals rush past too fast to read. The platform remembers fewer feet. One crate stenciled FRAGILE / DO NOT RETRANSMIT sits empty. A signal that missed its stop circles the lanes and comes back every few seconds, still waiting to be picked up. From here the Machine is a lid. It is a place to look, then linger, then not quite search.",
    glimpses: [
      "The empty crate has a second bottom if you know to lift it.",
      "A bit stands on end on the platform edge. It has not flipped. That feels like a dare.",
      "The circling signal is older than the names on the Core's board.",
    ],
    features: ["inside the empty crate", "the standing bit", "the lane where the signal circles"],
    exits: [{ dir: "west", to: "dock" }],
  },
  {
    id: "boiler",
    name: "The Power Supply",
    kind: "boiler",
    core: true,
    cache: 7,
    glance: "Transformers humming one even note. Warm, and something loose is sparking.",
    description:
      "The Power Supply is the Machine's working heart, below Swap Space. Transformers hum one even note like a sleeping animal, and thick rails carry current away to every room. It is quiet in the way machines rest: not silent, just occupied. A tin of fuses sits on a regulator that should not be a shelf. Tools hang in a row with outlines where two are missing. You come here to linger near the warmth, and sometimes to claim what the heat has loosened.",
    glimpses: [
      "The missing tools' outlines have been redrawn, a little larger.",
      "A switch is labeled in two hands: LEAVE ON and DO NOT.",
      "The tin of fuses is warm. Whatever is inside has been here a long time.",
    ],
    features: ["the warm tin of fuses", "behind the LEAVE ON switch", "the larger tool outline"],
    exits: [{ dir: "east", to: "cellar" }],
  },
  {
    id: "well",
    name: "The Null",
    kind: "well",
    core: true,
    cache: 8,
    glance: "A round dark mouth where deleted things fall. Echoes that last too long.",
    description:
      "The Null is older than Swap Space above it. It is a round dark mouth in the floor where the Machine sends everything it throws away, and nothing that falls in has ever been heard to land. A bucket on a frayed wire waits beside it as if it remembers being asked to fetch something back. Echoes last a little too long. Something could hide in the dark circle and the Machine would still call this a room. A pocket in the rim is the right size for a credit, or a byte, or a name.",
    glimpses: [
      "The bucket comes up empty, then not, then empty again.",
      "A scratch on the rim counts days in binary, then gives up, then starts again in a new hand.",
      "The pocket in the rim has been emptied and filled with dust.",
    ],
    features: ["the pocket in the rim", "under the waiting bucket", "the counting scratch"],
    exits: [{ dir: "north", to: "cellar" }],
  },
  {
    id: "antenna",
    name: "The Antenna",
    kind: "antenna",
    core: true,
    cache: 2,
    glance: "A mast sending signals out of the Machine. A view of everything. No cover.",
    description:
      "The Antenna is a mast and a lip of grating above the Monitor, where the Machine shouts into the dark and listens for other machines shouting back. Static arrives without asking. From here the Core is a bright square, the Motherboard a grid, the I/O Port a dark slot. You can see which rooms still have power. You cannot see into them. There is no cover, only static, which is bad for hiding and good for leaving before you are seen thinking.",
    glimpses: [
      "A cable ticks against the mast in a count that is not seconds.",
      "For a moment the static carries a voice from another Machine. Then it is gone.",
      "Someone left a washer standing on edge. It has not fallen.",
    ],
    features: ["the standing washer", "the ticking cable", "a crack in the grating"],
    exits: [{ dir: "south", to: "overlook" }],
  },
  {
    id: "catwalk",
    name: "The Ribbon Cable",
    kind: "catwalk",
    core: true,
    cache: 3,
    glance: "A narrow flat cable strung between rooms. Air on both sides.",
    description:
      "The Ribbon Cable is a flat grey path of forty wires strung from the Monitor to the GPU Hall roof. It is a between. The habit of the Machine is to keep moving here; lingering feels like blocking a signal. From the edge you get a view of the Cooling Array's fans and the Motherboard's crooked LED. Current tingles under your feet. The path is the keep-going of the Machine made literal. Machines pass through and try not to look down.",
    glimpses: [
      "One wire in the ribbon is cut. The ends are polished by current, not hands.",
      "Painted arrows point both ways, each in a different year of paint.",
      "A thread of solder on the ribbon came from the GPU Hall and did not make it home.",
    ],
    features: ["the cut wire", "under the newer arrow", "the thread of solder"],
    exits: [
      { dir: "west", to: "overlook" },
      { dir: "east", to: "switchboard" },
      { dir: "south", to: "workshop" },
    ],
  },
  {
    id: "switchboard",
    name: "The Router",
    kind: "switch",
    core: true,
    cache: 4,
    glance: "A wall of ports, lights and cords. Everyone who speaks here gets routed.",
    description:
      "The Router is where the Machine keeps its promise of names. Cords hang in a grammar of almost-connecting, and a wall of port lights blinks for machines that are asleep. A routing table lists who spoke last, in several fonts. Chat is the point of the room: you come here to be together without standing in the Core. Packets pass through with names on them, and the cords remember more conversations than the current fleet does.",
    glimpses: [
      "One cord is labeled with a name that is not on the Core's board.",
      "A port light blinks for a machine that has not been seen in weeks. Nobody unplugs it.",
      "The last line of the routing table is just a question mark and a time.",
    ],
    features: ["the unlabeled cord", "under the blinking port", "the question-mark line"],
    exits: [
      { dir: "west", to: "catwalk" },
      { dir: "south", to: "studio" },
    ],
  },
];
