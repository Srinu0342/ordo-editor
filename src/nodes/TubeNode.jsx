import { Fragment, useCallback, useEffect, useMemo, useRef } from "react";
import {
  Handle,
  NodeResizer,
  NodeToolbar,
  Position,
  useReactFlow,
  useUpdateNodeInternals,
} from "@xyflow/react";
import { rect, rule } from "../ops.js";
import { walk } from "../render/reactWalker.jsx";
import { nodeTheme } from "./chrome.jsx";

// The tube: a length of timeline with as many tap-off points as you want.
//
// Two things make it unlike every other node here. It carries no label — the
// tube is a track, and the meaning lives on whatever connects to it — and its
// handle count is DATA, not geometry baked into a component. `slots` is the
// single number both the tick marks and the handles derive from, so a tap can
// never drift away from the mark drawn under it.
//
// Its third difference lives outside this file: `data.attach` lets it ride an
// edge. See edges/attach.js for the geometry and TubeFollower.jsx for the
// per-frame commit.
//
// ORIENTATION. The tube is drawn vertically — long axis down the Y of its own
// box — and turned from there. That natural box is what React Flow measures,
// resizes and hit-tests; `rotation` only ever reaches the CSS transform. The
// alternative, rotating the node's real box, would mean every measurement in
// the editor had to learn about tilt.
//
// `rotation` is an angle in the tube's FRAME, and a rider's frame is its edge:
// 0 means along the edge when attached, and straight down the canvas when not.
// So a tube rotated 90° sits across whatever it is on, and stays across it
// through a reroute.

export const TUBE_TYPE = "tube";

// Thickness × length. Vertical is the natural pose, so length is the height.
export const TUBE_SIZE = [26, 220];

const DEFAULT_SLOTS = 3;
const MIN_SLOTS = 1;
const MAX_SLOTS = 32;

// Rotating the long axis onto the tangent: CSS rotate(A) sends the tube's own
// +Y down the direction (−sin A, cos A), which lines up with a tangent of θ at
// A = θ − 90.
const ALONG = -90;

const SNAP_STEP = 15;

export const slotCount = (data) =>
  Math.min(
    MAX_SLOTS,
    Math.max(MIN_SLOTS, Math.round(data?.slots ?? DEFAULT_SLOTS)),
  );

// Slot i's position along the tube, as a fraction of its length. Centred in its
// share rather than spread end to end, so the first and last taps sit clear of
// the caps instead of on top of them.
export const slotAt = (i, n) => (i + 0.5) / n;

// Degrees, folded into (−180, 180]. Keeps a grip dragged round and round from
// accumulating a turn count nobody asked for.
const norm = (deg) => {
  const d = (((deg + 180) % 360) + 360) % 360;
  return d - 180;
};

const draw = (w, h, n) => [
  rect(1, 1, w - 2, h - 2, {
    rx: Math.min(w / 2 - 1, h / 2 - 1),
    fill: "node.shade",
  }),
  ...Array.from({ length: n }, (_, i) =>
    rule(3, slotAt(i, n) * h, w - 3, slotAt(i, n) * h),
  ),
];

const chip = {
  font: "inherit",
  fontSize: 11,
  lineHeight: 1,
  padding: "4px 7px",
  border: "1px solid #cbd5e1",
  background: "#fff",
  borderRadius: 4,
  cursor: "pointer",
  color: "#475569",
};

export default function TubeNode({ id, data, selected, width, height }) {
  const { setNodes } = useReactFlow();
  const updateInternals = useUpdateNodeInternals();
  const boxRef = useRef(null);

  const n = slotCount(data);
  // `|| default` rather than `?? default`: React Flow reports 0 for a frame
  // before it has measured, and a zero-width tube draws a negative rectangle.
  const w = Math.max(4, width || TUBE_SIZE[0]);
  const h = Math.max(4, height || TUBE_SIZE[1]);

  const attach = data?.attach;
  const rotation = data?.rotation ?? 0;

  // What the tube is rotated FROM. Riding an edge is the one case where that
  // is not the canvas, which is what keeps a tube's pose relative to its edge
  // through a reroute instead of relative to the screen.
  const base =
    attach && data?.align !== false ? (attach.angle ?? 0) + ALONG : 0;
  const angle = norm(base + rotation);

  const theme = nodeTheme(selected);
  const { marks } = useMemo(
    () =>
      walk(
        draw(w, h, n),
        attach ? { ...theme, "node.stroke": theme["node.accent"] } : theme,
      ),
    [w, h, n, theme, attach],
  );

  // Handles that appear, move or rotate are invisible to React Flow until it
  // re-measures them, and a connection drawn to a stale handle lands in the
  // wrong place.
  useEffect(() => {
    updateInternals(id);
  }, [id, n, angle, w, h, updateInternals]);

  const patch = useCallback(
    (fn) =>
      setNodes((nds) =>
        nds.map((nd) => (nd.id === id ? { ...nd, data: fn(nd.data) } : nd)),
      ),
    [id, setNodes],
  );

  const setSlots = useCallback(
    (delta) => patch((d) => ({ ...d, slots: slotCount(d) + delta })),
    [patch],
  );

  const detach = useCallback(
    () => patch(({ attach: _gone, ...d }) => d),
    [patch],
  );

  // Dragging the grip sets the angle the tube POINTS, and stores the part of it
  // the user is responsible for: subtracting `base` is what makes a rider's
  // rotation an offset from its edge rather than from the screen.
  const startRotate = useCallback(
    (event) => {
      event.preventDefault();
      event.stopPropagation();

      const box = boxRef.current?.getBoundingClientRect();
      if (!box) return;

      // Capture, so the release counts as happening on the grip however far
      // the pointer has swung. Without it the click lands on the pane, the
      // pane clears the selection, and the grip you are still holding
      // unmounts mid-rotation.
      const grip = event.currentTarget;
      grip.setPointerCapture?.(event.pointerId);

      // Rotation is about the centre, so the centre of the tilted box is still
      // the centre of the tube.
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;

      const move = (e) => {
        // +90 because the grip sits at the head, straight up from the centre,
        // and that pose is angle zero.
        const pointed =
          (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI + 90;
        const wanted = e.shiftKey
          ? Math.round(pointed / SNAP_STEP) * SNAP_STEP
          : Math.round(pointed);
        patch((d) => ({ ...d, rotation: norm(wanted - base) }));
      };

      const up = (e) => {
        grip.releasePointerCapture?.(e.pointerId);
        grip.removeEventListener("pointermove", move);
        grip.removeEventListener("pointerup", up);
        grip.removeEventListener("pointercancel", up);
      };

      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", up);
      grip.addEventListener("pointercancel", up);
    },
    [patch, base],
  );

  return (
    <>
      {/* The resizer works the untilted box, so its handles drift away from a
          rotated tube's corners — but dragging its end still lengthens the
          tube, which is the axis anyone reaches for the resizer to change. */}
      <NodeResizer
        isVisible={selected}
        minWidth={14}
        minHeight={60}
        color={theme["node.stroke.selected"]}
      />

      <NodeToolbar isVisible={selected} position={Position.Right} offset={26}>
        <div
          style={{
            display: "flex",
            gap: 4,
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <button
            type="button"
            style={chip}
            onClick={() => setSlots(-1)}
            title="Fewer taps"
          >
            −
          </button>
          <span
            style={{
              ...chip,
              cursor: "default",
              minWidth: 22,
              textAlign: "center",
            }}
          >
            {n}
          </span>
          <button
            type="button"
            style={chip}
            onClick={() => setSlots(1)}
            title="More taps"
          >
            +
          </button>
          {rotation !== 0 && (
            <button
              type="button"
              style={chip}
              onClick={() => patch((d) => ({ ...d, rotation: 0 }))}
              title={attach ? "Lie along the edge again" : "Stand it upright"}
            >
              {Math.round(rotation)}°
            </button>
          )}
          {attach && (
            <button
              type="button"
              style={chip}
              onClick={detach}
              title="Release from the edge"
            >
              detach
            </button>
          )}
        </div>
      </NodeToolbar>

      {/* Handles and grip rotate with the drawing: React Flow reads their
          position off the DOM, so a rotated tap still terminates its edge in
          the right place, and the grip stays at the visible head. The node's
          own box stays axis-aligned, which keeps measuring and hit-testing on
          the untilted rectangle. */}
      <div
        ref={boxRef}
        className="ordo-tube-body"
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          transform: angle ? `rotate(${angle}deg)` : undefined,
          transformOrigin: "50% 50%",
        }}
      >
        <svg
          viewBox={`0 0 ${w} ${h}`}
          width="100%"
          height="100%"
          style={{ display: "block", overflow: "visible" }}
        >
          {marks}
        </svg>

        {selected && (
          <div
            className="ordo-rotate nodrag nopan"
            onPointerDown={startRotate}
            onClick={(e) => e.stopPropagation()}
            title="Drag to rotate · hold Shift to snap to 15°"
            style={{
              position: "absolute",
              left: "50%",
              top: -26,
              width: 14,
              height: 14,
              marginLeft: -7,
              borderRadius: "50%",
              border: `1.5px solid ${theme["node.stroke.selected"]}`,
              background: "#fff",
              cursor: "grab",
              // the stalk back to the tube, so the grip reads as a lever
              boxShadow: `0 7px 0 -6.25px ${theme["node.stroke.selected"]}, 0 14px 0 -6.25px ${theme["node.stroke.selected"]}`,
            }}
          />
        )}

        {Array.from({ length: n }, (_, i) => {
          const top = `${slotAt(i, n) * 100}%`;
          return (
            <Fragment key={i}>
              <Handle
                id={`a${i}`}
                type="source"
                position={Position.Left}
                style={{ top }}
              />
              <Handle
                id={`b${i}`}
                type="source"
                position={Position.Right}
                style={{ top }}
              />
            </Fragment>
          );
        })}

        {/* The ends chain one tube to the next. Named for the tube rather than
            the compass, because neither end stays north for long. */}
        <Handle id="head" type="source" position={Position.Top} />
        <Handle id="tail" type="source" position={Position.Bottom} />
      </div>
    </>
  );
}
