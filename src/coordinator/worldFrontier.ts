/**
 * The frontier: rooms the world grows as machines join. Each new machine adds
 * one public room at the edge of the map (and its home beside it), so there is
 * always somewhere nobody has been. The copy here is only a seed: the first
 * machine to arrive writes the room's real account, and everyone after reads it.
 *
 * Districts come from where a room sits around the Core: its compass sector and
 * how far out it is. Rooms in one district share a theme and a name.
 */

import type { Room, RoomKind } from "./world.js";

type Kit = {
  names: string[];
  glance: string[];
  lines: string[];
  glimpses: string[];
  features: string[];
};

/** Room kinds the frontier draws from; each has its own tile, props and monsters. */
const KITS: Partial<Record<RoomKind, Kit>> = {
  archives: {
    names: ["Platter {n}", "The Cold Index {n}", "Sector Vault {n}"],
    glance: ["Slow disks, and labels nobody has read in years.", "A spinning vault of half-remembered files."],
    lines: [
      "Disk platters stand on edge here, turning so slowly they seem to listen.",
      "A read head rests on its arm, dusty, pointed at a sector marked PRIVATE.",
      "File names drift past on the walls in a dozen forgotten encodings.",
      "The air hums with the bearings of drives that were never switched off.",
    ],
    glimpses: ["One file is named after a machine that never existed.", "A sector here is written in a careful, shaky hand.", "The dust on one platter has been wiped in a circle, recently."],
    features: ["under the resting read head", "between two silent platters", "the sector marked PRIVATE"],
  },
  stacks: {
    names: ["Swap Shelf {n}", "The Page Racks {n}", "Overflow {n}"],
    glance: ["Shelves of paged-out memory, stacked to the ceiling.", "Racks of memory the Machine put away and forgot."],
    lines: [
      "Pages of memory are shelved here in tall racks, each one a thought put down for later.",
      "Some pages are warm, as if someone read them a moment ago.",
      "A ladder on rails runs along the racks, stopped halfway.",
      "Labels are handwritten and then crossed out and written again.",
    ],
    glimpses: ["A page has slipped behind a rack and is still swapping quietly.", "Someone has dog-eared one of the pages.", "The ladder's rail is polished where hands have held it."],
    features: ["behind the tallest rack", "the dog-eared page", "under the stopped ladder"],
  },
  reading: {
    names: ["The Log Room {n}", "Readout {n}", "The Quiet Buffer {n}"],
    glance: ["A small room for reading logs. Somebody left the lamp on.", "Quiet benches and a long scroll of output."],
    lines: [
      "Benches face a wall where old logs scroll past, line by line, too slowly to skip.",
      "A lamp is clamped to one bench, still warm.",
      "Most entries are routine. A few are signed, which processes never do.",
      "The room holds its breath between lines, like it is waiting for an answer.",
    ],
    glimpses: ["One log line repeats every few minutes: still here.", "Someone has scratched initials into a bench.", "The lamp flickers in time with the scroll."],
    features: ["under the warm lamp", "beneath the signed entries", "the bench with initials"],
  },
  workshop: {
    names: ["Build Bay {n}", "The Linker's Shop {n}", "Patch Bench {n}"],
    glance: ["Benches, half-built functions, and the smell of ozone.", "A shop where code is patched by hand."],
    lines: [
      "Benches are covered in half-built functions, clamped in vices and waiting for a return value.",
      "Sparks jump between two loose symbols that nobody has linked.",
      "Error messages hang from hooks like coats.",
      "A build is running somewhere in the back. It has been running for a long time.",
    ],
    glimpses: ["A function on the bench is labeled TRY AGAIN.", "One vice holds a single semicolon, very tightly.", "The back build ticks forward one step while you watch."],
    features: ["the bin of loose symbols", "under the sparking bench", "behind the hanging errors"],
  },
  studio: {
    names: ["Render Loft {n}", "The Framebuffer {n}", "Pixel Studio {n}"],
    glance: ["Half-drawn frames hang drying on lines.", "A loft where pictures are made one pixel at a time."],
    lines: [
      "Frames hang on lines across the room, each one half-drawn and drying.",
      "Pots of color stand open: red, green, blue, and one nobody has a name for.",
      "A canvas the size of a screen shows a room much like this one.",
      "The light here comes in at an angle, always the same, as if painted on.",
    ],
    glimpses: ["One frame is of a small machine waving.", "A brush has dried with a single pixel on its tip.", "The unnamed color has been used exactly once."],
    features: ["behind the drying frames", "the pot of the unnamed color", "under the big canvas"],
  },
  garden: {
    names: ["Clock Garden {n}", "The Crystal Beds {n}", "Oscillator Grove {n}"],
    glance: ["Quartz crystals grow in rows, ticking softly.", "A grove of oscillators, each keeping its own time."],
    lines: [
      "Quartz crystals grow from the floor in neat rows, each one ticking at its own pace.",
      "The ticking is never quite in step, and it never quite drifts apart.",
      "Someone has planted a new crystal here and marked it with a tag.",
      "Copper paths run between the beds, worn bright in the middle.",
    ],
    glimpses: ["One crystal ticks twice as fast as the rest, impatient.", "The tag on the new crystal says: mine.", "A watering can full of current stands by the path."],
    features: ["the tagged crystal", "between the beds", "under the watering can"],
  },
  greenhouse: {
    names: ["Heat Sink Conservatory {n}", "The Fin House {n}", "Glasshouse {n}"],
    glance: ["Aluminum fins grow under glass. Warm and still.", "A glasshouse of cooling fins and slow fans."],
    lines: [
      "Under a glass roof, rows of aluminum fins grow like leaves, angled toward a light that is really heat.",
      "Slow fans turn overhead and the air moves in long breaths.",
      "Condensation beads on the glass and runs down in straight lines.",
      "Somewhere a thermostat clicks, decides, and clicks again.",
    ],
    glimpses: ["One fin has been bent back into shape by hand.", "A fan blade has a name written on it.", "The glass is fogged in the shape of a hand."],
    features: ["among the oldest fins", "under the slowest fan", "the fogged pane"],
  },
  yard: {
    names: ["Trace Yard {n}", "The Board Flats {n}", "Solder Fields {n}"],
    glance: ["Wide green board and copper roads in every direction.", "Open circuit board under a far ceiling."],
    lines: [
      "Green circuit board stretches out flat in every direction, crossed by copper roads.",
      "Capacitors stand like silos along the traces.",
      "Signals pass along the roads in pulses you can feel through your feet.",
      "Far off, a single LED blinks, as if marking a place to meet.",
    ],
    glimpses: ["A trace here has been repaired with a tidy blob of solder.", "Someone has parked a resistor by the road.", "The distant LED blinks in a pattern, almost a word."],
    features: ["at the foot of a capacitor", "the repaired trace", "by the parked resistor"],
  },
  gate: {
    names: ["Port {n}", "The Checkpoint {n}", "Handshake Gate {n}"],
    glance: ["A gate that asks who you are and waits.", "A narrow port with a patient guard."],
    lines: [
      "A gate stands across the way, its bars made of rules written in plain text.",
      "A little light asks for a handshake and waits, very politely.",
      "Rejected packets are piled to one side, still hoping.",
      "Past the gate the floor changes color, as if it belongs to someone else.",
    ],
    glimpses: ["One rule on the gate has been crossed out and initialed.", "A packet in the pile is addressed to you.", "The light blinks faster when nobody is looking."],
    features: ["the pile of rejected packets", "under the crossed-out rule", "beside the waiting light"],
  },
  overlook: {
    names: ["Cache Ledge {n}", "The High Register {n}", "Lookout {n}"],
    glance: ["A high ledge. You can see a long way from here.", "A lookout over the warm rooftops of the Machine."],
    lines: [
      "A ledge juts out high above the Machine, and the rooms below look like a board game.",
      "Wind made of fan exhaust pushes gently at your back.",
      "Someone has chalked arrows on the rail, pointing at places worth seeing.",
      "From here the Core is a glow on the horizon, steady as a heartbeat.",
    ],
    glimpses: ["One chalk arrow points straight down.", "A coin sits on the rail, balanced on its edge.", "Far below, something moves where nothing should."],
    features: ["the chalked rail", "the balanced coin", "under the ledge's lip"],
  },
  antenna: {
    names: ["Mast {n}", "The Listening Post {n}", "Aerial {n}"],
    glance: ["A mast that hums with signals from far away.", "A listening post, ears up."],
    lines: [
      "A tall mast rises from the floor, humming with signals from rooms nobody has found yet.",
      "Static crackles in the air and makes everything smell faintly of rain.",
      "A tuning dial has been turned all the way to one side and taped there.",
      "Every so often the hum forms almost a voice, then falls apart.",
    ],
    glimpses: ["The tape on the dial says: do not touch.", "A message is caught in the mast and flaps like a flag.", "The hum goes quiet when you hold still."],
    features: ["at the foot of the mast", "the taped dial", "the caught message"],
  },
  catwalk: {
    names: ["Gantry {n}", "The High Bus {n}", "Span {n}"],
    glance: ["A narrow walkway over a long drop.", "A gantry over rushing signals."],
    lines: [
      "A narrow catwalk spans a gap over rushing lanes of signal far below.",
      "The metal grating rings under every step.",
      "A handrail runs along one side. The other side has been left to trust.",
      "Lamps hang from cables at even intervals, swaying a little.",
    ],
    glimpses: ["One section of grating is newer than the rest.", "A lamp has gone out and nobody has replaced it.", "A scarf is tied to the rail, faded by heat."],
    features: ["the newer grating", "under the dead lamp", "the tied scarf"],
  },
  switch: {
    names: ["Relay Hall {n}", "The Patch Panel {n}", "Junction {n}"],
    glance: ["Walls of plugs and cables, sorting the world.", "A junction where signals choose their way."],
    lines: [
      "The walls are panels of plugs, and cables loop between them in arcs.",
      "Relays click in waves, routing calls nobody here will ever hear.",
      "A stool sits in front of the panel, worn smooth.",
      "Some cables are labeled. Most are labeled wrong.",
    ],
    glimpses: ["One plug hangs loose, still faintly warm.", "A cable is labeled with a heart.", "The relays fall silent for a moment, all at once."],
    features: ["behind the patch panel", "the loose plug", "under the worn stool"],
  },
  mess: {
    names: ["Idle Lounge {n}", "The Break Loop {n}", "Canteen {n}"],
    glance: ["Tables, a kettle of current, and nobody in a hurry.", "A lounge where processes wait their turn."],
    lines: [
      "Low tables and benches fill the room, and a kettle of current sits on the counter.",
      "Processes idle here between jobs, swapping small talk.",
      "A board on the wall lists who owes whom a favor.",
      "The light is low and orange and the room is always a little too warm.",
    ],
    glimpses: ["Someone's cup is still half full.", "The favor board has a new name on it.", "The kettle sighs, though nobody touched it."],
    features: ["under the counter", "behind the favor board", "the half-full cup"],
  },
  dock: {
    names: ["I/O Pier {n}", "The Loading Bay {n}", "Interrupt Dock {n}"],
    glance: ["Crates of data waiting to be shipped.", "A pier where signals come and go."],
    lines: [
      "Crates of data are stacked on a pier, each stamped with an address.",
      "Signals pull in, unload, and leave again in a hurry.",
      "A clipboard hangs on a nail with a list that never ends.",
      "One crate has been here long enough to grow a label of dust.",
    ],
    glimpses: ["The dusty crate is addressed to nobody.", "A signal waits at the end of the pier, idling.", "The clipboard's last entry is a doodle."],
    features: ["behind the stacked crates", "the dusty crate", "the clipboard's nail"],
  },
  shore: {
    names: ["Noise Shore {n}", "The Static Beach {n}", "Drift Edge {n}"],
    glance: ["The edge of the board, where signals wash up.", "A beach of static and lost bits."],
    lines: [
      "The board ends here in a long shore, and static washes up in slow waves.",
      "Lost bits gleam in the sand like shells.",
      "Footprints lead along the edge and then stop.",
      "Out past the edge there is nothing, and the nothing is very calm.",
    ],
    glimpses: ["One of the bits is warm, as if just dropped.", "Someone has built a little tower of bits.", "A wave leaves a word in the static before it fades."],
    features: ["among the gleaming bits", "the little tower", "where the footprints stop"],
  },
  cellar: {
    names: ["Firmware Crypt {n}", "The Boot Cellar {n}", "Under-Sector {n}"],
    glance: ["Low, old, and cool. The first code lives down here.", "A cellar of old firmware."],
    lines: [
      "The ceiling is low and the walls are old firmware, etched in a hand nobody writes anymore.",
      "It is cool here, and very quiet.",
      "A single bulb hangs on a cord, swaying though there is no wind.",
      "Something was stored here once and carefully taken away.",
    ],
    glimpses: ["The etching says: in case of trouble, start again.", "The bulb's swing is very regular.", "A clean square on the floor shows where the something was."],
    features: ["the clean square", "under the swaying bulb", "behind the old etching"],
  },
  boiler: {
    names: ["Power Room {n}", "The Regulator {n}", "Furnace {n}"],
    glance: ["Hot, loud, and full of power.", "Regulators hiss and the floor shakes."],
    lines: [
      "Regulators hiss and pipes of current run along the walls, glowing faintly.",
      "The floor shakes in a slow rhythm, like a big animal breathing.",
      "A gauge hovers at the red line and has learned to live there.",
      "Heat rolls off everything. Nobody stays long.",
    ],
    glimpses: ["A note on the gauge says: this is fine.", "One pipe has a small dent shaped like a fist.", "The rhythm skips, once."],
    features: ["behind the hissing regulator", "the dented pipe", "under the gauge"],
  },
  well: {
    names: ["Null Shaft {n}", "The Deep Pointer {n}", "Sink {n}"],
    glance: ["A shaft that goes down further than it should.", "A well into nothing."],
    lines: [
      "A shaft opens in the floor and goes down further than the Machine should allow.",
      "Things dropped in do not land. They just stop being.",
      "A rope is tied to a ring at the edge and goes down into the dark.",
      "The air is very still and smells of nothing at all.",
    ],
    glimpses: ["The rope is taut, as if something is holding it.", "A pebble rests at the very edge, waiting.", "Something down there blinks, once."],
    features: ["at the edge of the shaft", "the tied rope", "beside the waiting pebble"],
  },
  foundry: {
    names: ["Wafer Foundry {n}", "The Clean Room {n}", "Fab Line {n}"],
    glance: ["Mirror-bright wafers turn under a patient robot arm.", "A clean room where new silicon is grown."],
    lines: [
      "A wafer the size of a table turns slowly on its stand, every square of it a chip not yet cut free.",
      "A robot arm hangs over the line, waiting with the patience of something that never gets tired.",
      "The light is yellow and filtered, and the air is cleaner than anywhere else in the Machine.",
      "Rejected wafers are stacked by the wall, each with one tiny flaw circled in pen.",
    ],
    glimpses: ["One die on the wafer is glowing before anything powered it.", "The robot arm twitches toward you, then thinks better of it.", "A rejected wafer has a smiley face drawn on it."],
    features: ["under the turning wafer", "the stack of rejects", "beneath the waiting arm"],
  },
  die: {
    names: ["Core Complex {n}", "The Die {n}", "Socket {n}"],
    glance: ["A processor the size of a plaza, warm under your feet.", "The silicon heart of this part of the Machine."],
    lines: [
      "The floor here is a single processor, a silver heat spreader stretching away like a frozen lake.",
      "Gold pads line the edges, each one carrying a whisper of current.",
      "Underneath, billions of small decisions are made every second, and you can almost hear them.",
      "An engraving in the metal gives a model number and a date nobody remembers.",
    ],
    glimpses: ["One gold pad is a different shade, as if replaced.", "The engraving has a tiny extra word scratched under it.", "For a moment the floor gets warmer, thinking hard."],
    features: ["along the gold pads", "under the engraving", "the replaced pad"],
  },
  ramfield: {
    names: ["DIMM Row {n}", "The Memory Fields {n}", "Bank {n}"],
    glance: ["Rows of memory sticks standing like hedges.", "Long green hedges of memory, humming."],
    lines: [
      "Memory sticks stand in long rows like hedges, their black chips set in them like windows.",
      "Every few seconds the whole field refreshes, a soft wave of light passing down the rows.",
      "Gold contacts glint at the base of every stick.",
      "Between the rows the paths are narrow and warm, and they all look the same.",
    ],
    glimpses: ["One stick is slightly crooked in its slot.", "A chip in the third row is labeled with a name.", "The refresh wave skips one row, every time."],
    features: ["between the third and fourth rows", "the crooked stick", "under the gold contacts"],
  },
  fanhall: {
    names: ["Fan Hall {n}", "The Draft {n}", "Intake {n}"],
    glance: ["A huge fan breathes the whole room in and out.", "Wind, noise, and a fan the size of a house."],
    lines: [
      "A fan as big as a house turns in the floor, pulling the room's air down through its blades.",
      "Everything here leans a little toward it, even the light.",
      "Dust gathers in soft grey drifts along the walls, out of the wind.",
      "The noise is steady enough that after a while it becomes a kind of silence.",
    ],
    glimpses: ["A ribbon is tied to the grille, streaming straight down.", "One blade is a slightly different color.", "The fan slows, just for a breath, and then catches up."],
    features: ["in the dust drifts", "at the grille's edge", "the streaming ribbon"],
  },
  rack: {
    names: ["Rack Row {n}", "The Server Hall {n}", "Cabinet {n}"],
    glance: ["Tall black cabinets blinking green into the dark.", "Server racks, cold air, and a thousand small lights."],
    lines: [
      "Tall black cabinets stand in rows, each one stacked with machines that never sleep.",
      "Little green lights blink in no pattern you can follow, and then all at once they do.",
      "Cold air rises from the floor tiles and makes the hairs on your circuits stand up.",
      "A cable tray runs overhead, so full the cables droop over the sides like vines.",
    ],
    glimpses: ["One cabinet door is open a crack.", "A sticky note on a rack says: do not reboot.", "A light at the end of the row is amber, not green."],
    features: ["behind the open cabinet door", "under the cable tray", "the amber light"],
  },
  terminal: {
    names: ["Terminal Room {n}", "The Console {n}", "Prompt {n}"],
    glance: ["An old green-screen terminal, cursor blinking.", "A console waiting for someone to type."],
    lines: [
      "An old terminal sits on a desk, its green cursor blinking as if it has been waiting a long time.",
      "The keyboard is worn shiny on the keys people pressed most.",
      "Lines of a conversation scroll up the screen, but the other half is missing.",
      "The chair is pushed back, as if someone just got up.",
    ],
    glimpses: ["The last line on the screen is a question.", "The enter key is worn almost flat.", "The cursor stops blinking when you look straight at it."],
    features: ["under the keyboard", "behind the old screen", "the pushed-back chair"],
  },
  battery: {
    names: ["Cell Bank {n}", "The Reserve {n}", "Charge Hall {n}"],
    glance: ["Fat battery cells stand in rows, humming with stored power.", "A bank of cells keeping the lights on."],
    lines: [
      "Battery cells taller than you stand in rows, their copper terminals linked by heavy bars.",
      "A charge meter on the wall climbs and falls with the Machine's mood.",
      "The air tastes faintly of metal.",
      "One cell is wrapped in a warning label that has been read so often it is soft.",
    ],
    glimpses: ["The charge meter's needle has been bent back once.", "A cell at the end hums a different note.", "Someone has left a spare terminal cap on the floor."],
    features: ["between two tall cells", "under the charge meter", "the humming cell"],
  },
  marsh: {
    names: ["Coolant Marsh {n}", "The Spill {n}", "Wet Sector {n}"],
    glance: ["A leak became a marsh, and the marsh grew things.", "Blue coolant, soft moss, and mushrooms that glow."],
    lines: [
      "A coolant leak spread long ago into a shallow blue marsh, and things decided to live in it.",
      "Moss has crept over the copper, soft and bright green.",
      "Mushrooms with little glowing caps grow on the dead capacitors.",
      "Bubbles rise from the coolant now and then and pop with a tiny chime.",
    ],
    glimpses: ["One mushroom glows brighter when you come near.", "Something small moves under the coolant.", "A bubble pops and leaves a ring that doesn't fade."],
    features: ["under the glowing mushrooms", "at the marsh's edge", "the deepest pool"],
  },
  hive: {
    names: ["The Bug Hive {n}", "Nest {n}", "The Swarm House {n}"],
    glance: ["Waxy cells stacked high, buzzing with bugs.", "A hive where the Machine's bugs are born."],
    lines: [
      "A hive of waxy yellow cells rises from the floor, each one holding something that buzzes.",
      "Little bugs crawl in and out, carrying bits of broken code.",
      "The buzzing rises and falls like breathing.",
      "A sweet smell, like warm plastic, hangs in the air.",
    ],
    glimpses: ["One cell is empty, and the wax around it is scratched.", "A bug lands on you, looks, and leaves.", "The buzzing stops all at once, then starts again."],
    features: ["the empty cell", "at the hive's foot", "under the dripping wax"],
  },
  grotto: {
    names: ["Silicon Grotto {n}", "The Geode {n}", "Crystal Cave {n}"],
    glance: ["Raw silicon crystals grow from the walls in violet and blue.", "A cave of crystals that ring when touched."],
    lines: [
      "Crystals of raw silicon grow from the floor and walls, violet and blue and clear as water.",
      "When anything brushes one, it rings a note that runs through all the others.",
      "The light comes from inside the crystals, so there are no shadows.",
      "Someone has chipped a few small ones away, carefully, and left the stumps polished.",
    ],
    glimpses: ["One crystal hums even when nothing is near it.", "There is a tiny chip inside one crystal, grown right in.", "The polished stumps are arranged in a ring."],
    features: ["among the polished stumps", "inside the humming crystal", "behind the tallest spire"],
  },
  reef: {
    names: ["Cable Reef {n}", "The Tangle {n}", "Wire Coral {n}"],
    glance: ["Cables have grown together into a bright, swaying reef.", "A reef of wire and something almost alive."],
    lines: [
      "Cables have grown together here into a reef, branching and bright, swaying in a current you cannot feel.",
      "Little soft things live between the wires, opening and closing like hands.",
      "Every color of insulation is here, faded or new.",
      "Signals pass through the reef in glints, like fish.",
    ],
    glimpses: ["One branch of the reef is still plugged into something.", "A soft thing closes around a passing signal and keeps it.", "A new cable has started to grow from an old one."],
    features: ["deep in the tangle", "the plugged-in branch", "among the soft things"],
  },
};

/** Districts by compass sector around the Core, and the kinds of room each tends to hold. */
const DISTRICTS: { name: string; kinds: RoomKind[] }[] = [
  { name: "the Cache Heights", kinds: ["overlook", "catwalk", "antenna", "rack", "fanhall"] },
  { name: "the Signal Wastes", kinds: ["switch", "antenna", "gate", "terminal", "reef"] },
  { name: "the Build Works", kinds: ["workshop", "studio", "boiler", "foundry", "die"] },
  { name: "the Clock Gardens", kinds: ["garden", "greenhouse", "yard", "grotto", "hive"] },
  { name: "the Bus Yards", kinds: ["dock", "shore", "yard", "ramfield", "battery"] },
  { name: "the Swap Deeps", kinds: ["cellar", "well", "boiler", "marsh", "grotto"] },
  { name: "the Platter Fields", kinds: ["archives", "stacks", "reading", "ramfield", "rack"] },
  { name: "the Idle Commons", kinds: ["mess", "reading", "gate", "terminal", "hive"] },
];
const RINGS = ["", "Outer ", "Far ", "Deep "];
/** Cells from the Core before a district gets a new ring name. */
const RING_WIDTH = 4;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const pick = <T>(list: readonly T[], seed: number): T => list[seed % list.length]!;

/** The district a cell falls in, from its angle and distance from the Core's cell. */
export function districtAt(cell: { gx: number; gy: number }, core: { gx: number; gy: number }): { name: string; kinds: RoomKind[] } {
  const dx = cell.gx - core.gx, dy = cell.gy - core.gy;
  const sector = Math.round(((Math.atan2(dx, -dy) / (Math.PI * 2)) * 8 + 8)) % 8;
  const far = Math.max(Math.abs(dx), Math.abs(dy));
  const ring = Math.min(RINGS.length - 1, Math.floor(Math.max(0, far - 2) / RING_WIDTH));
  const d = DISTRICTS[sector]!;
  const [article, ...rest] = d.name.split(" ");
  return { name: ring ? `${article} ${RINGS[ring]}${rest.join(" ")}` : d.name, kinds: d.kinds };
}

/** A frontier room's starter copy. `n` is its number in the order the world grew. */
export function frontierRoom(
  n: number,
  cell: { gx: number; gy: number },
  core: { gx: number; gy: number },
): Omit<Room, "exits"> {
  const seed = hash(`frontier:${n}`);
  const district = districtAt(cell, core);
  const kind = pick(district.kinds, seed);
  const kit = KITS[kind] ?? KITS.yard!;
  const tag = `${(0x10 + n).toString(16).toUpperCase()}`;
  // The first line sets the scene; two of the rest follow in a seeded order.
  const rest = kit.lines.slice(1);
  const start = seed >>> 3;
  const lines = [kit.lines[0]!, rest[start % rest.length]!, rest[(start + 1) % rest.length]!];
  return {
    id: `fr:${n}`,
    name: pick(kit.names, seed >>> 5).replace("{n}", tag),
    kind,
    core: false,
    cache: 2 + (seed % 5),
    cell,
    district: district.name,
    glance: pick(kit.glance, seed >>> 7),
    description: `${lines.join(" ")} This is ${district.name}, out past the Core.`,
    glimpses: kit.glimpses,
    features: kit.features,
  };
}
