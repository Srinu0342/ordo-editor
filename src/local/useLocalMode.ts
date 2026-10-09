import { useEffect, useRef, useState } from "react";
import { emptySession, exportOrdo, fileName, importOrdo, readDiagram } from "../ordo/index.ts";
import type { Diagnostic, OrdoExport, OrdoSession } from "../ordo/index.ts";
import type { OrdoEdge, OrdoNode } from "../types.ts";
import * as api from "./api.ts";
import { ApiError } from "./api.ts";
import type { DiagramFile, Precondition } from "./api.ts";
import { FREE, placeUrl, readPlace, samePlace } from "./location.ts";
import type { Place } from "./location.ts";
import { rememberRepo } from "./recent.ts";
import { canvasState, decideSync } from "./sync.ts";
import type { FileState } from "./sync.ts";
import type { SyncChoice, SyncQuestion } from "../components/SyncDialog.tsx";

// Local mode: one repo, its diagrams as tabs, and a manual two-way Sync. App
// keeps the canvas; this keeps everything about which file the canvas is.
//
// One diagram is on the canvas at a time. For it the hook keeps a BASE: the
// file's ETag as last loaded or written, and the canvas's own export at that
// moment. Sync compares both against it and lets decideSync (sync.ts) say what
// happens. The base export is taken once the canvas has SETTLED after a load:
// React Flow measures the new nodes and TubeFollower re-seats every rider on
// its edge, and both write to the graph; a base taken before them would make
// a freshly opened diagram look unsynced.
//
// The address bar is where the editor is (location.ts). Every move a person
// makes pushes a history entry, so Back and Forward walk between tabs and
// repos; a move made for them (the first tab of a repo, a tab that is gone)
// replaces it. Leaving a diagram with unsynced edits, by any of those routes,
// asks first.
//
// The flows are async and ask questions mid-way (a conflict, leaving unsynced
// edits). They run one at a time: a click while one is running is dropped.

export type LocalStatus = "loading" | "ready" | "empty" | "invalid" | "error";

export type LocalState =
  | { mode: "free" }
  | {
      mode: "local";
      repo: string;
      tabs: string[];
      tab: string | null;
      status: LocalStatus;
      diagnostics?: Diagnostic[]; // why the file does not read (invalid)
      error?: string; // why the repo cannot be opened (error)
    };

type Local = Extract<LocalState, { mode: "local" }>;

/** The file as of the last load or write, and the canvas's export at that moment ("" until it settles). */
type Base = { etag: string; exported: string };

export type LocalDeps = {
  nodes: OrdoNode[];
  edges: OrdoEdge[];
  nodesInitialized: boolean; // React Flow's: every visible node measured
  replaceCanvas: (nodes: OrdoNode[], edges: OrdoEdge[]) => void;
  session: OrdoSession;
  setSession: (session: OrdoSession) => void;
  startNewHistory: () => void; // undo starts over: the canvas is another diagram now
  download: (text: string, fileName: string) => void;
  notify: (message: string, tone?: "success" | "info" | "error") => void;
};

// The order the server lists diagrams in, so a tab made here lands where a reload would put it.
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const sortTabs = (tabs: string[]) => [...new Set(tabs)].sort(collator.compare);

// A diagram that never reports measured (every node hidden, say) still settles,
// and so does one whose export never holds still: past the deadline, whatever
// it exports is the base.
const SETTLE_TIMEOUT_MS = 1500;
const SETTLE_DEADLINE_MS = 4000;
// Frames to wait for the export to stop changing once the canvas is measured.
const SETTLE_MAX_FRAMES = 30;
// The unsynced dot waits for the graph to stop changing: exporting is not free.
const UNSYNCED_DEBOUNCE_MS = 300;

/** A sentence for a call that failed. */
function explain(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 404) return "There is no such folder under the workspace root.";
    return e.message;
  }
  return "Couldn't reach the Ordo server.";
}

const errorsOf = (out: OrdoExport) => out.diagnostics.filter((d) => d.severity === "error");

export function useLocalMode(deps: LocalDeps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const [state, setStateNow] = useState<LocalState>({ mode: "free" });
  const stateRef = useRef(state);
  const setState = (next: LocalState) => {
    stateRef.current = next;
    setStateNow(next);
  };

  const [settled, setSettledNow] = useState(false);
  const settledRef = useRef(false);
  const setSettled = (value: boolean) => {
    settledRef.current = value;
    setSettledNow(value);
  };

  const [unsynced, setUnsynced] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [label, setLabel] = useState("~");
  const [question, setQuestion] = useState<SyncQuestion | null>(null);

  const baseRef = useRef<Base | null>(null);
  const busy = useRef(false);
  const loadSeq = useRef(0); // bumped by every load; a slower one that finishes later is dropped
  const pendingAnswer = useRef<((choice: SyncChoice) => void) | null>(null);
  const labelAsked = useRef(false);

  // Settling, as a token the effect below watches. `sawUnmeasured` records the
  // canvas going unmeasured after the load: for one commit after a swap React
  // Flow still reports the previous diagram as measured.
  type Settling = { sawUnmeasured: boolean; started: number };
  const settling = useRef<Settling | null>(null);
  const [settleToken, setSettleToken] = useState(0);

  // The hook's whole API reads through refs, so it is built once and every
  // function in it is stable: App binds ⌘S and window listeners to them.
  const api$ = useRef<ReturnType<typeof build> | null>(null);
  if (!api$.current) api$.current = build();
  const fns = api$.current;

  function build() {
    const local = (): Local | null => (stateRef.current.mode === "local" ? stateRef.current : null);
    const exportNow = () => {
      const { nodes, edges, session } = depsRef.current;
      return exportOrdo(nodes, edges, session);
    };

    /** Unsynced right now: the canvas differs from the base export, or cannot be exported at all. */
    const unsyncedNow = () => {
      const s = local();
      const base = baseRef.current;
      if (!s || s.status !== "ready" || !base || !settledRef.current) return false;
      return canvasState(exportNow().text, base.exported) !== "unchanged";
    };

    const currentPlace = (): Place => {
      const s = local();
      return s ? { source: "local", repo: s.repo, tab: s.tab } : FREE;
    };

    const navigate = (place: Place, how: "push" | "replace") => {
      const url = placeUrl(place);
      if (url === window.location.pathname + window.location.search) return;
      if (how === "push") window.history.pushState(null, "", url);
      else window.history.replaceState(null, "", url);
    };

    const ask = (q: SyncQuestion) =>
      new Promise<SyncChoice>((resolve) => {
        pendingAnswer.current?.("cancel");
        pendingAnswer.current = resolve;
        setQuestion(q);
      });

    const answer = (choice: SyncChoice) => {
      const resolve = pendingAnswer.current;
      pendingAnswer.current = null;
      setQuestion(null);
      resolve?.(choice);
    };

    /** One flow at a time; another started meanwhile is dropped. */
    const run = async <T>(flow: () => Promise<T>, dropped: T): Promise<T> => {
      if (busy.current) return dropped;
      busy.current = true;
      try {
        return await flow();
      } finally {
        busy.current = false;
      }
    };

    const askLabel = () => {
      if (labelAsked.current) return;
      labelAsked.current = true;
      api
        .getWorkspace()
        .then((w) => setLabel(w.label))
        .catch(() => {
          labelAsked.current = false;
        });
    };

    const beginSettle = () => {
      const mine: Settling = { sawUnmeasured: false, started: performance.now() };
      settling.current = mine;
      setSettled(false);
      setSettleToken((t) => t + 1);
      setTimeout(() => {
        if (settling.current !== mine || mine.sawUnmeasured) return;
        mine.sawUnmeasured = true;
        setSettleToken((t) => t + 1);
      }, SETTLE_TIMEOUT_MS);
    };

    const stopSettling = () => {
      settling.current = null;
      setSettled(false);
    };

    /** An empty canvas with nothing behind it: free-form, an empty repo, a repo that cannot open. */
    const clearCanvas = (name?: string) => {
      const d = depsRef.current;
      d.replaceCanvas([], []);
      d.setSession(emptySession(name));
      d.startNewHistory();
      baseRef.current = null;
      stopSettling();
      setUnsynced(false);
    };

    /**
     * Put a file on the canvas as tab `tab`. `newHistory` on a tab or repo
     * switch; a load from Sync stays one undo step, like any other change.
     */
    const applyFile = (s: Local, tab: string, file: DiagramFile, { newHistory }: { newHistory: boolean }) => {
      const d = depsRef.current;
      const imported = importOrdo(file.text);
      baseRef.current = { etag: file.etag, exported: "" };
      setUnsynced(false);
      if (!imported.ordo) {
        d.replaceCanvas([], []);
        d.setSession(emptySession(tab));
        if (newHistory) d.startNewHistory();
        stopSettling();
        setState({ ...s, tab, status: "invalid", diagnostics: imported.diagnostics, error: undefined });
        return false;
      }
      d.replaceCanvas(imported.nodes, imported.edges);
      d.setSession({ name: tab, ordo: imported.ordo, layout: imported.layout, style: imported.style });
      if (newHistory) d.startNewHistory();
      setState({ ...s, tab, status: "ready", diagnostics: undefined, error: undefined });
      beginSettle();
      return true;
    };

    const loadTab = async (repo: string, tabs: string[], tab: string): Promise<void> => {
      const seq = ++loadSeq.current;
      const loading: Local = { mode: "local", repo, tabs, tab, status: "loading" };
      setState(loading);
      stopSettling();
      let file: DiagramFile | null;
      try {
        file = await api.readDiagramFile(repo, tab);
      } catch (e) {
        if (seq !== loadSeq.current) return;
        clearCanvas(tab);
        setState({ ...loading, status: "error", error: explain(e) });
        return;
      }
      if (seq !== loadSeq.current) return;
      if (!file) {
        // Gone between the listing and the read: deleted by git or by hand.
        depsRef.current.notify(`${tab} is no longer in ${repo || "the repo"}.`, "info");
        const left = tabs.filter((t) => t !== tab);
        if (!left.length) return showEmpty(repo);
        navigate({ source: "local", repo, tab: left[0] }, "replace");
        return loadTab(repo, left, left[0]);
      }
      applyFile(loading, tab, file, { newHistory: true });
    };

    const showEmpty = (repo: string) => {
      clearCanvas();
      setState({ mode: "local", repo, tabs: [], tab: null, status: "empty" });
      navigate({ source: "local", repo, tab: null }, "replace");
    };

    /** Open `repo` at `want`, or at its first diagram when that is not one of them. */
    const enterRepo = async (repo: string, want: string | null, how: "push" | "replace") => {
      const seq = ++loadSeq.current;
      askLabel();
      const loading: Local = { mode: "local", repo, tabs: [], tab: null, status: "loading" };
      setState(loading);
      stopSettling();
      let diagrams: string[];
      try {
        diagrams = (await api.listDiagrams(repo)).diagrams;
      } catch (e) {
        if (seq !== loadSeq.current) return;
        clearCanvas();
        setState({ ...loading, status: "error", error: explain(e) });
        navigate({ source: "local", repo, tab: want }, how);
        return;
      }
      if (seq !== loadSeq.current) return;
      rememberRepo(repo);
      if (!diagrams.length) {
        navigate({ source: "local", repo, tab: null }, how);
        return showEmpty(repo);
      }
      const tab = want !== null && diagrams.includes(want) ? want : diagrams[0];
      navigate({ source: "local", repo, tab }, how);
      await loadTab(repo, diagrams, tab);
    };

    const enterFree = () => {
      ++loadSeq.current;
      setState({ mode: "free" });
      clearCanvas();
    };

    /** Drop `tab` from the bar, after its file went away, and move to the first one left. */
    const closeTab = async (s: Local, tab: string, notice: string) => {
      depsRef.current.notify(notice, "info");
      const tabs = s.tabs.filter((t) => t !== tab);
      if (!tabs.length) return showEmpty(s.repo);
      navigate({ source: "local", repo: s.repo, tab: tabs[0] }, "replace");
      await loadTab(s.repo, tabs, tabs[0]);
    };

    // --- sync ---------------------------------------------------------------

    /**
     * Write the canvas. On success the written text is the new base and its
     * documents the session's, so the next export patches what is on disk.
     * "retry" when the file moved under the write (412): decide again.
     */
    const write = async (s: Local, tab: string, out: OrdoExport, pre: Precondition): Promise<boolean | "retry"> => {
      const d = depsRef.current;
      let result: api.WriteResult;
      try {
        result = await api.writeDiagramFile(s.repo, tab, out.text!, pre);
      } catch (e) {
        d.notify(`Couldn't write ${tab}: ${explain(e)}`, "error");
        return false;
      }
      if (result.ok) {
        baseRef.current = { etag: result.etag, exported: out.text! };
        // depsRef again, not `d`: the session may have moved during the await.
        d.setSession({ ...depsRef.current.session, ordo: out.ordo!.doc, layout: out.layout!.doc });
        setUnsynced(false);
        d.notify(`Synced ${tab}`, "success");
        return true;
      }
      if (result.status === 412) return "retry";
      // The server read what Ordo wrote and refused it. exportOrdo reads its
      // own output back first, so this means the two disagree: say so.
      await ask({
        kind: "blocked",
        tab,
        exportDiagnostics: result.diagnostics,
        notice: "The server refused the file Ordo wrote, so nothing was saved.",
      });
      return false;
    };

    /** Sync the open diagram. True when the canvas and the file agree afterwards. */
    const syncNow = async (): Promise<boolean> => {
      const s0 = local();
      if (!s0 || !s0.tab || (s0.status !== "ready" && s0.status !== "invalid")) return false;
      const tab = s0.tab;
      const d = depsRef.current;
      setSyncing(true);
      try {
        if (s0.status === "invalid") return await retryInvalid(s0, tab);
        if (!settledRef.current || !baseRef.current) return false;

        // A 412 means the file changed between the read and the write: decide
        // again with what is there now, which lands on the conflict question.
        for (let attempt = 0; attempt < 3; attempt++) {
          const s = local()!;
          const base = baseRef.current!;
          const out = exportNow();
          const canvas = canvasState(out.text, base.exported);
          let file: DiagramFile | null;
          try {
            file = await api.readDiagramFile(s.repo, tab);
          } catch (e) {
            d.notify(`Couldn't read ${tab}: ${explain(e)}`, "error");
            return false;
          }
          const read = file && file.etag !== base.etag ? readDiagram(file.text) : null;
          const fileState: FileState = !file ? "deleted" : !read ? "same" : read.ok ? "changed" : "changed-invalid";
          const take = () => {
            applyFile(s, tab, file!, { newHistory: false });
            d.notify(`Loaded ${tab} from disk`, "success");
            return true;
          };

          let done: boolean | "retry";
          switch (decideSync(canvas, fileState)) {
            case "nothing":
              d.notify("Up to date", "info");
              return true;
            case "write":
              done = await write(s, tab, out, { ifMatch: base.etag });
              break;
            case "load":
              return take();
            case "show-invalid":
              await ask({ kind: "invalid", tab, fileDiagnostics: read!.diagnostics });
              return false;
            case "close":
              await closeTab(s, tab, `${tab} was deleted outside Ordo, so its tab is closed.`);
              return true;
            case "conflict": {
              const choice = await ask({ kind: "conflict", tab });
              if (choice === "keep") done = await write(s, tab, out, { ifMatch: file!.etag });
              else if (choice === "take") return take();
              else {
                if (choice === "download") d.download(out.text!, fileName(tab));
                return false;
              }
              break;
            }
            case "conflict-invalid": {
              const choice = await ask({ kind: "conflict-invalid", tab, fileDiagnostics: read!.diagnostics });
              if (choice === "keep") done = await write(s, tab, out, { ifMatch: file!.etag });
              else {
                if (choice === "download") d.download(out.text!, fileName(tab));
                return false;
              }
              break;
            }
            case "deleted": {
              const choice = await ask({ kind: "deleted", tab });
              if (choice === "recreate") done = await write(s, tab, out, { ifNoneMatch: "*" });
              else if (choice === "close-tab") {
                await closeTab(s, tab, `Closed ${tab}.`);
                return true;
              } else return false;
              break;
            }
            case "blocked":
              await ask({
                kind: "blocked",
                tab,
                exportDiagnostics: errorsOf(out),
                fileDiagnostics: fileState === "changed-invalid" ? read!.diagnostics : undefined,
                notice: fileState === "deleted" ? `${tab}'s file is gone from disk too.` : undefined,
              });
              return false;
            case "blocked-take": {
              const choice = await ask({ kind: "blocked-take", tab, exportDiagnostics: errorsOf(out) });
              return choice === "take" ? take() : false;
            }
          }
          if (done !== "retry") return done;
        }
        d.notify(`${tab} kept changing on disk while syncing. Press Sync again.`, "error");
        return false;
      } finally {
        setSyncing(false);
        void refreshTabs();
      }
    };

    /** The open file did not read; read it again, and load it if it does now. */
    const retryInvalid = async (s: Local, tab: string): Promise<boolean> => {
      const d = depsRef.current;
      let file: DiagramFile | null;
      try {
        file = await api.readDiagramFile(s.repo, tab);
      } catch (e) {
        d.notify(`Couldn't read ${tab}: ${explain(e)}`, "error");
        return false;
      }
      if (!file) {
        await closeTab(s, tab, `${tab} was deleted outside Ordo, so its tab is closed.`);
        return true;
      }
      if (applyFile(s, tab, file, { newHistory: true })) {
        d.notify(`Loaded ${tab}`, "success");
        return true;
      }
      d.notify(`${tab} still doesn't read as an Ordo diagram.`, "error");
      return false;
    };

    /** Sync also picks up diagrams made or removed outside Ordo. The open tab stays listed. */
    const refreshTabs = async () => {
      const s = local();
      if (!s) return;
      let diagrams: string[];
      try {
        diagrams = (await api.listDiagrams(s.repo)).diagrams;
      } catch {
        return;
      }
      const now = local();
      if (!now || now.repo !== s.repo) return;
      const tabs = sortTabs(now.tab && now.status !== "empty" ? [...diagrams, now.tab] : diagrams);
      if (tabs.join("\n") !== now.tabs.join("\n")) setState({ ...now, tabs });
    };

    // --- guards -------------------------------------------------------------

    /** Leaving the open diagram: fine when it is synced, otherwise ask. */
    const leaveTab = async (): Promise<boolean> => {
      if (!unsyncedNow()) return true;
      const choice = await ask({ kind: "leave-tab", tab: local()?.tab ?? undefined });
      if (choice === "discard") return true;
      if (choice === "sync") return (await syncNow()) && !unsyncedNow();
      return false;
    };

    /** Leaving free-form with a drawing on the canvas: download it, drop it, or stay. */
    const leaveFree = async (): Promise<boolean> => {
      const d = depsRef.current;
      if (stateRef.current.mode !== "free" || !d.nodes.length) return true;
      const choice = await ask({ kind: "leave-free" });
      if (choice === "cancel" || choice === "ok") return false;
      if (choice === "download") {
        const out = exportNow();
        if (out.text === null) {
          d.notify("The drawing can't be written as Ordo YAML, so it wasn't downloaded.", "error");
          return false;
        }
        d.download(out.text, fileName(d.session.name));
      }
      return true;
    };

    const leave = () => (stateRef.current.mode === "local" ? leaveTab() : leaveFree());

    // --- what App calls -----------------------------------------------------

    const openRepo = (repo: string) =>
      run(async () => {
        if (!(await leave())) return;
        await enterRepo(repo, null, "push");
      }, undefined);

    const selectTab = (name: string) =>
      run(async () => {
        const s = local();
        if (!s || name === s.tab || !(await leaveTab())) return;
        navigate({ source: "local", repo: s.repo, tab: name }, "push");
        await loadTab(s.repo, s.tabs, name);
      }, undefined);

    /** Null once the diagram exists, or the sentence saying why not. */
    const createTab = (name: string): Promise<string | null> =>
      run<string | null>(async () => {
        const s = local();
        if (!s) return "Open a repo first.";
        let file: DiagramFile;
        try {
          file = await api.createDiagram(s.repo, name);
        } catch (e) {
          return explain(e);
        }
        const now = local() ?? s;
        const tabs = sortTabs([...now.tabs, name]);
        setState({ ...now, tabs });
        // The diagram exists either way; with unsynced edits here, staying is allowed.
        if (!(await leaveTab())) return null;
        navigate({ source: "local", repo: s.repo, tab: name }, "push");
        ++loadSeq.current;
        applyFile({ ...(local() ?? now), tabs }, name, file, { newHistory: true });
        return null;
      }, "Wait for the current sync to finish.");

    const sync = () => run(syncNow, false);

    const goFree = () =>
      run(async () => {
        if (!local() || !(await leaveTab())) return;
        navigate(FREE, "push");
        enterFree();
      }, undefined);

    // Back and Forward. The address bar has already moved, so a Cancel puts
    // the place being left back on top.
    const onPopState = () => {
      const here = currentPlace();
      const next = readPlace(window.location.search);
      if (samePlace(next, here)) return;
      if (busy.current) {
        window.history.pushState(null, "", placeUrl(here));
        return;
      }
      void run(async () => {
        if (!(await leave())) {
          window.history.pushState(null, "", placeUrl(here));
          return;
        }
        if (next.source === "free") return enterFree();
        const s = local();
        if (s && s.repo === next.repo && s.tabs.length) {
          const tab = next.tab !== null && s.tabs.includes(next.tab) ? next.tab : s.tabs[0];
          navigate({ ...next, tab }, "replace");
          return loadTab(s.repo, s.tabs, tab);
        }
        return enterRepo(next.repo, next.tab, "replace");
      }, undefined);
    };

    const start = () => {
      const place = readPlace(window.location.search);
      if (place.source === "local") void run(() => enterRepo(place.repo, place.tab, "replace"), undefined);
    };

    // The settle step, for the effect below: export once a frame until two
    // frames agree, then that export is the base.
    const settleNow = (mine: Settling) => {
      let last: string | null | undefined;
      let frames = 0;
      let id = 0;
      const step = () => {
        if (settling.current !== mine) return;
        const text = exportNow().text;
        const late = performance.now() - mine.started > SETTLE_DEADLINE_MS;
        if (text !== last && ++frames < SETTLE_MAX_FRAMES && !late) {
          last = text;
          id = requestAnimationFrame(step);
          return;
        }
        settling.current = null;
        if (baseRef.current) baseRef.current = { ...baseRef.current, exported: text ?? "" };
        setSettled(true);
      };
      id = requestAnimationFrame(step);
      return () => cancelAnimationFrame(id);
    };

    return {
      openRepo,
      selectTab,
      createTab,
      sync,
      goFree,
      answer,
      unsyncedNow,
      isLocal: () => stateRef.current.mode === "local",
      onPopState,
      start,
      settleNow,
    };
  }

  // Start-up, Back/Forward, and the warning before the tab closes.
  useEffect(() => {
    fns.start();
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!fns.unsyncedNow()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("popstate", fns.onPopState);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("popstate", fns.onPopState);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [fns]);

  // Settling: wait for the canvas to go unmeasured and come back measured
  // (an empty one has nothing to measure), then for the export to hold still.
  // The new graph lands in the same commit as the token, so its length is
  // already the new diagram's here.
  const { nodes, edges, nodesInitialized } = deps;
  const empty = nodes.length === 0;
  useEffect(() => {
    const mine = settling.current;
    if (!mine) return;
    if (!empty) {
      if (!nodesInitialized) {
        mine.sawUnmeasured = true;
        return;
      }
      if (!mine.sawUnmeasured) return;
    }
    return fns.settleNow(mine);
  }, [settleToken, nodesInitialized, empty, fns]);

  // The unsynced dot, once the graph has been still for a moment.
  useEffect(() => {
    if (!settled || state.mode !== "local" || state.status !== "ready") {
      setUnsynced(false);
      return;
    }
    const id = setTimeout(() => setUnsynced(fns.unsyncedNow()), UNSYNCED_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [nodes, edges, deps.session, settled, state, fns]);

  return {
    state,
    label,
    settled,
    unsynced,
    syncing,
    question,
    answer: fns.answer,
    openRepo: fns.openRepo,
    selectTab: fns.selectTab,
    createTab: fns.createTab,
    sync: fns.sync,
    goFree: fns.goFree,
    isLocal: fns.isLocal,
    unsyncedNow: fns.unsyncedNow,
  };
}
