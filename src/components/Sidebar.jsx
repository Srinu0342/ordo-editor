import { useMemo, useRef, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import {
  SHAPE_GROUPS,
  SHAPES,
  defaultSize,
  drawShape,
} from "../shapes/registry.js";
import { opsToSvg, svgDataUri } from "../render/svgWalker.js";
import { LIGHT } from "../theme.js";
import { ROUTES, ROUTE_KEYS, MARKERS, MARKER_KEYS } from "../edges/index.js";

// Icon rail plus the panel it swaps. Nodes are dragged onto the canvas; edges
// are armed and then drawn by connecting two handles — different interactions,
// which is why they are separate panels rather than two sections of one scroll.

const RAIL_WIDTH = 48;
const PANEL_WIDTH = 214;

// Structural types get hand-written thumbnails because they are not in the
// shape registry — they are components, not `shape` values.
const STRUCTURAL = [
  {
    kind: "container",
    label: "Group",
    svg: '<rect x="2" y="5" width="52" height="26" rx="3" fill="none" stroke="#94a3b8" stroke-width="1.4" stroke-dasharray="3 3"/><rect x="8" y="12" width="17" height="11" rx="2" fill="#fff" stroke="#94a3b8" stroke-width="1.3"/><rect x="31" y="12" width="17" height="11" rx="2" fill="#fff" stroke="#94a3b8" stroke-width="1.3"/>',
  },
  {
    kind: "compartment",
    label: "Class",
    svg: '<rect x="8" y="3" width="40" height="30" fill="#fff" stroke="#94a3b8" stroke-width="1.4"/><path d="M8 13H48M8 24H48" stroke="#cbd5e1" stroke-width="1.2"/>',
  },
  {
    kind: "label",
    label: "Text",
    svg: '<path d="M10 14H46M10 23H34" stroke="#94a3b8" stroke-width="1.6" stroke-linecap="round"/>',
  },
  {
    kind: "tube",
    label: "Timeline tube — drop it on an edge to ride it",
    svg: '<rect x="23.5" y="3" width="9" height="30" rx="4.5" fill="#f1f5f9" stroke="#94a3b8" stroke-width="1.4"/><path d="M25 8h6M25 18h6M25 28h6" stroke="#cbd5e1" stroke-width="1.2"/>',
  },
  {
    kind: "fragment",
    label: "Fragment — loop, alt, opt, par frame for sequence diagrams",
    svg: '<rect x="3" y="4" width="50" height="28" rx="1" fill="none" stroke="#94a3b8" stroke-width="1.4"/><path d="M3 4h17v6l-3 3H3z" fill="#f1f5f9" stroke="#94a3b8" stroke-width="1.2"/><path d="M3 22H53" stroke="#94a3b8" stroke-width="1.1" stroke-dasharray="3 2.5"/>',
  },
];

const wrapSvg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 36" width="56" height="36">${body}</svg>`;

// THE payoff of the op-list: the palette renders through the headless walker.
// Every swatch you see is proof the no-DOM renderer works, and any divergence
// between it and the canvas shows up here first rather than in a CI diff.
function shapePreview(key) {
  const [w, h] = defaultSize(key);
  const s = Math.min(48 / w, 28 / h);
  const pw = w * s;
  const ph = h * s;
  const body = opsToSvg(drawShape(key, pw, ph), {
    width: pw,
    height: ph,
    theme: LIGHT,
    pad: 1.5,
  }).replace(/^<svg[^>]*>|<\/svg>$/g, "");
  const dx = (56 - pw) / 2;
  const dy = (36 - ph) / 2;
  return wrapSvg(`<g transform="translate(${dx} ${dy})">${body}</g>`);
}

const RAIL = [
  {
    key: "nodes",
    title: "Nodes",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <rect
          x="2.25"
          y="4.25"
          width="13.5"
          height="9.5"
          rx="2"
          stroke="currentColor"
          strokeWidth="1.5"
        />
      </svg>
    ),
  },
  {
    key: "edges",
    title: "Edges",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path
          d="M2 13.5h5.5V5H12"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M11 2.75 14.25 5 11 7.25"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
];

const sectionTitle = {
  fontSize: 10.5,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: "#94a3b8",
  fontWeight: 600,
  margin: "12px 0 6px",
};

function Swatch({ kind, title, src, onDragStart }) {
  return (
    <div
      draggable
      title={title}
      onDragStart={onDragStart}
      style={{
        border: "1px solid #e2e8f0",
        borderRadius: 5,
        background: "#fff",
        cursor: "grab",
        display: "grid",
        placeItems: "center",
        padding: 2,
        aspectRatio: "1.55",
      }}
    >
      <img
        src={src}
        alt={title}
        draggable={false}
        style={{ display: "block", maxWidth: "100%" }}
      />
    </div>
  );
}

export default function Sidebar({
  panel,
  onPanelChange,
  route,
  onRouteChange,
  onInspect,
}) {
  const [q, setQ] = useState("");
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { getViewport, setViewport } = useReactFlow();
  const asideRef = useRef(null);
  const shedWidth = useRef(0);

  // Previews are pure functions of the registry, so they are built once and
  // reused for the life of the session.
  const previews = useMemo(() => {
    const out = {};
    for (const key of Object.keys(SHAPES))
      out[key] = svgDataUri(shapePreview(key));
    for (const s of STRUCTURAL) out[s.kind] = svgDataUri(wrapSvg(s.svg));
    return out;
  }, []);

  const needle = q.trim().toLowerCase();
  const match = (key, label) =>
    !needle || key.includes(needle) || label.toLowerCase().includes(needle);

  const drag = (kind) => (e) => {
    e.dataTransfer.setData("application/ordo", kind);
    e.dataTransfer.effectAllowed = "move";
  };

  // The panel is a flex sibling of the canvas, so hiding it widens the canvas
  // and drags the whole diagram left. Shifting the viewport by the width we
  // gave up keeps the grid visually anchored. Viewport x is applied before
  // scale, so the delta is the same at any zoom.
  const setCollapsed = (next) => {
    if (next === isCollapsed) return;
    if (next) shedWidth.current = asideRef.current?.offsetWidth ?? 0;
    const dx = next ? shedWidth.current : -shedWidth.current;
    setIsCollapsed(next);
    const vp = getViewport();
    setViewport({ ...vp, x: vp.x + dx });
  };

  // Activity-bar behaviour: the active icon toggles the panel shut, any other
  // icon reopens it on that panel. Without the reopen branch, clicking a rail
  // icon while collapsed would look like a dead button.
  const selectPanel = (key) => {
    if (isCollapsed) {
      setCollapsed(false);
      onPanelChange(key);
    } else if (panel === key) {
      setCollapsed(true);
    } else {
      onPanelChange(key);
    }
  };

  const groups = SHAPE_GROUPS.map(([id, title, set]) => [
    id,
    title,
    Object.keys(set).filter((k) => match(k, set[k].label)),
  ]).filter(([, , keys]) => keys.length);

  const structural = STRUCTURAL.filter((s) => match(s.kind, s.label));
  const total = groups.reduce((n, g) => n + g[2].length, 0) + structural.length;

  return (
    <div
      style={{
        display: "flex",
        fontFamily: "system-ui, sans-serif",
        minHeight: 0,
      }}
    >
      <nav
        style={{
          width: RAIL_WIDTH,
          borderRight: "1px solid #e2e8f0",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 6,
          paddingTop: 10,
          background: "#f8fafc",
        }}
      >
        <button
          type="button"
          title={isCollapsed ? "Expand panel" : "Collapse panel"}
          aria-label={isCollapsed ? "Expand panel" : "Collapse panel"}
          aria-expanded={!isCollapsed}
          aria-controls="ordo-sidebar-panel"
          onClick={() => setCollapsed(!isCollapsed)}
          style={{
            width: 32,
            height: 32,
            display: "grid",
            placeItems: "center",
            borderRadius: 6,
            cursor: "pointer",
            border: "1px solid transparent",
            background: "transparent",
            color: "#64748b",
          }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path
              d={isCollapsed ? "M6 3L12 9L6 15" : "M12 3L6 9L12 15"}
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {RAIL.map((r) => {
          const active = panel === r.key && !isCollapsed;
          return (
            <button
              key={r.key}
              type="button"
              title={r.title}
              aria-label={r.title}
              aria-pressed={active}
              onClick={() => selectPanel(r.key)}
              style={{
                width: 32,
                height: 32,
                display: "grid",
                placeItems: "center",
                borderRadius: 6,
                cursor: "pointer",
                border: active ? "1px solid #6366f1" : "1px solid transparent",
                background: active ? "#eef2ff" : "transparent",
                color: active ? "#4338ca" : "#64748b",
              }}
            >
              {r.icon}
            </button>
          );
        })}
      </nav>

      <aside
        id="ordo-sidebar-panel"
        ref={asideRef}
        style={{
          width: PANEL_WIDTH,
          padding: "10px 12px 12px",
          borderRight: "1px solid #e2e8f0",
          display: isCollapsed ? "none" : "flex",
          flexDirection: "column",
          overflowY: "auto",
          fontSize: 13,
        }}
      >
        {panel === "nodes" ? (
          <>
            <input
              id="ordo-shape-search"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Search ${Object.keys(SHAPES).length} shapes`}
              style={{
                width: "100%",
                boxSizing: "border-box",
                font: "inherit",
                fontSize: 12.5,
                padding: "6px 8px",
                border: "1px solid #cbd5e1",
                borderRadius: 5,
                background: "#fff",
              }}
            />

            <div style={sectionTitle}>Structural</div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3,1fr)",
                gap: 5,
              }}
            >
              {structural.map((s) => (
                <Swatch
                  key={s.kind}
                  kind={s.kind}
                  title={s.label}
                  src={previews[s.kind]}
                  onDragStart={drag(s.kind)}
                />
              ))}
            </div>

            {groups.map(([id, title, keys]) => (
              <div key={id}>
                <div style={sectionTitle}>{title}</div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3,1fr)",
                    gap: 5,
                  }}
                >
                  {keys.map((k) => (
                    <Swatch
                      key={k}
                      kind={k}
                      title={`${SHAPES[k].label} · ${k}`}
                      src={previews[k]}
                      onDragStart={drag(k)}
                    />
                  ))}
                </div>
              </div>
            ))}

            {total === 0 && (
              <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 14 }}>
                No shape matches “{q}”.
              </div>
            )}
          </>
        ) : (
          <>
            <div style={{ ...sectionTitle, marginTop: 2 }}>Routing</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {ROUTE_KEYS.map((k) => {
                const active = route === k;
                return (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onRouteChange(k)}
                    title={ROUTES[k].hint}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 9,
                      padding: "6px 8px",
                      border: `1px solid ${active ? "#6366f1" : "#cbd5e1"}`,
                      background: active ? "#eef2ff" : "#fff",
                      borderRadius: 5,
                      cursor: "pointer",
                      font: "inherit",
                      fontSize: 12.5,
                      textAlign: "left",
                    }}
                  >
                    <svg width="42" height="18" viewBox="0 0 42 18" fill="none">
                      <path
                        d={
                          k === "straight"
                            ? "M2 14 L36 5"
                            : k === "curved"
                              ? "M2 14 C16 14 22 5 36 5"
                              : k === "orthogonal"
                                ? "M2 14 H19 V5 H36"
                                : "M2 14 H15 Q19 14 19 10 V9 Q19 5 23 5 H36"
                        }
                        stroke="#475569"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path d="M34 2.5 L39.5 5 L34 7.5 Z" fill="#475569" />
                    </svg>
                    {ROUTES[k].label}
                  </button>
                );
              })}
            </div>

            <div style={sectionTitle}>End markers</div>
            <div style={{ fontSize: 11.5, color: "#64748b", lineHeight: 1.5 }}>
              Set per end in the toolbar. {MARKER_KEYS.length} available across
              flowchart, UML and ER cardinality.
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2,1fr)",
                gap: 4,
                marginTop: 8,
              }}
            >
              {MARKER_KEYS.filter((k) => MARKERS[k].body).map((k) => (
                <div
                  key={k}
                  title={k}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    fontSize: 10.5,
                    color: "#64748b",
                    border: "1px solid #eef2f6",
                    borderRadius: 4,
                    padding: "3px 5px",
                    minWidth: 0,
                  }}
                >
                  <svg
                    width="26"
                    height="12"
                    viewBox="0 0 26 12"
                    style={{
                      flex: "0 0 auto",
                      // the same marker elements, drawn with literal colours
                      // instead of the edge's context-stroke
                      "--mk-line": "#475569",
                      "--mk-solid": "#475569",
                    }}
                  >
                    <path d="M1 6 H13" stroke="#475569" strokeWidth="1.4" />
                    <g
                      transform={`translate(${25 - MARKERS[k].refX} ${6 - MARKERS[k].h / 2})`}
                    >
                      {MARKERS[k].body}
                    </g>
                  </svg>
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {MARKERS[k].label}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
