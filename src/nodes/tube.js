import { rect, rule } from "../ops.js";

// The tube's model and drawing, without React — so an importer can lay tubes
// out, and a headless renderer can draw them, without loading the component.
//
// What a tube is FOR: on a sequence diagram it is an activation bar riding a
// lifeline. The lifeline is an edge, the tube rides it at a fraction `t` (see
// edges/attach.js and TubeFollower.jsx), and messages run tap to tap between
// tubes. Everything below is in service of that reading.

export const TUBE_TYPE = "tube";

// Thickness × length. Vertical is the natural pose, so length is the height.
export const TUBE_SIZE = [26, 220];

// A track is a tube that draws nothing. The importer rides one along each
// lifeline from end to end to carry the taps for messages that land outside
// every activation: the lifeline edge already draws the line, and a bar there
// would read as "active the whole time".
export const TRACK = "track";
export const isTrack = (data) => data?.variant === TRACK;

const DEFAULT_SLOTS = 3;
const MIN_SLOTS = 1;
const MAX_SLOTS = 32;

export const slotCount = (data) =>
  Math.min(
    MAX_SLOTS,
    Math.max(MIN_SLOTS, Math.round(data?.slots ?? DEFAULT_SLOTS)),
  );

// Slot i's position along the tube, as a fraction of its length. Centred in its
// share rather than spread end to end, so the first and last taps sit clear of
// the caps instead of on top of them.
export const slotAt = (i, n) => (i + 0.5) / n;

// Two ways to say where the taps are. `slots` spreads them evenly, which is all
// a tube drawn by hand needs. `taps` pins each one at a distance from the head,
// in px — what an importer lays down, so that both ends of a message share one
// y however unevenly the rows fall. When `taps` is present it wins, even empty:
// an activation no message touches has no taps, not three.
export const hasTaps = (data) => Array.isArray(data?.taps);

export const tapCount = (data) =>
  hasTaps(data) ? data.taps.length : slotCount(data);

/** Each tap's distance from the head, in px, on a tube `h` long. */
export const tapOffsets = (data, h) => {
  if (hasTaps(data)) return data.taps;
  const n = slotCount(data);
  return Array.from({ length: n }, (_, i) => slotAt(i, n) * h);
};

// CSS `top` for tap i's handles. A percentage for slots, so they track a resize
// exactly as the tick marks do; px for pinned taps, which stay where the rows
// are.
export const tapTop = (data, i) =>
  hasTaps(data)
    ? `${data.taps[i]}px`
    : `${slotAt(i, slotCount(data)) * 100}%`;

/**
 * One tap more or fewer. Slots just change count. A pinned tap is added halfway
 * between the last tap and the tail — the open stretch a new message would go
 * to — and removed from the end, which is the newest.
 */
export function stepTaps(data, delta, h) {
  if (!hasTaps(data)) return { ...data, slots: slotCount(data) + delta };

  const taps = [...data.taps];
  if (delta > 0) {
    const last = taps.length ? taps[taps.length - 1] : 0;
    taps.push(Math.round(last + (h - last) / 2));
  } else {
    taps.pop();
  }
  return { ...data, taps };
}

// The tick marks and the handles both come from tapOffsets, so a tap can never
// drift away from the mark drawn under it.
export const drawTube = (w, h, data) =>
  isTrack(data)
    ? []
    : [
        rect(1, 1, w - 2, h - 2, {
          rx: Math.min(w / 2 - 1, h / 2 - 1),
          fill: "node.shade",
        }),
        ...tapOffsets(data, h).map((y) => rule(3, y, w - 3, y)),
      ];
