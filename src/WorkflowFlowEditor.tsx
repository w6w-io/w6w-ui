import {
  Background,
  type Connection,
  // Rendered as a `<Controls>` CHILD, which the library appends after its three
  // built-ins — so the auto-layout button lands in the same stack and inherits
  // T3.1.1's `--xy-*` → `--w6w-*` bridge with no chrome of its own.
  ConnectionLineType,
  ControlButton,
  Controls,
  type Edge,
  MiniMap,
  type NodeProps,
  NodeToolbar,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  // Type-only now: `addEdge` itself is called inside `flow-connect.ts`; this file
  // only borrows its parameter type for the `onConnect` handler.
  type addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import type { FinalConnectionState } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Handle } from "@xyflow/react";
import {
  type ReactNode,
  type RefObject,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { AddConnectionModal } from "./AddConnectionModal.tsx";
import { AppPicker } from "./AppPicker.tsx";
import { JsonEditor } from "./JsonEditor.tsx";
import { NodeConfigForm } from "./NodeConfigForm.tsx";
import { ParamsForm } from "./ParamsForm.tsx";
import { PropertyEntryForm } from "./PropertyEntryForm.tsx";
import {
  type BuiltStep,
  type ConfigView,
  ConfigViewToggle,
  StepBuilderModal,
  StepTestRun,
  type StepTestRunHandle,
  requiredParamsFilled,
} from "./StepBuilderModal.tsx";
import { TriggerFillForm } from "./TriggerFillForm.tsx";
import { AppIcon } from "./components/AppIcon.tsx";
import { ConfirmModal } from "./components/ConfirmModal.tsx";
import { Copyable } from "./components/Copyable.tsx";
import {
  type ExpressionOptions,
  ExpressionOptionsProvider,
  type ExpressionStepSource,
  useExpressionOptions,
} from "./components/ExpressionOptions.tsx";
import { InternalIcon } from "./components/InternalIcon.tsx";
import { Modal } from "./components/Modal.tsx";
import { ResolvedParams } from "./components/ResolvedParams.tsx";
// The connection rules live in a JSX-free `.ts` module so `node --test` can run
// them (see `flow-connect.ts`). This file is their only production caller.
import {
  applyConnect,
  canConnect,
  connectConflict,
  edgeLane,
  edgeWhenConflict,
  renameStepInEdges,
  setEdgeWhen,
} from "./flow-connect.ts";
import {
  ERROR_SOURCE_HANDLE,
  type FlowStep,
  type FlowWorkflow,
  WEBHOOK_APP,
  internalNodeIcon,
  internalNodeLabel,
  internalNodeParams,
  isControlApp,
  isInternalApp,
  isTriggerApp,
  laneForSourceHandle,
  nodePortsForStep,
} from "./flow-types.ts";
import {
  type StepNode,
  findChainRoot,
  findChainTail,
  flowToWorkflow,
  idClashMessage,
  paramsToJson,
  relayoutNodes,
  slugifyLabel,
  stepToJson,
  storedViewport,
  suggestStepId,
  withViewport,
  workflowToFlow,
} from "./flow-utils.ts";
import {
  type StepStartState,
  type StepTest,
  WorkflowProjectProvider,
  useW6WApi,
} from "./provider.tsx";
// One implementation of the incoming-state pipeline, shared by every surface
// that offers upstream seed chips (this file's step editor + ▶ Run collect
// form, and StepBuilderModal's add-step Test tab) — see `step-preview-state.ts`'s
// header comment for why this lives outside WorkflowFlowEditor.tsx.
import {
  type SeedSource,
  startStateFromSeeds,
  stepBuilderUpstreamSteps,
  upstreamStateSources,
} from "./step-preview-state.ts";
import { useEffectiveTheme } from "./theme.ts";
import { asFieldDefs, fieldsToParams, seedValues } from "./trigger-fields.ts";
import type {
  ActionDef,
  ActionParam,
  AppSummary,
  ConnectionSummary,
  SubscriptionSummary,
} from "./types.ts";
import { useSeedSources } from "./use-seed-sources.ts";

/**
 * What the "Run on" control does, shown on the lane panel (T1.1.1).
 *
 * An error edge is authored by DRAGGING from the step's error exit port (the
 * second, red-tinted source handle every step/control node renders below its
 * ordinary exit) — that's what stamps `sourceHandle`/`data.when` at creation
 * time (`onConnect` → `laneForSourceHandle`). This panel is not how an error
 * edge is first drawn; it is the RE-LANE affordance for an edge already drawn,
 * for when it was dragged from the wrong port. Each lane still holds one edge
 * out of an `out: 1` step, so switching an edge into a lane that's already
 * occupied re-points the incumbent (the deliberate single-slot UX).
 */
const LANE_HINT =
  "Which outcome of the source step this edge carries. An error edge is drawn by dragging " +
  "from the step's error exit port; use this control to re-lane an edge already drawn. " +
  "An error edge overrides the step’s “On error” policy.";

/**
 * The step ids the refused edge id is minted from: the endpoints of the edge being
 * drawn/moved plus those of the edge already holding the id. {@link idClashMessage}
 * needs them to *determine* the cause instead of asserting one — the wording used to
 * blame a `:error` step id unconditionally, and a collision from an embedded `->`
 * therefore told the author to rename a step that did not exist (ADDENDUM Y).
 *
 * Both call sites look the sitting edge up by the id `connectConflict` /
 * `edgeWhenConflict` returned; a corrupt edge set with no such edge simply
 * contributes nothing, and the message falls back to naming no cause.
 */
function clashInvolvedIds(
  edges: Edge[],
  conflictId: string,
  source: string | null | undefined,
  target: string | null | undefined,
): (string | null | undefined)[] {
  const sitting = edges.find((e) => e.id === conflictId);
  return [source, target, sitting?.source, sitting?.target];
}

/**
 * The auto-layout glyph — a three-box hierarchy (one parent over two children),
 * matching the layering the button applies. Module-local inline SVG, 16×16 on a
 * `0 0 24 24` box, per convention C6 (there is no shared icons module).
 *
 * **Filled subpaths with no `fill` attribute**, so it inherits `currentColor` —
 * which is what makes it themed for free. The library styles a control button's svg
 * as `svg { width: 100%; max-width: 12px; max-height: 12px; fill: currentColor }`
 * (`@xyflow/react/dist/style.css`), so a `fill="none" stroke="currentColor"` icon —
 * the house style for the *node cards* — renders as nothing at all in here.
 */
function AutoLayoutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 3h6v6H9zM11 9h2v2h-2zM4 11h16v2H4zM4 13h2v2H4zM18 13h2v2h-2zM2 15h6v6H2zM16 15h6v6h-6z" />
    </svg>
  );
}

export interface WorkflowFlowEditorProps {
  /** The workflow being edited. The editor re-derives layout when this changes identity. */
  value: FlowWorkflow;
  /** Fired whenever the user changes the graph — new nodes, edges, or step edits. */
  onChange: (next: FlowWorkflow) => void;
  /** Disable all interactions — pans/zooms are still enabled. */
  readOnly?: boolean;
  /** Height of the editor viewport. Defaults to 480px. */
  height?: string | number;
  /**
   * Registered apps, used to render each action node with its owning app's icon,
   * display name, and version. A step only carries `uses.app` (an id), so the
   * card joins that id against this list. Optional — unknown/absent apps degrade
   * to an initials tile with no version. Metadata is looked up at render time and
   * never stored on nodes, so it can't corrupt round-tripping back to a workflow.
   */
  apps?: AppSummary[];
  /**
   * EXTRA scope for each step field's expression picker, on top of whatever
   * this editor is already mounted under.
   *
   * Optional, and normally omitted: `ExpressionOptionsProvider` layers, so a
   * host that provides the project's vars/secrets/documents above this editor
   * (studio does, once, in its app shell) needs to pass nothing here. Use it
   * only to add or override something at this level.
   *
   * Names only — secret plaintext never reaches the client.
   */
  exprOptions?: ExpressionOptions;
  /**
   * The workflow's currently-selected project id. Threaded into ad-hoc
   * test-invokes so document expressions resolve against that project's docs
   * (not the scope's default/starter project). The host (studio) passes the
   * active project here; omitted → server default-project behavior. See T2.1.2 /
   * HITL-4(b): the invoke path's ambient scope is already project-aware.
   */
  project?: string;
}

/**
 * App metadata by id, shared with the node cards so `StepNodeCard` can show the
 * app's icon/name/version without threading it through each node's `data`.
 */
const AppsCtx = createContext<Map<string, AppSummary>>(new Map());

/** Which view the step edit modal opens in: the tabbed form, raw JSON, or node settings. */
type EditView = "props" | "json" | "settings";

/** Per-node control handlers, provided to the node cards via context. */
interface StepControls {
  /** Open the edit modal on the form view. */
  onEdit: (id: string) => void;
  /** Open the edit modal straight on the JSON view. */
  onEditJson: (id: string) => void;
  /** Test-run a single step and show its result. */
  onRun: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  readOnly?: boolean;
}
const StepControlsCtx = createContext<StepControls | null>(null);

/**
 * Visual workflow editor. Renders a Workflow's DAG as a React Flow graph:
 *
 *   - Auto-layouted on load (topological columns + sibling rows).
 *   - Nodes render differently for action steps vs. control steps
 *     (`uses.app === "@w6w/control"`).
 *   - `+ Step` opens a guided builder (pick app → connection → action → params,
 *     or a flow control). Drag nodes to reposition; connect handles to add edges.
 *   - Selecting a node reveals a toolbar above it: Edit / Duplicate / Delete.
 *   - Edit opens a modal with a Form ⇄ JSON toggle for that step.
 *   - Every meaningful change fires `onChange` with an updated Workflow.
 */
export function WorkflowFlowEditor(props: WorkflowFlowEditorProps) {
  return (
    <ReactFlowProvider>
      <Inner {...props} />
    </ReactFlowProvider>
  );
}

/**
 * Live state of a single-step test run, shown in **one** modal that walks three
 * phases against this one state slot: `collect` (fill the step's properties),
 * `running`, then `done` / `error`. ▶ opens `collect` — it no longer invokes on
 * click, so a trigger's declared fields are filled before the run instead of the
 * run coming back `{}`.
 */
interface StepRunState {
  stepId: string;
  status: "collect" | "running" | "done" | "error";
  value?: unknown;
  error?: string;
  errorCode?: string;
  /** console.* output captured from a script node run, if any. */
  logs?: string[];
}

function Inner({
  value,
  onChange,
  readOnly,
  height = 480,
  apps,
  exprOptions,
  project,
}: WorkflowFlowEditorProps) {
  const api = useW6WApi();
  const appsById = useMemo(() => new Map((apps ?? []).map((a) => [a.id, a])), [apps]);
  const [runResult, setRunResult] = useState<StepRunState | null>(null);
  // Re-hydrate nodes+edges only when the workflow id changes identity. Local
  // edits (drag, connect, delete) go through the useNodesState / useEdgesState
  // handles so React Flow's own state stays authoritative during interaction.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-derive layout only on workflow identity change
  const initial = useMemo(() => workflowToFlow(value), [value.id]);
  // The camera to open at, read at mount for the same reason `initial` is: React
  // Flow consumes `defaultViewport` in a mount-only effect (ZoomPane's `XYPanZoom`
  // init), so a fresh object per render would be inert but misleading — and this
  // is what makes a save round-trip not yank the view back.
  // biome-ignore lint/correctness/useExhaustiveDependencies: read at mount only, like `initial`
  const savedViewport = useMemo(() => storedViewport(value), [value.id]);
  // Gates BOTH position writers below (the drag and the pan/zoom). ⚠️ Omitted ⇒
  // **true** (core rfcs/workflow.md · authoring-presentation amendment), so it is
  // read as `!== false` — never `?? false` and never `=== true`. Derived from
  // `value`, deliberately NOT a prop: the flag is a field of the workflow the
  // editor already receives, and a prop would be a second source of truth that
  // can disagree with the persisted document.
  const savePosition = value.settings?.savePosition !== false;
  const [nodes, setNodes, onNodesChange] = useNodesState<StepNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.edges);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editView, setEditView] = useState<EditView>("props");
  // The step id awaiting delete confirmation — one pending slot driving one modal.
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  // Set right after `setNodes(next)` in `performRelayout`, cleared by the
  // `[nodes, fitView]` effect below, which then calls `fitView()`. A ref (not
  // state) because it drives no render of its own — it only needs to survive
  // from the relayout click to the next commit of `nodes`.
  const relayoutPendingFitRef = useRef(false);
  // Carries the flow container div so the capture-phase dblclick listener below
  // can be attached/removed on it directly — see that effect for why a native
  // listener is required instead of React Flow's own node-double-click prop.
  const flowContainerRef = useRef<HTMLDivElement>(null);
  // When a connection drag is released on empty canvas, we open the builder to
  // create a new node and auto-wire it to the handle it was dragged from.
  const [pendingConnect, setPendingConnect] = useState<{
    nodeId: string;
    handleType: "source" | "target";
    position: { x: number; y: number };
    /**
     * The lane the drag originated from, derived via {@link laneForSourceHandle}
     * at CAPTURE time in `onConnectEnd` (T1.1.1) — a target-handle drag reports a
     * handle id that is never `ERROR_SOURCE_HANDLE`, so this naturally reads
     * "success" for that gesture without a separate branch.
     */
    lane: "success" | "error";
  } | null>(null);
  const { screenToFlowPosition, fitView } = useReactFlow();
  // React Flow's `colorMode` defaults to "light", so without this its chrome
  // (controls, minimap mask, handles, edge strokes, background dots) stays in the
  // light palette on a dark canvas. Read the mode from the house hook — the same
  // `data-theme` signal `styles.css` and AppIcon/CodeEditor/JsonEditor already
  // follow — rather than adding a prop the host would have to keep in sync.
  const colorMode = useEffectiveTheme();

  // If the caller swaps in a different workflow, reset local graph state.
  useEffect(() => {
    setNodes(initial.nodes);
    setEdges(initial.edges);
    setSelectedId(null);
    setEditingId(null);
  }, [initial, setNodes, setEdges]);

  const emitChange = useCallback(
    (nextNodes: StepNode[], nextEdges: Edge[]) => {
      onChange(flowToWorkflow(value, nextNodes, nextEdges));
    },
    [value, onChange],
  );

  // Live gate while dragging a connection — React Flow marks the drop invalid
  // (and won't fire onConnect) when this returns false.
  const isValidConnection = useCallback(
    (c: Connection | Edge) => canConnect(c.source, c.target, nodes, edges),
    [nodes, edges],
  );

  const onConnect = useCallback(
    (params: Parameters<typeof addEdge>[0]) => {
      if (readOnly) return;
      // The lane rides on the handle the wire was dragged from (T1.1.1) — the
      // one canonicalisation point, so a handle-to-handle drag and the
      // drag-to-empty-canvas gesture in `onConnectEnd` cannot disagree on what
      // counts as the error port. applyConnect replaces a full single-slot port
      // rather than ignoring the drop.
      const next = applyConnect(
        params.source,
        params.target,
        nodes,
        edges,
        laneForSourceHandle(params.sourceHandle),
      );
      if (!next) {
        // FAIL LOUDLY when the refusal is one the drag could not have shown. Every
        // ordinary rule already ran in `isValidConnection` (React Flow marks the
        // drop invalid and never fires this handler), so the only refusal that
        // reaches here is a duplicate minted id — and that one is *invisible*:
        // React Flow's id-keyed store would have held ONE wire for two edges, which
        // reads as the editor losing the author's work.
        //
        // No new channel: `connectConflict` names the edge already holding the id,
        // and the refusal renders in the edge-lane panel's `role="alert"` slot. The
        // clashing edge is SELECTED — in React Flow's own store, not just our mirror
        // state, so `onSelectionChange` (re-invoked on any re-render) confirms it
        // instead of wiping it before paint — which both reveals that panel and
        // highlights the wire the author has to rename.
        const conflict = connectConflict(
          params.source,
          params.target,
          nodes,
          edges,
          laneForSourceHandle(params.sourceHandle),
        );
        if (!conflict) return;
        setEdges(edges.map((e) => ({ ...e, selected: e.id === conflict })));
        setSelectedEdgeId(conflict);
        setLaneError({
          edgeId: conflict,
          message: idClashMessage(
            "Can’t draw that edge",
            conflict,
            clashInvolvedIds(edges, conflict, params.source, params.target),
          ),
        });
        return;
      }
      setLaneError(null);
      setEdges(next);
      emitChange(nodes, next);
    },
    [edges, nodes, setEdges, emitChange, readOnly],
  );

  // A connection dropped on empty canvas (no valid target) means "add a new node
  // here and connect to it" — open the builder and remember where it came from.
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
      if (readOnly) return;
      // A valid drop onto a handle is already handled by onConnect.
      if (connectionState.isValid) return;
      const fromNode = connectionState.fromNode;
      if (!fromNode) return;
      const handleType = connectionState.fromHandle?.type === "target" ? "target" : "source";
      // Only spawn if the origin handle can participate at all — a source handle
      // needs an exit port, a target handle an entry port. (A full single-slot
      // port is fine: the auto-wire below replaces its existing edge.)
      const originStep = nodes.find((n) => n.id === fromNode.id)?.data.step;
      if (originStep) {
        const p = nodePortsForStep(originStep);
        if ((handleType === "source" ? p.out : p.in) < 1) return;
      }
      const point = "changedTouches" in event ? event.changedTouches[0] : event;
      const position = screenToFlowPosition({ x: point.clientX, y: point.clientY });
      // The lane is derived HERE, not re-derived at `addBuiltStep` time
      // (T1.1.1): the dragged handle is only available on `connectionState`,
      // which does not survive past this callback — the step builder opens in
      // between. A target-handle drag reports a handle id that is never
      // `ERROR_SOURCE_HANDLE`, so this naturally reads "success" for that
      // gesture with no separate branch.
      setPendingConnect({
        nodeId: fromNode.id,
        handleType,
        position,
        lane: laneForSourceHandle(connectionState.fromHandle?.id),
      });
      setBuilderOpen(true);
    },
    [readOnly, screenToFlowPosition, nodes],
  );

  // Deleting a step is confirmed by an in-app modal, never a blocking browser
  // dialog: `deleteStep` is also reached from the canvas keydown handler
  // below, so the confirmation has to be state + a sibling modal.
  // `deleteStep` only *requests* the delete; `performDeleteStep` does it, and
  // is invoked solely from the ConfirmModal's onConfirm.
  const deleteStep = useCallback(
    (id: string) => {
      if (readOnly) return;
      setPendingDelete(id);
    },
    [readOnly],
  );

  const performDeleteStep = useCallback(
    (id: string) => {
      if (readOnly) return;
      const nextNodes = nodes.filter((n) => n.id !== id);
      const nextEdges = edges.filter((e) => e.source !== id && e.target !== id);
      setNodes(nextNodes);
      setEdges(nextEdges);
      if (selectedId === id) setSelectedId(null);
      if (editingId === id) setEditingId(null);
      emitChange(nextNodes, nextEdges);
    },
    [nodes, edges, setNodes, setEdges, emitChange, readOnly, selectedId, editingId],
  );

  // ── Auto-layout (the fourth control button) ─────────────────────────────────
  //
  // Re-flows the CURRENT canvas — including steps added and wires drawn since the
  // last save — through `relayoutNodes`, which is the same layering + the same
  // placement arithmetic `workflowToFlow` runs on first open. Not a second
  // algorithm: "arrange" disagreeing with "how it opened" is the one thing an
  // author notices immediately (D-I0-6 also pins that no layout dependency is
  // added — the layerer already exists).
  //
  // `setNodes` then `emitChange` is what makes the result PERSIST: `flowToWorkflow`
  // stamps each step with its node's rounded coordinate and the host's auto-save
  // writes it, so a reload reopens on the re-flowed graph.
  const performRelayout = useCallback(() => {
    if (readOnly) return;
    const next = relayoutNodes(nodes, edges);
    setNodes(next);
    relayoutPendingFitRef.current = true;
    emitChange(next, edges);
  }, [nodes, edges, setNodes, emitChange, readOnly]);

  // No confirmation (D-T2b): re-flowing is instant, deliberately with no
  // replacement gate — the intake is explicit this click should never warn. See
  // `.ai/conventions.md`'s "No browser dialogs" for the house pattern this is a
  // recorded exception to, not an oversight.
  const requestRelayout = useCallback(() => {
    if (readOnly) return;
    performRelayout();
  }, [readOnly, performRelayout]);

  // Frame the re-flowed graph once React Flow's own node-sync effect (a child of
  // this component) has committed the new positions — that child-before-parent
  // effect ordering is what makes `fitView()` here read POST-relayout bounds
  // instead of the stale pre-relayout ones. Keyed on `[nodes, fitView]` so it
  // re-checks the ref on every nodes commit, not just relayout's — `nodes`
  // itself is unread in the body, only its commit timing matters, so the
  // exhaustive-deps rule can't see why it's there.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `nodes` drives ordering, not the body
  useEffect(() => {
    if (!relayoutPendingFitRef.current) return;
    relayoutPendingFitRef.current = false;
    void fitView({ duration: 300 });
  }, [nodes, fitView]);

  // ── The edge-level lane control (`Run on: Success / Error`) ─────────────────
  // Reuses the selection state that already exists; nothing new is tracked but the
  // refusal message, which renders INLINE in the panel. Never a browser dialog —
  // same rule as the delete confirm above (.ai/conventions.md · No browser dialogs).
  // Scoped to the edge it is about, NOT cleared from `onSelectionChange`: React
  // Flow re-invokes that callback after any re-render (it is an inline lambda, so
  // it re-subscribes), which clears the message before it is ever painted — a
  // refusal that renders for zero frames is the same as failing silently.
  const [laneError, setLaneError] = useState<{ edgeId: string; message: string } | null>(null);
  const selectedEdge = useMemo(
    () => edges.find((e) => e.id === selectedEdgeId) ?? null,
    [edges, selectedEdgeId],
  );

  const setEdgeLane = useCallback(
    (when: "success" | "error") => {
      if (readOnly || !selectedEdgeId) return;
      const me = edges.find((e) => e.id === selectedEdgeId);
      if (!me) return;
      // Choosing the lane it is already on is a no-op — don't emit a change (which
      // would mark the host's workflow dirty for nothing). `setEdgeWhen` is
      // separately safe for this, so neither layer relies on the other.
      if (edgeLane(me) === when) return;
      const conflict = edgeWhenConflict(edges, selectedEdgeId, when, nodes);
      const next = conflict ? null : setEdgeWhen(edges, selectedEdgeId, when, nodes);
      if (!next) {
        // FAIL LOUDLY. The alternative is minting a duplicate edge id, which React
        // Flow's id-keyed store silently collapses — one wire disappearing from the
        // canvas with no error, indistinguishable from the editor losing the work.
        setLaneError({
          edgeId: selectedEdgeId,
          message: conflict
            ? idClashMessage(
                "Can’t switch this edge",
                conflict,
                clashInvolvedIds(edges, conflict, me.source, me.target),
              )
            : "This edge can’t be switched right now.",
        });
        return;
      }
      setLaneError(null);
      setEdges(next);
      // The id encodes the lane, so re-laning re-mints it — move the selection (and
      // therefore this panel) onto the same wire under its new id.
      const relaned = next.find(
        (e) => e.source === me.source && e.target === me.target && edgeLane(e) === when,
      );
      setSelectedEdgeId(relaned?.id ?? null);
      emitChange(nodes, next);
    },
    [edges, nodes, setEdges, emitChange, readOnly, selectedEdgeId],
  );

  const deleteEdge = useCallback(
    (id: string) => {
      if (readOnly) return;
      const nextEdges = edges.filter((e) => e.id !== id);
      if (nextEdges.length === edges.length) return;
      setEdges(nextEdges);
      if (selectedEdgeId === id) setSelectedEdgeId(null);
      emitChange(nodes, nextEdges);
    },
    [nodes, edges, setEdges, emitChange, readOnly, selectedEdgeId],
  );

  const duplicateStep = useCallback(
    (id: string) => {
      if (readOnly) return;
      const src = nodes.find((n) => n.id === id);
      if (!src) return;
      const newId = suggestStepId(
        nodes.map((n) => n.id),
        `${src.data.step.id}_copy`,
      );
      const cloned: FlowStep = { ...structuredClone(src.data.step), id: newId };
      const newNode: StepNode = {
        id: newId,
        type: src.type,
        position: { x: src.position.x + 40, y: src.position.y + 60 },
        data: { step: cloned, isInternal: src.data.isInternal },
      };
      const nextNodes = [...nodes, newNode];
      setNodes(nextNodes);
      setSelectedId(newId);
      emitChange(nextNodes, edges);
    },
    [nodes, edges, setNodes, emitChange, readOnly],
  );

  const addBuiltStep = useCallback(
    (built: BuiltStep): string | undefined => {
      if (readOnly) return undefined;
      const isInternal = isInternalApp(built.uses.app);
      // Derived from the action itself ("data_1", "render_template_1"), not
      // a generic "gate_1"/"step_1" — human override, 2026-08-30: a reader
      // who never renames a step can still orient by its id.
      // `internalNodeLabel` falls back to the bare `action` key for a
      // non-internal (registry) app, since only internal nodes carry a
      // `label` this lookup can find.
      const id = suggestStepId(
        nodes.map((n) => n.id),
        slugifyLabel(internalNodeLabel(built.uses.app, built.uses.action)),
      );
      const step: FlowStep = {
        id,
        uses: built.uses,
        ...(built.with && Object.keys(built.with).length > 0 ? { with: built.with } : {}),
      };
      const newNode: StepNode = {
        id,
        type: isInternal ? "control" : "step",
        // Drop point when spawned from a dragged connection; else a light cascade.
        position: pendingConnect?.position ?? { x: 80, y: 80 + nodes.length * 24 },
        data: { step, isInternal },
      };
      const nextNodes = [...nodes, newNode];

      // Auto-wire the edge back to the handle the drag started from. Dragging a
      // source handle points the edge at the new node; a target handle reverses it.
      // Gated + replacing per the port rules (applyConnect) against the new node.
      let nextEdges = edges;
      if (pendingConnect) {
        const [source, target] =
          pendingConnect.handleType === "target"
            ? [id, pendingConnect.nodeId]
            : [pendingConnect.nodeId, id];
        // The lane captured at drag-release time (T1.1.1) — a step spawned by
        // dragging the error port onto empty canvas is wired error, one spawned
        // from the ordinary exit is wired success.
        nextEdges = applyConnect(source, target, nextNodes, edges, pendingConnect.lane) ?? edges;
      } else {
        // "+ Step" (no drag) — human override, 2026-08-30. A trigger
        // auto-wires to the CURRENT chain root, but ONLY when no trigger
        // exists yet anywhere in the graph; a second trigger is left
        // floating on purpose (nothing to sensibly guess — the author
        // decides if and where it feeds in). A non-trigger step prefers
        // wiring an existing UNCONNECTED trigger forward (the likely intent
        // right after adding one) over extending the current tail.
        const existingTrigger = nodes.find((n) => isTriggerApp(n.data.step.uses.app));
        if (isTriggerApp(built.uses.app)) {
          if (!existingTrigger) {
            const root = findChainRoot(nodes, edges);
            if (root) nextEdges = applyConnect(id, root.id, nextNodes, edges) ?? edges;
          }
        } else {
          const unconnectedTrigger =
            existingTrigger && !edges.some((e) => e.source === existingTrigger.id)
              ? existingTrigger
              : undefined;
          const from = unconnectedTrigger ?? findChainTail(nodes, edges);
          if (from) nextEdges = applyConnect(from.id, id, nextNodes, edges) ?? edges;
        }
      }

      setNodes(nextNodes);
      if (nextEdges !== edges) setEdges(nextEdges);
      setSelectedId(id);
      // Progressive commit (T4.1.1): the builder stays open past this first
      // commit to keep taking edits via `onDraftChange`, so closing is
      // exclusively `onClose`'s job now (wired at the render site below).
      emitChange(nextNodes, nextEdges);
      return id;
    },
    [nodes, edges, setNodes, setEdges, emitChange, readOnly, pendingConnect],
  );

  // Apply an edit to a step, rewiring edges if its id changed.
  const updateStep = useCallback(
    (prevId: string, next: FlowStep) => {
      const idChanged = next.id !== prevId;
      if (idChanged && nodes.some((n) => n.id === next.id)) return; // reject dup id
      const nextNodes = nodes.map((n) =>
        n.id === prevId
          ? {
              ...n,
              id: next.id,
              data: { step: next, isInternal: isInternalApp(next.uses.app) },
            }
          : n,
      );
      if (idChanged) {
        // Re-point the endpoints AND re-mint each id in the edge's own lane. This
        // used to rebuild every id unqualified, dropping an error edge's `:error`
        // suffix so a same-target success+error pair collapsed into one edge in
        // React Flow's id-keyed store. The lane-aware rewrite lives in
        // `flow-connect.ts` and mints ids through the one shared `flowEdgeId`
        // helper — never a second copy of the template.
        const nextEdges = renameStepInEdges(edges, prevId, next.id);
        setNodes(nextNodes);
        setEdges(nextEdges);
        if (selectedId === prevId) setSelectedId(next.id);
        if (editingId === prevId) setEditingId(next.id);
        emitChange(nextNodes, nextEdges);
        return;
      }
      setNodes(nextNodes);
      emitChange(nextNodes, edges);
    },
    [nodes, edges, setNodes, setEdges, selectedId, editingId, emitChange],
  );

  // Remember the values a Run was made with, then record the run AGAINST that
  // fixture — the same two-call sequence the Test path uses (`StepTestRun` in
  // StepBuilderModal), so a Run and a Test write the same kind of `step_tests`
  // row for the same step and each surface pre-fills from whichever ran last.
  //
  // The `stepTestId` is the load-bearing half: `recordStepTestRun` only updates
  // the fixture's `last_run_*` columns when it is present, and this call used to
  // post without one — so a canvas run was logged but never written back onto
  // the fixture. Best-effort throughout: a persist failure is logged and never
  // surfaces as a failed run.
  //
  // The two calls fail INDEPENDENTLY, and deliberately so: remembering the
  // values and recording that the run happened are different obligations, and
  // only the first can fail on its own (`POST …/tests` 404s on an unknown
  // workflow, `POST …/test-runs` does not). Folding both into one `try` would
  // make a fixture-save failure swallow the run's `step_test_runs` row *and* the
  // `run_log` ledger row the server writes per POST — i.e. silently lose run
  // history over a persistence hiccup. So a failed save degrades to
  // `stepTestId: null`: a run recorded with no fixture attached, which is
  // exactly what the route already accepts (step-test-runs.ts).
  const persistStepRun = useCallback(
    (
      stepId: string,
      fixture: { input: Record<string, unknown>; with: Record<string, unknown> },
      outcome: { status: string; output?: unknown; error?: unknown },
    ) => {
      void (async () => {
        const saved = await api.saveStepTest(value.id, stepId, fixture).catch((err) => {
          console.error("step run fixture save failed", err);
          return null;
        });
        await api.recordStepTestRun(value.id, stepId, {
          stepTestId: saved?.id ?? null,
          status: outcome.status,
          input: fixture.input,
          output: outcome.output,
          error: outcome.error,
        });
      })().catch((err) => {
        console.error("step run persist failed", err);
      });
    },
    [api, value.id],
  );

  // Test-running one step is two-phase, mirroring delete's request/perform split:
  // `runStep` (the ▶ control) only *opens* the collect phase, and
  // `performRunStep` — reached solely from the collect form's Run button — does
  // the invoke with the values the user just filled in. Control steps aren't
  // invocable. Signature is unchanged: `onRun` is still `(id: string) => void`.
  const runStep = useCallback(
    (id: string) => {
      const node = nodes.find((n) => n.id === id);
      // Flow-control nodes can't run standalone; app + compute/trigger nodes can.
      if (!node || isControlApp(node.data.step.uses.app)) return;
      setRunResult({ stepId: id, status: "collect" });
    },
    [nodes],
  );

  // Invoke one step through the invoke API with the properties collected in the
  // modal's collect phase, and (for action steps) its stored connection.
  //
  // `state` is the run's START STATE — what the upstream steps last produced —
  // and it is NOT params: it goes out as the invoke body's own `state` field so
  // the server can resolve `{{ steps.<id>.output.<field> }}` in the step's
  // `with`. Sending it as params would do nothing: the runtime copies only
  // DECLARED params and drops the rest (`core/runtime/src/resolve.ts`).
  const performRunStep = useCallback(
    async (id: string, values: Record<string, unknown>, state?: StepStartState) => {
      const node = nodes.find((n) => n.id === id);
      if (!node) return;
      const step = node.data.step;
      const isTrigger = isTriggerApp(step.uses.app);
      // A trigger's filled fields ARE the run's starting state: the handler
      // returns `params.input` verbatim, so anything else comes back `{}`. Every
      // other step is ALREADY CONFIGURED — `values` is the incoming state the
      // collect form asked for, merged over the step's STORED `with`, which is
      // exactly the payload the Test tab sends (`testValues`). The stored `with`
      // is read, never written: a run does not rewrite the step's configuration.
      const payload = isTrigger ? { input: values } : { ...(step.with ?? {}), ...values };
      // The fixture saved alongside the run, in the same two slots the Test tab
      // writes: `input` is the run's incoming state — for a trigger its filled
      // values *are* it, for every other step it is what the incoming-state box
      // held — and `with` is the full set of params the call was made with.
      const fixture = isTrigger
        ? { input: values, with: values }
        : { input: values, with: payload };
      setRunResult({ stepId: id, status: "running" });
      try {
        const result = await api.invokeAction(step.uses.app, step.uses.action, payload, {
          ...(step.uses.connection ? { connectionId: step.uses.connection } : {}),
          // Scope document expressions to the workflow's selected project (T2.1.2).
          project,
          // Omitted when nothing upstream has a saved output, so a run with no
          // seed sends exactly the request it sent before.
          ...(state ? { state } : {}),
        });
        // Script nodes may return captured console output alongside the value.
        const logs = (result as { logs?: string[] }).logs;
        setRunResult({ stepId: id, status: "done", value: result.value, logs });
        // Remember the values and log the run against the fixture they were
        // saved as (best-effort — never fail the run over it).
        persistStepRun(id, fixture, { status: "succeeded", output: result.value });
      } catch (e) {
        // The api client wraps network/parse failures with context; duck-type the
        // code so the modal can show it next to the message.
        const err = e as { message?: string; code?: string };
        setRunResult({
          stepId: id,
          status: "error",
          error: err.message ?? String(e),
          errorCode: err.code,
        });
        // A failed run still remembers what was entered — the operator's next
        // attempt starts from the values that failed, not from blank.
        persistStepRun(id, fixture, { status: "failed", error: err.message ?? String(e) });
      }
    },
    [nodes, api, persistStepRun, project],
  );

  const controls = useMemo<StepControls>(
    () => ({
      onEdit: (id) => {
        setEditView("props");
        setEditingId(id);
      },
      onEditJson: (id) => {
        setEditView("json");
        setEditingId(id);
      },
      onRun: runStep,
      onDuplicate: duplicateStep,
      onDelete: deleteStep,
      readOnly,
    }),
    [runStep, duplicateStep, deleteStep, readOnly],
  );

  // Opens the step editor on a canvas node double-click — deliberately NOT
  // React Flow's own node-double-click prop on `<ReactFlow>` below. That prop
  // fires from React's root container, an ANCESTOR of `.react-flow__pane` under
  // React 18's event delegation, so it always loses the race to the pane's own
  // native `dblclick.zoom` listener and can't stop it. A capture-phase listener
  // on this container fires first instead.
  //
  // The guard matters specifically in `readOnly`: `nodesDraggable={!readOnly}`
  // below drops `nopan` from the node wrapper's class list for a non-draggable
  // node, and for THIS scenario — a non-wheel double-click with no active
  // selection or connection in progress — `@xyflow/system`'s zoom filter's
  // remaining check is `.nopan` — so without this listener winning the race,
  // a viewer's double-click silently zooms the canvas instead of opening the
  // modal.
  useEffect(() => {
    const div = flowContainerRef.current;
    if (!div) return;
    const handler = (e: MouseEvent) => {
      const card = (e.target as HTMLElement).closest(".react-flow__node");
      if (!card) return; // not over a node — let the pane's own dblclick-zoom run
      const id = card.getAttribute("data-id");
      if (!id) return;
      // CAPTURE phase (registered below) is what makes this run before the
      // pane's bubble-phase `dblclick.zoom` listener; stopping it here is what
      // actually suppresses the zoom.
      e.stopPropagation();
      // Same transition the node toolbar's pencil button performs — no new
      // plumbing, `controls` already carries `onEdit`.
      controls.onEdit(id);
    };
    div.addEventListener("dblclick", handler, true);
    return () => div.removeEventListener("dblclick", handler, true);
  }, [controls]);

  const editingStep = nodes.find((n) => n.id === editingId)?.data.step ?? null;
  // The step the run modal is open on, resolved live so the collect phase reads
  // the current `with` (a trigger's declared `fields`) rather than a snapshot.
  const runningStep = runResult
    ? (nodes.find((n) => n.id === runResult.stepId)?.data.step ?? null)
    : null;
  // Phase 1 of the run modal: collect the run's incoming state, nothing invoked
  // yet. The collect form offers the same upstream seed chips the Test tab does,
  // so it needs the RUNNING step's graph ancestors — the step editor's own
  // `upstreamState` below is computed for `editingId`, a different step.
  const collecting = runResult?.status === "collect" && !!runningStep;
  const runUpstreamSteps = useMemo(
    () => (runResult ? upstreamStateSources(runResult.stepId, nodes, edges).steps : []),
    [runResult, nodes, edges],
  );

  const nodeTypes = useMemo(
    () => ({
      step: StepNodeCard,
      control: ControlNodeCard,
    }),
    [],
  );

  // The workflow state in scope for the step being edited: its upstream steps'
  // outputs (`steps.<id>.output`) and, if a trigger precedes it, `trigger.event`.
  const upstreamState = useMemo(
    () => upstreamStateSources(editingId, nodes, edges),
    [editingId, nodes, edges],
  );
  // A stable identity for *which* steps are upstream. The memo above rebuilds on
  // every node drag and every field edit; this string changes only when the SET
  // does, so the fetch below doesn't re-run on each keystroke.
  const upstreamIdsKey = JSON.stringify(upstreamState.steps.map((s) => s.id));

  // Design-time sample values for the expression editor's Result pane: what each
  // upstream step's LAST TEST RUN actually captured, flattened onto the very refs
  // the picker inserts (`steps.<id>.output` and `steps.<id>.output.<field>`). Read
  // from the saved fixtures (`StepTest.lastRunOutput`), so it survives a reload.
  //
  // ⚠️ EDITOR-SIDE ONLY, like `upstreamStateSources` above: this is a PREVIEW of
  // values a past test produced. It is not what a full run resolves — nothing here
  // is sent to the engine.
  const [stepSampleValues, setStepSampleValues] = useState<Record<string, unknown>>({});
  useEffect(() => {
    const ids = JSON.parse(upstreamIdsKey) as string[];
    if (!editingId || ids.length === 0) {
      setStepSampleValues({});
      return;
    }
    let canceled = false;
    // Best-effort, per step: a failed or empty list contributes no entry and never
    // breaks the picker — the same shape as the step editor's seed effect.
    Promise.all(
      ids.map(async (id) => {
        try {
          const tests = await api.listStepTests(value.id, id);
          // `listStepTests` is oldest-first, so the LAST entry is the most recent
          // fixture — the "latest" convention this file already uses twice.
          const latest = tests.length ? tests[tests.length - 1] : null;
          return latest ? { id, output: latest.lastRunOutput } : null;
        } catch {
          return null;
        }
      }),
    ).then((res) => {
      // LOAD-BEARING, and its failure mode is silent: without this guard a slow
      // list that resolves after the editor was closed and reopened overwrites
      // the fresh samples with the ones it read before — the pane then previews a
      // POPULATED, STALE value, which is worse than showing none. Pinned by
      // `artifacts/T5.1.3-r2-checks.sh` §X (mutant M11).
      if (canceled) return;
      const next: Record<string, unknown> = {};
      for (const r of res) {
        if (!r || r.output === undefined || r.output === null) continue;
        // The whole output is a ref on its own…
        next[`steps.${r.id}.output`] = r.output;
        // …and so is each own key of a plain object. Values pass through
        // unstringified — the modal's `effectiveSamples` stringifies non-strings.
        if (typeof r.output === "object" && !Array.isArray(r.output)) {
          for (const [k, v] of Object.entries(r.output as Record<string, unknown>)) {
            next[`steps.${r.id}.output.${k}`] = v;
          }
        }
      }
      setStepSampleValues(next);
    });
    return () => {
      canceled = true;
    };
  }, [api, value.id, editingId, upstreamIdsKey]);

  // …merged with the host-supplied vars/secrets/sealSecret so the expression
  // editor's left panel shows every source at once.
  //
  // `ExpressionOptionsProvider` below LAYERS over whatever this editor is
  // mounted under, so the project's vars/secrets/documents arrive on their own
  // and need not be restated here — the `exprOptions` PROP is now only for a
  // host that wants to override or add something at this level.
  //
  // `sampleValues` is the one key that must UNION rather than replace, and that
  // is why the inherited scope is read explicitly: three disjoint ref
  // namespaces contribute to it (`vars.*`/`documents.*` from the app shell,
  // anything the prop adds, and `steps.*` computed here), and layering alone
  // would let the object built below shadow the inherited one wholesale.
  const inheritedExprOptions = useExpressionOptions();
  const mergedExprOptions = useMemo<ExpressionOptions>(
    () => ({
      ...(exprOptions ?? {}),
      steps: upstreamState.steps,
      hasTrigger: upstreamState.hasTrigger,
      sampleValues: {
        ...(inheritedExprOptions.sampleValues ?? {}),
        ...(exprOptions?.sampleValues ?? {}),
        ...stepSampleValues,
      },
    }),
    [exprOptions, inheritedExprOptions.sampleValues, upstreamState, stepSampleValues],
  );

  return (
    <StepControlsCtx.Provider value={controls}>
      <AppsCtx.Provider value={appsById}>
        <WorkflowProjectProvider project={project}>
          <ExpressionOptionsProvider value={mergedExprOptions}>
            <div
              ref={flowContainerRef}
              className="w6w-flow"
              style={{ width: "100%", height, position: "relative" }}
              onKeyDown={(e) => {
                if (e.key !== "Backspace" && e.key !== "Delete") return;
                // Only delete the selected node/edge when the key is aimed at the
                // canvas — never while a modal is open or the user is editing a field.
                // The modal <dialog> is a DOM descendant here, so its keystrokes
                // bubble up; without this guard, backspacing a typo deletes a node.
                if (editingId || builderOpen || (!selectedId && !selectedEdgeId)) return;
                const t = e.target as HTMLElement;
                if (
                  t.isContentEditable ||
                  t.tagName === "INPUT" ||
                  t.tagName === "TEXTAREA" ||
                  t.tagName === "SELECT" ||
                  t.closest("dialog, .w6w-modal") !== null
                ) {
                  return;
                }
                e.preventDefault();
                // A selected node takes precedence (its confirm); else drop the edge.
                if (selectedId) deleteStep(selectedId);
                else if (selectedEdgeId) deleteEdge(selectedEdgeId);
              }}
            >
              <ReactFlow
                nodes={nodes}
                edges={edges}
                // Straight segments with right-angle corners, not the library's
                // default bezier curve — reads clearer on a wide, branchy graph
                // than a sweeping curve does. One place: no edge object sets its
                // own `type`, so this alone governs every edge on the canvas.
                // `connectionLineType` matches it for the in-progress drag line,
                // so the preview doesn't curve while the settled edge won't.
                defaultEdgeOptions={{ type: "smoothstep" }}
                connectionLineType={ConnectionLineType.SmoothStep}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onConnectEnd={onConnectEnd}
                isValidConnection={isValidConnection}
                // A finished drag is what makes a new coordinate stick: until this
                // existed, dragging went only through `onNodesChange` and never
                // marked the workflow changed, so the position was lost on reload.
                // `flowToWorkflow` (inside `emitChange`) does the conversion and the
                // rounding — nothing is converted here.
                //
                // Drag STOP, never `onNodeDrag`: the per-frame variant fires on every
                // animation frame of the gesture, and the host's auto-save is a
                // trailing debounce over emitted changes, so a per-frame emit is a
                // write storm by construction.
                //
                // No `readOnly` term is needed: `nodesDraggable={!readOnly}` below
                // means React Flow never starts the drag, so this cannot fire at all
                // in a read-only editor. Measured, not assumed — the probe's readOnly
                // fixture asserts the node does not move (F4-V1).
                onNodeDragStop={() => {
                  if (!savePosition) return;
                  emitChange(nodes, edges);
                }}
                onMoveEnd={(event, viewport) => {
                  // FIRST statement, and load-bearing. React Flow passes
                  // `event === null` when the move was NOT user-initiated
                  // (@xyflow/react 12.11.1, `types/component-props.d.ts` on
                  // `onMoveEnd`: "If the movement is not user-initiated, the event
                  // parameter will be `null`."). The `fitView` on open is exactly
                  // such a move — without this guard every open would emit a change,
                  // and with the host's auto-save every page load would be a write.
                  if (!event) return;
                  // `readOnly` is checked here and NOT delegated, because — unlike a
                  // drag — panning and zooming stay enabled in a read-only editor (see
                  // the prop's docstring), so this handler really does fire and a
                  // viewer must not write to what they are only looking at.
                  if (readOnly) return;
                  // `savePosition` is deliberately NOT re-checked here: `withViewport`
                  // is the single place that reads the flag for this path and returns
                  // its argument unchanged when it is off, so a duplicate term would be
                  // unobservable — measured as a surviving mutant (T3.3.2-mutants.sh
                  // C5) and removed rather than shipped as an unpinnable branch.
                  //
                  // Emit ONLY when `withViewport` hands back a different reference:
                  // it returns `value`'s base unchanged when the rounded viewport
                  // already equals the stored one, so a pan that lands back where it
                  // started emits nothing. Rate is bounded by the gesture, not the
                  // frame — `onMoveEnd` is d3-zoom's terminal event, and
                  // `@xyflow/system` additionally coalesces scroll-driven pans behind
                  // a 150ms trailing timer of its own (no timer belongs here).
                  const base = flowToWorkflow(value, nodes, edges);
                  const next = withViewport(base, viewport);
                  if (next !== base) onChange(next);
                }}
                onSelectionChange={({ nodes: sel, edges: edgeSel }) => {
                  setSelectedId(sel[0]?.id ?? null);
                  setSelectedEdgeId(edgeSel[0]?.id ?? null);
                  // Deliberately NOT clearing `laneError` here — see its declaration.
                }}
                nodeTypes={nodeTypes}
                nodesDraggable={!readOnly}
                nodesConnectable={!readOnly}
                elementsSelectable
                // Reopen at the camera the author left, when the workflow stores one;
                // otherwise fit the graph exactly as before. The two props are spread
                // in so only ONE of them is ever passed: they are mutually exclusive
                // by the library's own rule — "If a default viewport is provided but
                // `fitView` is enabled, the default viewport will be ignored"
                // (`types/component-props.d.ts` on `defaultViewport`) — and a stray
                // `fitView` would silently discard the restored view.
                {...(savedViewport ? { defaultViewport: savedViewport } : { fitView: true })}
                // Deletion is owned solely by the guarded onKeyDown handler above
                // (canvas-only, with a confirm). Disable React Flow's built-in
                // Backspace/Delete so it can't silently remove a node — e.g. while a
                // modal is open or the user is editing a field.
                deleteKeyCode={null}
                colorMode={colorMode}
                proOptions={{ hideAttribution: true }}
              >
                <Background gap={16} />
                {/* `showInteractive={false}` still suppresses the lock button; the
                    child is appended AFTER the three built-ins (zoom in / zoom out /
                    fit view), so auto-layout reads as the fourth control in the same
                    stack — "beside the zoom controls", not a floating panel. It
                    carries NO colour, background or border of its own: the
                    `--xy-controls-button-*` → `--w6w-*` bridge in `styles.css` sets
                    inherited custom properties on the `.w6w-flow` wrapper, so any
                    control button added later is themed for free (measured in both
                    stylesheet orders — T3.1.1's evaluation built this exact shape). */}
                <Controls showInteractive={false}>
                  {!readOnly && (
                    <ControlButton
                      onClick={requestRelayout}
                      title="Auto-layout — re-flow the graph into columns"
                      aria-label="Auto-layout the graph"
                    >
                      <AutoLayoutIcon />
                    </ControlButton>
                  )}
                </Controls>
                <MiniMap pannable zoomable style={{ background: "var(--w6w-panel-2)" }} />
                {!readOnly && (
                  <Panel position="top-left">
                    <button type="button" className="w6w-btn" onClick={() => setBuilderOpen(true)}>
                      + Step
                    </button>
                  </Panel>
                )}
                {/* Which outcome the selected edge carries (core rfcs/workflow.md ·
                    `Edge.when`). Revealed only when exactly ONE edge is selected —
                    `selectedEdgeId` is already `edgeSel[0]`, so selecting a node or
                    nothing hides it. top-left is `+ Step`, Controls are bottom-left,
                    the MiniMap bottom-right. D-T1-7 SUPERSEDED (T1.1.1): id'd source
                    handles now exist (the error exit port), so a fresh edge's lane IS
                    chosen by which handle it was dragged from — this panel keeps its
                    job as the RE-LANE affordance for an edge already drawn on the
                    wrong port, not the only way to author an error edge. */}
                {!readOnly && selectedEdge && (
                  <Panel position="top-right">
                    <div className="w6w-edge-lane">
                      <span className="w6w-muted w6w-small">Run on</span>
                      {(["success", "error"] as const).map((lane) => (
                        <button
                          key={lane}
                          type="button"
                          className={`w6w-btn w6w-btn-sm w6w-btn-ghost${
                            edgeLane(selectedEdge) === lane ? " active" : ""
                          }`}
                          aria-pressed={edgeLane(selectedEdge) === lane}
                          title={LANE_HINT}
                          onClick={() => setEdgeLane(lane)}
                        >
                          {lane === "success" ? "Success" : "Error"}
                        </button>
                      ))}
                      {laneError?.edgeId === selectedEdge.id && (
                        <span className="w6w-edge-lane-err w6w-small" role="alert">
                          {laneError.message}
                        </span>
                      )}
                    </div>
                  </Panel>
                )}
              </ReactFlow>

              {builderOpen && (
                <StepBuilderModal
                  onClose={() => {
                    setBuilderOpen(false);
                    setPendingConnect(null);
                  }}
                  onAdd={addBuiltStep}
                  // Progressive commit (T4.1.1): once `addBuiltStep` has minted
                  // the step's id, every subsequent field change updates that
                  // same node instead of waiting for a final "Add step" click.
                  onDraftChange={(id, next) => updateStep(id, { id, ...next })}
                  workflowId={value.id}
                  // The new step's known upstream ancestors, from the handle a
                  // connection drag was released from (T1.1.1) — so the builder's
                  // own Test tab can seed `{{ steps.<id>.output.<field> }}` the
                  // same way the step editor's Test tab already does.
                  upstreamSteps={stepBuilderUpstreamSteps(pendingConnect, nodes, edges)}
                />
              )}

              {editingStep && editingId && (
                // No `key` on purpose: renaming a step updates `editingId`, and a keyed
                // remount would drop focus mid-keystroke. The modal seeds its own state
                // once and unmounts (editingId → null) between edits of different nodes.
                <StepEditModal
                  workflowId={value.id}
                  step={editingStep}
                  // Graph ancestors of the editing step, from `upstreamStateSources`
                  // (via `mergedExprOptions`) — the incoming-state picker seeds from
                  // each ancestor's latest saved step-test rather than re-walking the graph.
                  upstreamSteps={mergedExprOptions.steps ?? []}
                  readOnly={readOnly}
                  initialView={editView}
                  onChange={(next) => updateStep(editingId, next)}
                  onClose={() => setEditingId(null)}
                />
              )}

              {runResult && (
                <Modal
                  title={`${collecting ? "Run step" : "Test run"}: ${runResult.stepId}`}
                  onClose={() => setRunResult(null)}
                >
                  {collecting && runningStep && (
                    <StepRunCollect
                      // Keyed on the step so switching nodes re-seeds the form.
                      key={runResult.stepId}
                      workflowId={value.id}
                      step={runningStep}
                      upstreamSteps={runUpstreamSteps}
                      onCancel={() => setRunResult(null)}
                      onRun={(values, state) => performRunStep(runResult.stepId, values, state)}
                    />
                  )}
                  {runResult.status === "running" && (
                    <p className="w6w-muted w6w-small">Running…</p>
                  )}
                  {runResult.status === "error" && (
                    <div className="w6w-result w6w-error">
                      {runResult.errorCode && (
                        <div className="w6w-small" style={{ opacity: 0.75, marginBottom: 4 }}>
                          <code>{runResult.errorCode}</code>
                        </div>
                      )}
                      {runResult.error || "The step failed with no error message."}
                    </div>
                  )}
                  {runResult.status === "done" && (
                    <div>
                      <div className="w6w-muted w6w-small" style={{ marginBottom: 6 }}>
                        Result
                      </div>
                      <pre
                        className="w6w-result"
                        style={{
                          whiteSpace: "pre-wrap",
                          maxHeight: 360,
                          overflow: "auto",
                          margin: 0,
                        }}
                      >
                        {JSON.stringify(runResult.value, null, 2)}
                      </pre>
                    </div>
                  )}
                  {runResult.logs && runResult.logs.length > 0 && (
                    <div>
                      <div className="w6w-muted w6w-small" style={{ margin: "10px 0 6px" }}>
                        Console output
                      </div>
                      <pre
                        className="w6w-result"
                        style={{
                          whiteSpace: "pre-wrap",
                          maxHeight: 200,
                          overflow: "auto",
                          margin: 0,
                        }}
                      >
                        {runResult.logs.join("\n")}
                      </pre>
                    </div>
                  )}
                  {/* The collect phase renders its own actions (Run + Cancel),
                      gated on the required fields being filled. */}
                  {!collecting && (
                    <div className="w6w-modal-actions">
                      <button type="button" className="w6w-btn" onClick={() => setRunResult(null)}>
                        Close
                      </button>
                    </div>
                  )}
                </Modal>
              )}

              {pendingDelete !== null && (
                <ConfirmModal
                  title="Delete step"
                  message={`Delete step "${pendingDelete}"? Its connections are removed too.`}
                  confirmLabel="Delete"
                  onConfirm={() => {
                    performDeleteStep(pendingDelete);
                    setPendingDelete(null);
                  }}
                  onClose={() => setPendingDelete(null)}
                />
              )}
            </div>
          </ExpressionOptionsProvider>
        </WorkflowProjectProvider>
      </AppsCtx.Provider>
    </StepControlsCtx.Provider>
  );
}

/**
 * Parse the incoming-state box into the object it stands for. Anything that is
 * not a JSON **object** — unparseable, an array, a scalar, `null` — is not a
 * state at all and reads as `null`, which the callers turn into "merge nothing"
 * (Test) or "don't run" (▶ Run, a real execution).
 */
function parseStateOverride(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * The **incoming state** control — the one implementation behind both the step
 * editor's Test tab and the canvas ▶ Run collect form for a non-trigger step.
 * What varies between two runs of an already-configured step is the data
 * arriving at it, not its parameters, so this is what both surfaces collect.
 *
 * The raw JSON box is an **override** and is titled as one: it sits behind a
 * closed disclosure so neither surface opens on a JSON textarea, while the
 * upstream seed chips stay in plain sight above it. The disclosure opens by
 * itself whenever an override actually exists — seeded from a chip, remembered
 * from the last run, or typed — so an active override is never hidden.
 *
 * ⚠️ This component says nothing about what a **production** run resolves; it
 * collects what the test/run call is given.
 */
function IncomingStateField({
  text,
  onChange,
  seeds,
  readOnly,
}: {
  /** Raw JSON text of the override. `{}` (the default) means "no override". */
  text: string;
  onChange: (next: string) => void;
  seeds: SeedSource[];
  readOnly?: boolean;
}) {
  const parsed = parseStateOverride(text);
  const keyCount = parsed ? Object.keys(parsed).length : 0;
  const hasOverride = keyCount > 0;
  const [open, setOpen] = useState(hasOverride);
  // An override usually arrives AFTER this field has mounted — the Test tab's
  // remembered-state effect (`StepEditModal`) sets the text a network hop later
  // — and `useState`'s argument is a MOUNT-TIME value that never re-derives. Do
  // not collapse this back into the initial value: with `listStepTests` delayed
  // 900 ms, that left a remembered override IN EFFECT behind a CLOSED
  // disclosure (measured in T6.1.1's evaluation; ▶ Run escaped it only because
  // it withholds the whole form until its fixture has loaded). Only the
  // "nothing → something" transition reopens it, so a disclosure the operator
  // closed themselves stays closed while they keep typing in it.
  useEffect(() => {
    if (hasOverride) setOpen(true);
  }, [hasOverride]);
  // Seeding from an ancestor uses the output its last run captured; only a
  // fixture that never ran falls back to its own captured incoming state.
  const seedFrom = (test: StepTest) => {
    onChange(JSON.stringify(test.lastRunOutput ?? test.input ?? {}, null, 2));
    setOpen(true);
  };
  return (
    <div className="w6w-field w6w-incoming-state">
      <span>Incoming state</span>
      {seeds.length > 0 && (
        <div className="w6w-seed-picker">
          <div className="w6w-seed-chips">
            {seeds.map((s) => (
              <button
                key={s.stepId}
                type="button"
                className="w6w-chip w6w-seed-chip"
                title={`Use ${s.label}'s saved test as the incoming state`}
                disabled={readOnly}
                onClick={() => seedFrom(s.test)}
              >
                <code>{s.label}</code>
                {s.test.lastRunStatus ? (
                  <span className="w6w-muted w6w-small">
                    {" · "}
                    {s.test.lastRunStatus}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      )}
      <details
        className="w6w-state-override"
        open={open}
        onToggle={(e) => setOpen(e.currentTarget.open)}
      >
        <summary>
          Override the incoming state
          {keyCount > 0 ? ` · ${keyCount} key${keyCount === 1 ? "" : "s"} set` : ""}
        </summary>
        <textarea
          rows={3}
          value={text}
          readOnly={readOnly}
          spellCheck={false}
          aria-label="Incoming state override (JSON)"
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="w6w-hint">
          JSON merged into the call (e.g. a script's <code>input</code>). Reach for this to test
          against a state the flow cannot currently produce — a field no upstream step returns yet,
          or a case you can't reproduce by running the flow.
        </span>
      </details>
    </div>
  );
}

/**
 * Phase 1 of the canvas ▶ run: **collect the run's incoming state**, then hand
 * it to the host to invoke. Rendered inside the run modal, which is the chrome.
 *
 * Two shapes, because the two kinds of step start from different things:
 *  - a **trigger** has no incoming state — it *is* the start — so it projects
 *    its configured `fields` *definitions* into params (`fieldsToParams`), seeds
 *    from their declared defaults (`seedValues`) and renders them through
 *    {@link PropertyEntryForm} (chrome-less by contract, so it is mounted bare
 *    here). The filled values become the run's starting state (`{ input }`), and
 *    the step's **last saved values** come back pre-filled on top (T4.1.3).
 *  - **everything else** is already configured, and what changes between two
 *    runs is the data arriving at it. So it collects exactly what the Test tab
 *    collects — {@link IncomingStateField}, the same component — and runs the
 *    step with its **stored** `with` underneath. The configuration is not
 *    re-collected here and is never rewritten by a run (R-I-1: the ▶ modal used
 *    to render the Configure form).
 *
 * The trigger check comes first on purpose: a trigger *is* an internal node, and
 * its internal schema is the `fields` **editor**, not the fields themselves.
 *
 * `params` is fetched on **both** paths — a trigger renders them, and a
 * non-trigger needs them for the same required-params gate the Test tab applies
 * to `{...step.with, ...state}`. An app action fetches its action definition
 * exactly as `StepEditModal` does, showing "Loading parameters…" until it lands.
 */
function StepRunCollect({
  workflowId,
  step,
  upstreamSteps,
  onRun,
  onCancel,
}: {
  /** Fixture key, with `step.id` — where the remembered values are read from. */
  workflowId: string;
  step: FlowStep;
  /** Graph ancestors of this step; their saved tests are offered as seeds. */
  upstreamSteps: ExpressionStepSource[];
  /**
   * Fired when the user presses Run — with the trigger's filled values, or (for
   * every other step) the incoming-state override alone, plus the start state
   * seeded from the upstream steps' saved outputs (so the step's own
   * `{{ steps.<id>.output.<field> }}` references resolve). The two are
   * different things and stay separate: `values` are params, `state` is scope.
   */
  onRun: (values: Record<string, unknown>, state?: StepStartState) => void;
  onCancel: () => void;
}) {
  const api = useW6WApi();
  const isTrigger = isTriggerApp(step.uses.app);
  const isInternal = isInternalApp(step.uses.app);
  const defs = useMemo(
    () => (isTrigger ? asFieldDefs(step.with?.fields) : []),
    [isTrigger, step.with],
  );

  // Known synchronously for triggers and internal nodes; `null` means "an app
  // action, still to be fetched" so only that path shows a loading line.
  const localParams = useMemo<ActionParam[] | null>(() => {
    if (isTrigger) return fieldsToParams(defs);
    if (isInternal) return internalNodeParams(step.uses.app, step.uses.action);
    return null;
  }, [isTrigger, isInternal, defs, step.uses.app, step.uses.action]);
  const [fetched, setFetched] = useState<ActionParam[] | null>(null);
  const params = localParams ?? fetched;

  // Mirrors StepEditModal's "refetch actions + params" effect rather than
  // inventing a second fetch pattern.
  useEffect(() => {
    if (localParams) return;
    if (!step.uses.app || !step.uses.action) {
      setFetched([]);
      return;
    }
    let canceled = false;
    setFetched(null);
    api
      .getAppActions(step.uses.app)
      .then((acts) => {
        if (canceled) return;
        setFetched(acts.find((a) => a.key === step.uses.action)?.params ?? []);
      })
      .catch(() => !canceled && setFetched([]));
    return () => {
      canceled = true;
    };
  }, [api, localParams, step.uses.app, step.uses.action]);

  // THE TRIGGER PATH's value bag, seeded once from its declared defaults.
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    isTrigger ? seedValues(asFieldDefs(step.with?.fields)) : {},
  );
  // EVERY OTHER STEP's collect surface: the incoming-state override, as raw
  // JSON text — the same thing the Test tab collects, in the same component.
  const [stateText, setStateText] = useState("{}");
  const seeds = useSeedSources(workflowId, upstreamSteps, !isTrigger);
  // The same fixtures the chips offer, projected into the run's start state —
  // one source, so what the chips SAY is upstream is what the run is GIVEN.
  const startState = startStateFromSeeds(seeds);

  // …then layered with what was entered the last time this step was tested or
  // run. `listStepTests` is oldest-first, so the LAST entry is the most recent
  // fixture — the same convention the step editor's upstream-seed effect uses.
  // Which slot is remembered follows what the surface collects: a trigger's
  // filled fields live in the fixture's `with`, an ordinary step's incoming
  // state in its `input` (that is what the Test tab writes there too).
  // An `ExprValue` (`{type:"expr",…}`) round-trips untouched: `FxField` derives
  // expression mode from the value, so it comes back as a chip, not as text.
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    let canceled = false;
    api
      .listStepTests(workflowId, step.id)
      .then((tests) => {
        if (canceled) return;
        const latest = tests.length ? tests[tests.length - 1] : null;
        if (isTrigger) {
          if (latest?.with) setValues((v) => ({ ...v, ...latest.with }));
        } else if (latest?.input && Object.keys(latest.input).length > 0) {
          setStateText(JSON.stringify(latest.input, null, 2));
        }
        setSeeded(true);
      })
      // Never block or break the form: no fixture (or a failed list) just leaves
      // the declared defaults in place, silently.
      .catch(() => {
        if (!canceled) setSeeded(true);
      });
    return () => {
      canceled = true;
    };
  }, [api, workflowId, step.id, isTrigger]);

  // A raw-JSON draft that is not a values map (unparseable, or an array/scalar/
  // `null`) never reaches `values` — the entry form holds it back and says so
  // here. Run is a REAL execution, so it must not silently run the *previous*
  // payload while the operator is looking at a different one. The same applies
  // to the incoming-state box, which is parsed by the same rule.
  const [draftValid, setDraftValid] = useState(true);
  const state = parseStateOverride(stateText);
  const validDraft = isTrigger ? draftValid : state !== null;
  // What the run will actually be given. A non-trigger runs on its STORED
  // configuration with the incoming state merged over it — byte-for-byte what
  // the Test tab sends — so the required-params gate is applied to that, not to
  // the override alone. Never a second required-check.
  const effective = isTrigger ? values : { ...(step.with ?? {}), ...(state ?? {}) };
  const canRun = !!params && seeded && validDraft && requiredParamsFilled(params, effective);

  return (
    <div className="w6w-stack">
      {params === null || !seeded ? (
        <p className="w6w-muted w6w-small">
          {params === null ? "Loading parameters…" : "Loading saved values…"}
        </p>
      ) : isTrigger ? (
        <>
          <PropertyEntryForm
            params={params}
            values={values}
            onChange={setValues}
            onValidityChange={setDraftValid}
          />
          {params.length === 0 && (
            <span className="w6w-hint">
              This trigger declares no fields — provide a sample payload to run with. It becomes the
              trigger's output state (<code>input</code>).
            </span>
          )}
        </>
      ) : (
        <>
          <p className="w6w-muted w6w-small">
            Runs <code>{step.uses.action}</code> with the configuration saved on this step — only
            the incoming state changes per run. Edit the step to change how it is configured.
          </p>
          <IncomingStateField text={stateText} onChange={setStateText} seeds={seeds} />
        </>
      )}
      <div className="w6w-modal-actions">
        <button type="button" className="w6w-btn w6w-btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        {!canRun && params !== null && seeded && (
          <span className="w6w-muted w6w-small">
            {!validDraft
              ? isTrigger
                ? "The payload must be a JSON object to run."
                : "The incoming state must be a JSON object to run."
              : isTrigger
                ? "Fill the required fields to test."
                : "This step is missing required configuration — set it on the Configure tab."}
          </span>
        )}
        <button
          type="button"
          className="w6w-btn"
          disabled={!canRun}
          // A trigger IS the start state, so it seeds nothing from upstream —
          // its filled fields go out as params (`{ input }`) exactly as before.
          onClick={() =>
            onRun(isTrigger ? values : (state ?? {}), isTrigger ? undefined : startState)
          }
        >
          ▶ Run
        </button>
      </div>
    </div>
  );
}

// ── Node renderers ────────────────────────────────────────────────────────

/**
 * A single connection handle, drawn to distinguish a single port from a
 * **multiple**-connection (fan-in / fan-out) port: a lone port keeps React
 * Flow's default dot, while `multiple` (cardinality > 1) renders a taller,
 * segmented bar so a node that accepts several inbound edges reads differently
 * from a single-in node (see core rfcs/node-types.md · Ports & cardinality).
 *
 * `variant === "error"` (T1.1.1) renders the second, visually subordinate
 * source handle every step/control node's error exit uses — `id` is what
 * lets React Flow (and `laneForSourceHandle`) tell it apart from the node's
 * ordinary, unnamed exit. The ONE shared handle component for both — no
 * second handle component and no raw inline `<Handle>` at either node card's
 * call site (`building-blocks.md`'s anti-duplication callout).
 */
function PortHandle({
  type,
  position,
  multiple,
  id,
  variant,
}: {
  type: "source" | "target";
  position: Position;
  multiple: boolean;
  id?: string;
  variant?: "error";
}) {
  return (
    <Handle
      type={type}
      position={position}
      id={id}
      className={
        variant === "error" ? "w6w-handle-error" : multiple ? "w6w-handle-multi" : undefined
      }
      style={multiple ? { height: 22, borderRadius: 3, width: 8 } : undefined}
      title={
        variant === "error"
          ? "On error — drag to route this step's failure separately"
          : multiple
            ? type === "target"
              ? "Accepts multiple incoming connections"
              : "Multiple outgoing connections"
            : undefined
      }
    />
  );
}

/** A 24×24 stroked glyph for the node toolbar. */
function ToolbarIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function NodeControls({ id, runnable }: { id: string; runnable?: boolean }) {
  const ctrl = useContext(StepControlsCtx);
  if (!ctrl || ctrl.readOnly) return null;
  return (
    <NodeToolbar position={Position.Top} className="w6w-node-toolbar">
      {runnable && (
        <button
          type="button"
          className="w6w-node-toolbar-btn"
          title="Test-run this step"
          aria-label="Test-run this step"
          onClick={() => ctrl.onRun(id)}
        >
          <ToolbarIcon>
            <polygon points="6 4 20 12 6 20 6 4" />
          </ToolbarIcon>
        </button>
      )}
      <button
        type="button"
        className="w6w-node-toolbar-btn"
        title="Edit"
        aria-label="Edit step"
        onClick={() => ctrl.onEdit(id)}
      >
        <ToolbarIcon>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
        </ToolbarIcon>
      </button>
      <button
        type="button"
        className="w6w-node-toolbar-btn"
        title="Duplicate"
        aria-label="Duplicate step"
        onClick={() => ctrl.onDuplicate(id)}
      >
        <ToolbarIcon>
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </ToolbarIcon>
      </button>
      <button
        type="button"
        className="w6w-node-toolbar-btn danger"
        title="Delete"
        aria-label="Delete step"
        onClick={() => ctrl.onDelete(id)}
      >
        <ToolbarIcon>
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </ToolbarIcon>
      </button>
    </NodeToolbar>
  );
}

function StepNodeCard({ id, data, selected }: NodeProps<StepNode>) {
  const step = data.step;
  const apps = useContext(AppsCtx);
  const app = apps.get(step.uses.app);
  // The human app name (fall back to the raw id when the app isn't in the list).
  const appName = app?.displayName || step.uses.app || "—";
  // Per-step ports (T2.3.1): a persisted `ports.in > 1` renders a multi-input handle.
  const ports = nodePortsForStep(step);
  return (
    <div>
      <NodeControls id={id} runnable />
      <div
        style={{
          // `relative` so the Handles center on the CARD, not the whole node
          // (which also spans the meta line below) — keeps ports vertically centered.
          position: "relative",
          border: `1px solid ${selected ? "var(--w6w-accent)" : "var(--w6w-border)"}`,
          background: "var(--w6w-panel)",
          color: "var(--w6w-text)",
          borderRadius: 4,
          padding: "8px 12px",
          minWidth: 180,
          fontSize: 13,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        {ports.in > 0 && (
          <PortHandle type="target" position={Position.Left} multiple={ports.in > 1} />
        )}
        <AppIcon
          src={app?.iconSvg}
          srcDark={app?.iconSvgDark}
          brandColor={app?.brandColor}
          name={appName}
          size={28}
        />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{appName}</div>
          <div className="w6w-muted w6w-small" style={{ marginTop: 2 }}>
            <code>{step.uses.action || "—"}</code>
          </div>
        </div>
        {ports.out > 0 && (
          <>
            <PortHandle type="source" position={Position.Right} multiple={ports.out > 1} />
            <PortHandle
              type="source"
              position={Position.Bottom}
              multiple={false}
              id={ERROR_SOURCE_HANDLE}
              variant="error"
            />
          </>
        )}
      </div>
      {/* Meta line under the card: the step id and (when known) the app version. */}
      <div
        className="w6w-muted"
        style={{ marginTop: 3, fontSize: 10, opacity: 0.75, paddingLeft: 2 }}
      >
        {step.id}
        {app?.version ? ` - v${app.version}` : ""}
      </div>
      {/* The step's own Notes (settings → gear icon), shown here so a reader
          can associate it with the step without opening it — human override,
          2026-08-30. Full text in `title=` for a hover, one visual line on
          the canvas itself; `.w6w-node-notes` (styles.css) truncates. */}
      {step.notes && (
        <div className="w6w-muted w6w-node-notes" title={step.notes}>
          {step.notes}
        </div>
      )}
    </div>
  );
}

function ControlNodeCard({ id, data, selected }: NodeProps<StepNode>) {
  const step = data.step;
  const label = internalNodeLabel(step.uses.app, step.uses.action);
  const icon = internalNodeIcon(step.uses.app, step.uses.action);
  // Per-step ports (T2.3.1): triggers have no entry (0 in, 1 out); a fan-in node
  // (e.g. aggregate, or `ports.in > 1`) renders a multi-input handle.
  const ports = nodePortsForStep(step);
  // A trigger is the run's ENTRY, not a step that acts: it emits the start
  // payload and has no vendor call to fail, so there is no failure of its own
  // to route — no error exit port (human report, 2026-09-01). Triggers on the
  // canvas are always internal nodes (an app's own trigger binds as a
  // subscription, never as a node), so this card is the only one that needs
  // the guard.
  const isTrigger = isTriggerApp(step.uses.app);
  return (
    <div>
      {/* Compute/trigger nodes can be test-run; flow-control nodes cannot. */}
      <NodeControls id={id} runnable={!isControlApp(step.uses.app)} />
      <div
        style={{
          // `relative` so the Handles center on the CARD, not the whole node
          // (which also spans the meta line below) — keeps ports vertically centered.
          position: "relative",
          border: `1px solid ${selected ? "var(--w6w-accent)" : "var(--w6w-border)"}`,
          background: "var(--w6w-panel-2)",
          color: "var(--w6w-text)",
          borderRadius: 4,
          padding: "6px 14px 6px 8px",
          minWidth: 140,
          fontSize: 13,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        {ports.in > 0 && (
          <PortHandle type="target" position={Position.Left} multiple={ports.in > 1} />
        )}
        {icon && <InternalIcon icon={icon} />}
        <div style={{ minWidth: 0, textAlign: "left" }}>
          <div style={{ fontWeight: 600 }}>{label}</div>
          <div className="w6w-muted w6w-small" style={{ marginTop: 2 }}>
            <code>{step.uses.action || "—"}</code>
          </div>
        </div>
        {ports.out > 0 && (
          <>
            <PortHandle type="source" position={Position.Right} multiple={ports.out > 1} />
            {!isTrigger && (
              <PortHandle
                type="source"
                position={Position.Bottom}
                multiple={false}
                id={ERROR_SOURCE_HANDLE}
                variant="error"
              />
            )}
          </>
        )}
      </div>
      {/* Meta line under the card: the step id (internal nodes carry no version). */}
      <div
        className="w6w-muted"
        style={{ marginTop: 3, fontSize: 10, opacity: 0.75, paddingLeft: 2 }}
      >
        {step.id}
      </div>
      {/* The step's own Notes — see StepNodeCard's own copy for the rationale. */}
      {step.notes && (
        <div className="w6w-muted w6w-node-notes" title={step.notes}>
          {step.notes}
        </div>
      )}
    </div>
  );
}

// ── Step edit modal (Form ⇄ JSON) ─────────────────────────────────────────

export function StepEditModal({
  workflowId,
  step: initialStep,
  upstreamSteps,
  onChange,
  onClose,
  readOnly,
  initialView = "props",
}: {
  workflowId: string;
  step: FlowStep;
  /** Graph ancestors of this step (from `upstreamStateSources`); the incoming-state picker seeds from their saved tests. */
  upstreamSteps: ExpressionStepSource[];
  onChange: (next: FlowStep) => void;
  onClose: () => void;
  readOnly?: boolean;
  initialView?: EditView;
}) {
  const api = useW6WApi();
  const apps = useContext(AppsCtx);
  const [step, setStep] = useState<FlowStep>(initialStep);
  // Same shape as the add modal: Setup/Configure/Test tabs with the Configure
  // tab showing form (props) / full-step JSON (code) / params JSON
  // (params-code) / node settings (config).
  const [tab, setTab] = useState<"setup" | "configure" | "test">(
    initialView === "json" ? "configure" : initialView === "settings" ? "configure" : "configure",
  );
  const [configView, setConfigView] = useState<ConfigView>(
    initialView === "json" ? "code" : initialView === "settings" ? "config" : "props",
  );
  // The Test tab's own props/JSON toggle state (A4/D-7) — deliberately NOT
  // `configView`, which ranges over `"params-code"`/`"config"` too, neither of
  // which is in the Test tab's narrowed `["props","code"]` set. Always starts
  // on the row list.
  const [testView, setTestView] = useState<"props" | "code">("props");
  // Draft text backing the "code" (full-step, read-only) view.
  const [codeText, setCodeText] = useState(() => stepToJson(initialStep));
  // Draft text backing the "params-code" (params-only, writable) view.
  const [paramsCodeText, setParamsCodeText] = useState(() => paramsToJson(initialStep));
  const [testState, setTestState] = useState("{}");
  // Drives the footer "Test" button, which triggers the body's <StepTestRun> so
  // the run + persist logic isn't duplicated across two affordances.
  const testRunRef = useRef<StepTestRunHandle>(null);
  const [testBusy, setTestBusy] = useState(false);
  // Inline step rename (pencil next to the name). `updateStep` fixes up edges.
  const [renaming, setRenaming] = useState(false);
  const [draftId, setDraftId] = useState(step.id);

  const [params, setParams] = useState<ActionParam[] | null>(null);
  const [actions, setActions] = useState<ActionDef[] | null>(null);
  const [conns, setConns] = useState<ConnectionSummary[] | null>(null);
  const isInternal = isInternalApp(step.uses.app);

  // Refetch actions + params whenever the app/action identity changes. P-3:
  // this must refetch on an APP change alone (action `""` included) — an
  // early return here on a missing action left `actions` holding the
  // PREVIOUS app's list, stale-ing the Action <select> after Change (D-1).
  useEffect(() => {
    if (isInternal) {
      setParams(internalNodeParams(step.uses.app, step.uses.action));
      setActions(null);
      return;
    }
    if (!step.uses.app) {
      setActions(null);
      setParams([]);
      return;
    }
    let canceled = false;
    setParams(null);
    api
      .getAppActions(step.uses.app)
      .then((acts) => {
        if (canceled) return;
        setActions(acts);
        setParams(
          step.uses.action ? (acts.find((a) => a.key === step.uses.action)?.params ?? []) : [],
        );
      })
      .catch(() => !canceled && setParams([]));
    return () => {
      canceled = true;
    };
  }, [api, step.uses.app, step.uses.action, isInternal]);

  const refetchConns = useCallback(() => {
    if (isInternal || !step.uses.app) return;
    api
      .listConnectionsForApp(step.uses.app)
      .then((c) => setConns(c))
      .catch(() => setConns([]));
  }, [api, step.uses.app, isInternal]);

  useEffect(() => {
    if (isInternal || !step.uses.app) return;
    let canceled = false;
    api
      .listConnectionsForApp(step.uses.app)
      .then((c) => !canceled && setConns(c))
      .catch(() => !canceled && setConns([]));
    return () => {
      canceled = true;
    };
  }, [api, step.uses.app, isInternal]);

  const commit = useCallback(
    (next: FlowStep) => {
      setStep(next);
      onChange(next);
    },
    [onChange],
  );

  const changeConfigView = (v: ConfigView) => {
    if (v === "code") setCodeText(stepToJson(step));
    else if (v === "params-code") setParamsCodeText(paramsToJson(step));
    setConfigView(v);
  };
  const commitRename = () => {
    const id = draftId.trim();
    if (id && id !== step.id) commit({ ...step, id });
    setRenaming(false);
  };

  const testable = !!step.uses.app && !!step.uses.action && !isControlApp(step.uses.app);
  // A manual/webhook trigger's Test tab fills its configured `fields` into
  // `{ input }` (via TriggerFillForm) rather than running the raw config.
  const isTrigger = isTriggerApp(step.uses.app);
  // A4/D-7: the tabs-bar toggle is enabled and narrowed to props/code ONLY on
  // this arm — the non-trigger, testable Test tab, the one that mounts
  // `<ResolvedParams>`. The trigger arm keeps the dim four (`PropertyEntryForm`
  // renders its own toggle inside `TriggerFillForm`'s body); Setup/Configure
  // are unchanged.
  const isTestPropsCode = tab === "test" && testable && !isTrigger;

  // The editing step's graph ancestors that carry a saved step-test, offered as
  // one-click seeds for the incoming state. The SAME hook the canvas ▶ Run
  // collect form uses — one implementation, so the two surfaces cannot drift.
  const seedSources = useSeedSources(workflowId, upstreamSteps, testable && !isTrigger);
  // …and the start state the test is SENT with, from those same fixtures. This
  // is what makes `{{ steps.<id>.output.<field> }}` in this step's `with`
  // resolve to what that step last produced instead of to "".
  const testStartState = startStateFromSeeds(seedSources);

  // The incoming state this step was last tested or run with comes back (T4.1.3
  // on this surface's own noun): the fixture's `input` slot is where both
  // surfaces write it. Applied only while the box is still untouched, so a slow
  // list can never overwrite what the operator is typing.
  useEffect(() => {
    if (!testable || isTrigger) return;
    let canceled = false;
    api
      .listStepTests(workflowId, step.id)
      .then((tests) => {
        if (canceled) return;
        const latest = tests.length ? tests[tests.length - 1] : null;
        if (!latest?.input || Object.keys(latest.input).length === 0) return;
        const next = JSON.stringify(latest.input, null, 2);
        setTestState((cur) => (cur.trim() === "{}" ? next : cur));
      })
      // Best-effort, exactly like the seed effect: no fixture (or a failed list)
      // just leaves the box empty.
      .catch(() => {});
    return () => {
      canceled = true;
    };
  }, [api, workflowId, step.id, testable, isTrigger]);

  // The incoming-state override, and the payload it produces. The step's STORED
  // configuration is what runs; the override is merged over it. A box that is
  // not a JSON object overrides nothing (see `parseStateOverride`).
  const testOverride = parseStateOverride(testState);
  const testValues = { ...(step.with ?? {}), ...(testOverride ?? {}) };
  // The resolved incoming state saved alongside the fixture — the slot the ▶ Run
  // collect form reads back, and what the upstream seed chips write into.
  const testInput = testOverride ?? {};
  const canTest = !!params && requiredParamsFilled(params, testValues);

  // Header icon mirrors the canvas node: the app's icon for app steps, the
  // internal glyph for triggers/actions/control nodes (same as the node cards).
  const app = apps.get(step.uses.app);
  const internalIcon = isInternal ? internalNodeIcon(step.uses.app, step.uses.action) : null;
  const titleIcon = isInternal ? (
    internalIcon ? (
      <InternalIcon icon={internalIcon} />
    ) : null
  ) : (
    <AppIcon
      src={app?.iconSvg}
      srcDark={app?.iconSvgDark}
      brandColor={app?.brandColor}
      name={app?.displayName}
    />
  );

  return (
    <Modal
      ariaLabel="Edit step"
      titleIcon={titleIcon}
      title={
        <span className="w6w-step-rename">
          {renaming && !readOnly ? (
            <input
              // biome-ignore lint/a11y/noAutofocus: rename input opened on demand
              autoFocus
              value={draftId}
              onChange={(e) => setDraftId(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") {
                  setDraftId(step.id);
                  setRenaming(false);
                }
              }}
            />
          ) : (
            <>
              <code>{step.id}</code>
              {!readOnly && (
                <button
                  type="button"
                  className="w6w-icon-btn w6w-btn-sm"
                  title="Rename step"
                  aria-label="Rename step"
                  onClick={() => {
                    setDraftId(step.id);
                    setRenaming(true);
                  }}
                >
                  <ToolbarIcon>
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                  </ToolbarIcon>
                </button>
              )}
            </>
          )}
        </span>
      }
      onClose={onClose}
      size="wide"
    >
      <div className="w6w-stepconfig">
        <div className="w6w-tabsbar">
          <div className="w6w-subtabs">
            {(["setup", "configure", "test"] as const).map((t) => (
              <button
                key={t}
                type="button"
                className={`w6w-subtab${tab === t ? " active" : ""}`}
                onClick={() => setTab(t)}
              >
                {t === "setup" ? "Setup" : t === "configure" ? "Configure" : "Test"}
              </button>
            ))}
          </div>
          {isTestPropsCode ? (
            <ConfigViewToggle
              view={testView}
              views={["props", "code"]}
              onChange={(v) => setTestView(v as "props" | "code")}
            />
          ) : (
            <ConfigViewToggle
              view={configView}
              onChange={changeConfigView}
              disabled={tab !== "configure"}
            />
          )}
        </div>

        <div className="w6w-stepconfig-body">
          {tab === "setup" && (
            <SetupTab
              step={step}
              app={app}
              actions={actions}
              conns={conns}
              isInternal={isInternal}
              readOnly={readOnly}
              onChangeAction={(action) =>
                commit({ ...step, uses: { ...step.uses, action }, with: {} })
              }
              onChangeConnection={(connection) =>
                commit({ ...step, uses: { ...step.uses, connection } })
              }
              onConnectionCreated={refetchConns}
              onChangeApp={(appId) =>
                // D-1: a genuinely different app clears `uses.action`/`with` and
                // drops the connection; reselecting the SAME app is a no-op —
                // still committed (so the field always collapses cleanly), but
                // with `step` itself, unchanged.
                commit(
                  appId === step.uses.app
                    ? step
                    : {
                        ...step,
                        uses: { app: appId, action: "", connection: undefined },
                        with: {},
                      },
                )
              }
            />
          )}

          {tab === "configure" && (
            <>
              {step.uses.app === WEBHOOK_APP &&
                api.listSubscriptionsForWorkflow &&
                api.createSubscription && (
                  <WebhookUrlPanel workflowId={workflowId} step={step} readOnly={readOnly} />
                )}
              {params === null ? (
                <p className="w6w-muted w6w-small">Loading parameters…</p>
              ) : configView === "props" ? (
                <ParamsForm
                  params={params}
                  values={step.with ?? {}}
                  readOnly={readOnly}
                  onChange={(w) => commit({ ...step, with: w })}
                />
              ) : configView === "code" ? (
                // Full step, read-only (D-3) — `stepToJson` is the ONE serializer,
                // shared with the two other code-view hosts.
                <JsonEditor
                  value={codeText}
                  onChange={() => {}}
                  readOnly
                  minHeight="260px"
                  height="100%"
                  aria-label={`Step ${step.id} JSON`}
                  copyable
                />
              ) : configView === "params-code" ? (
                <JsonEditor
                  value={paramsCodeText}
                  onChange={setParamsCodeText}
                  readOnly={readOnly}
                  minHeight="260px"
                  height="100%"
                  aria-label={`Step ${step.id} params JSON`}
                  copyable
                  onValidChange={(p) =>
                    p &&
                    typeof p === "object" &&
                    !Array.isArray(p) &&
                    commit({ ...step, with: p as Record<string, unknown> })
                  }
                />
              ) : (
                <div className="w6w-stack">
                  <NodeConfigForm
                    config={{ retry: step.retry, onError: step.onError, notes: step.notes }}
                    onChange={(c) => commit({ ...step, ...c })}
                    readOnly={readOnly}
                    // A trigger has no failure of its own to retry or police —
                    // same reason its card renders no error exit port.
                    failureHandling={!isTrigger}
                  />
                  {SHOW_STEP_PORTS && (
                    <StepPortsControl step={step} readOnly={readOnly} onChange={commit} />
                  )}
                </div>
              )}
            </>
          )}

          {tab === "test" && (
            <div className="w6w-stack">
              {testable ? (
                isTrigger ? (
                  <TriggerFillForm
                    app={step.uses.app}
                    action={step.uses.action}
                    fields={step.with?.fields}
                    // Same fixture key the non-trigger Test path passes to
                    // <StepTestRun> below, so the values entered here are
                    // remembered and come back on the canvas ▶ Run form.
                    persist={{ workflowId, stepId: step.id, input: testInput }}
                  />
                ) : (
                  <>
                    <p className="w6w-muted w6w-small">
                      Tests <code>{step.uses.action}</code> with the configuration saved on this
                      step — only the incoming state changes per run.
                    </p>
                    <IncomingStateField
                      text={testState}
                      onChange={setTestState}
                      seeds={seedSources}
                      readOnly={readOnly}
                    />
                    {/* What will actually be submitted, resolved against the
                        incoming state above — `testValues` (post-override),
                        never `step.with` alone, so overriding the incoming
                        state visibly updates these rows. */}
                    {params === null ? (
                      <p className="w6w-muted w6w-small">Loading parameters…</p>
                    ) : (
                      <ResolvedParams
                        params={params}
                        values={testValues}
                        testStartState={testStartState}
                        view={testView}
                      />
                    )}
                    <StepTestRun
                      ref={testRunRef}
                      app={step.uses.app}
                      action={step.uses.action}
                      connectionId={step.uses.connection ?? undefined}
                      values={testValues}
                      state={testStartState}
                      canRun={canTest}
                      hideRunButton
                      persist={{ workflowId, stepId: step.id, input: testInput }}
                      onBusyChange={setTestBusy}
                    />
                  </>
                )
              ) : (
                <p className="w6w-muted w6w-small">
                  Flow-control nodes can't be tested on their own.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="w6w-modal-actions w6w-stepconfig-footer">
          {tab !== "test" ? (
            <button
              type="button"
              className="w6w-btn"
              onClick={() => setTab(tab === "setup" ? "configure" : "test")}
            >
              Next →
            </button>
          ) : (
            <>
              <button type="button" className="w6w-btn w6w-btn-ghost" onClick={onClose}>
                Done
              </button>
              {testable && !isTrigger && (
                // Runs the step and persists the outcome (records a run + saves
                // the fixture) via the body's <StepTestRun>, so a step test is
                // saved and re-runnable. `readOnly` viewers can't write tests.
                <button
                  type="button"
                  className="w6w-btn"
                  disabled={readOnly || !canTest || testBusy}
                  onClick={() => testRunRef.current?.run()}
                >
                  {testBusy ? "Testing…" : "Test"}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** Default in-cardinality applied when a step is opted into multiple inbound edges. */
const MULTI_IN_DEFAULT = 10;

/** Hidden for now (26-08-30-00-fixes item 3). Flip to `true` to restore; nothing else changes. */
const SHOW_STEP_PORTS = false;

/**
 * Opt a step into accepting **multiple** incoming edges by setting `step.ports.in`
 * (see core rfcs/node-types.md · Ports & cardinality). Unchecking reverts to the
 * node's default (drops the persisted `ports` so an untouched step stays `1/1`).
 * Hidden for entry nodes (triggers) that declare no inbound port.
 */
function StepPortsControl({
  step,
  readOnly,
  onChange,
}: {
  step: FlowStep;
  readOnly?: boolean;
  onChange: (next: FlowStep) => void;
}) {
  const ports = nodePortsForStep(step);
  // Nothing flows into a node with no entry port (e.g. a trigger).
  if (ports.in < 1) return null;
  const multiple = ports.in > 1;
  return (
    <label className="w6w-field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <input
        type="checkbox"
        checked={multiple}
        disabled={readOnly}
        onChange={(e) => {
          if (e.target.checked) {
            onChange({ ...step, ports: { in: MULTI_IN_DEFAULT, out: ports.out } });
          } else {
            const { ports: _drop, ...rest } = step;
            onChange(rest);
          }
        }}
      />
      <span>Accept multiple incoming connections</span>
    </label>
  );
}

/**
 * "Webhook URL" panel (I-2) — rendered only for a `WEBHOOK_APP` step, above
 * the ParamsForm/JsonEditor arms. Get-or-create against the Subscription
 * mechanism (rfcs/trigger.md), per DECISIONS.md HITL-1 + plan.md D-5:
 * - on open, lists this workflow's Subscriptions ONCE and takes the first
 *   `appId === WEBHOOK_APP` entry — never re-derived client-side
 *   (gap-analysis-I2 §1's `SubscriptionsPage.tsx:24-28` correctness bug is
 *   deliberately not reproduced here; the server's own `webhookUrl` is the
 *   only source).
 * - if one exists, its URL renders through `Copyable` exactly as
 *   `TenantSettingsPage.tsx:219-227` (full URL, readOnly, aria-label) — no
 *   create call.
 * - if none exists, a labelled button creates one with the step's own
 *   current `with` as the Subscription's `params`, then renders the result.
 *   `sub_…` ids are server-minted, so this never re-fires on its own — only
 *   an explicit click creates, and only once a subscription is confirmed
 *   absent.
 */
function WebhookUrlPanel({
  workflowId,
  step,
  readOnly,
}: {
  workflowId: string;
  step: FlowStep;
  readOnly?: boolean;
}) {
  const api = useW6WApi();
  // `undefined` while the initial list is in flight; `null` once resolved
  // with no existing webhook subscription for this workflow.
  const [sub, setSub] = useState<SubscriptionSummary | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Deliberately keyed on [api, workflowId] only — NOT on `step` (its `with`
  // changes on every keystroke in the panel below). Re-running this on a
  // `with` edit would defeat the "never re-creates" guarantee this panel
  // exists to provide; the list is a one-shot get, not a live subscription.
  useEffect(() => {
    const list = api.listSubscriptionsForWorkflow;
    if (!list) return;
    let canceled = false;
    list(workflowId)
      .then((subs) => {
        if (!canceled) setSub(subs.find((s) => s.appId === WEBHOOK_APP) ?? null);
      })
      .catch((e) => !canceled && setError((e as Error).message));
    return () => {
      canceled = true;
    };
  }, [api, workflowId]);

  const create = () => {
    const createSubscription = api.createSubscription;
    if (!createSubscription) return;
    setError(null);
    setCreating(true);
    createSubscription(WEBHOOK_APP, step.uses.action, {
      workflowId,
      connectionId: null,
      params: step.with ?? {},
    })
      .then((created) => {
        setCreating(false);
        setSub(created);
      })
      .catch((e) => {
        setCreating(false);
        setError(e instanceof Error ? e.message : String(e));
      });
  };

  return (
    <div className="w6w-stack">
      <p className="w6w-muted w6w-small">
        <strong>Webhook URL</strong> — the address a third party posts to.
      </p>
      {error && <div className="w6w-result w6w-error">{error}</div>}
      {sub?.webhookUrl ? (
        <Copyable value={sub.webhookUrl} readOnly>
          <input type="text" readOnly value={sub.webhookUrl} aria-label="Webhook URL" />
        </Copyable>
      ) : sub === undefined ? (
        <p className="w6w-muted w6w-small">Loading…</p>
      ) : (
        !readOnly && (
          <button type="button" className="w6w-btn" disabled={creating} onClick={create}>
            {creating ? "Creating…" : "Create webhook URL"}
          </button>
        )
      )}
    </div>
  );
}

/**
 * A small popover anchored to a trigger element, portaled to the trigger's
 * own `<dialog>` (never `document.body`) — a `showModal()` dialog and its
 * contents live in the browser's native top layer, so a portal straight to
 * `document.body` would render BEHIND the modal, not over it (2026-08-30:
 * "it needs to be a flyout over the modal, not squeezed inside it"). Plain
 * CSS-positioned `<div>`, not a nested `<dialog>` — the ask was explicit
 * ("don't use native dialog, create css dialog").
 *
 * Closes on Escape or a click outside both itself and the anchor. It does
 * NOT close on a click ON the anchor — that stays the trigger's own toggle
 * (click to open, click again to close), so the anchor button remains a
 * working close affordance the whole time the flyout is open, unlike an
 * inline "replace the button with the picker" approach where there is
 * nothing left to click to back out.
 */
function Flyout({
  anchorRef,
  onClose,
  children,
}: {
  // Anchored to the ROW (both App and Connection buttons together), not the
  // individual trigger button — two reasons, both from the same feedback
  // pass (2026-08-30): a flyout anchored to whichever button sits at the
  // row's right edge (Connection) could overflow past the modal's own right
  // border ("fix anchor"), and the app picker specifically was asked to
  // "take up the entire horizontal width of the content... extend to the
  // end of the prod button". Anchoring both to the row's own bounding box
  // solves both at once: the flyout's width always matches content already
  // known to fit inside the modal, and it never hangs off either edge.
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
}) {
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [container, setContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: r.bottom + 6, left: r.left, width: r.width });
    setContainer(el.closest("dialog") ?? document.body);
  }, [anchorRef]);

  useEffect(() => {
    function onDocPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (popRef.current?.contains(target)) return;
      // A click ON the anchor is the trigger's own toggle — never close here
      // AND reopen there in the same gesture.
      if (anchorRef.current?.contains(target)) return;
      onClose();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDocPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, anchorRef]);

  if (!pos || !container) return null;
  return createPortal(
    <div
      ref={popRef}
      className="w6w-flyout"
      style={{ top: pos.top, left: pos.left, width: pos.width }}
    >
      {children}
    </div>,
    container,
  );
}

/**
 * The Setup tab — an App button and a Connection button, spaced apart, then
 * the step's action (a dropdown for app steps). Two independent pickers
 * (2026-08-30, superseding D-1's single combined field — see intake for the
 * exact spec): App opens a searchable app picker; Connection opens a plain
 * list of connections FOR THE CURRENT APP plus "+ New connection" — no
 * search, per the ask ("just list the connections for the same app"). Both
 * render as an anchored `Flyout`, not inline content that pushes the rest
 * of the tab down.
 */
function SetupTab({
  step,
  app,
  actions,
  conns,
  isInternal,
  readOnly,
  onChangeAction,
  onChangeConnection,
  onChangeApp,
  onConnectionCreated,
}: {
  step: FlowStep;
  app: AppSummary | undefined;
  actions: ActionDef[] | null;
  conns: ConnectionSummary[] | null;
  isInternal: boolean;
  readOnly?: boolean;
  onChangeAction: (action: string) => void;
  onChangeConnection: (connection: string | undefined) => void;
  /** Fires with whatever app is picked, same or different — the caller owns
   *  the same-app-is-a-no-op / different-app-clears-action-and-with decision
   *  (it already owns the equivalent decision for `onChangeAction`). */
  onChangeApp: (appId: string) => void;
  /** Fires after a new connection is created via the inline "+ New
   *  connection" flow, so the caller can refetch its (app-scoped) connection
   *  list — `conns` here is a prop, this component owns no fetch of its own. */
  onConnectionCreated: () => void;
}) {
  // Which flyout (if either) is open. Local, ephemeral UI state: the tab
  // unmounts on tab-switch, so it always starts closed. `AppPicker` fetches
  // and searches its own catalog; the connection picker below just maps
  // `conns` (already app-scoped by the caller) — neither needs its own fetch.
  const [mode, setMode] = useState<"app" | "conn" | null>(null);
  const [showConnModal, setShowConnModal] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);

  const connName = step.uses.connection
    ? ((conns ?? []).find((c) => c.id === step.uses.connection)?.displayName ??
      step.uses.connection)
    : "No connection";

  return (
    <div className="w6w-stack">
      <div className="w6w-field">
        <span>App</span>
        {/* One field, two buttons — `[App] <-- spacer --> [Connection]`
            (2026-08-30). Always rendered, never swapped out for the picker:
            each button IS the flyout's anchor, and stays clickable the whole
            time its own flyout is open (click again to close — the toggle
            is the only way back out short of picking something or clicking
            away, since there is no third "cancel" control). */}
        <div className="w6w-app-conn-row" ref={rowRef}>
          <button
            type="button"
            className="w6w-app-conn-btn"
            aria-label="App"
            aria-expanded={mode === "app"}
            disabled={readOnly}
            onClick={() => setMode((m) => (m === "app" ? null : "app"))}
          >
            {!isInternal && app && (
              <AppIcon
                src={app.iconSvg}
                srcDark={app.iconSvgDark}
                brandColor={app.brandColor}
                name={app.displayName}
                size={20}
              />
            )}
            <span className="w6w-conn-label-name">
              {isInternal ? step.uses.app : (app?.displayName ?? step.uses.app)}
            </span>
          </button>
          {!isInternal && (
            <button
              type="button"
              className="w6w-app-conn-btn"
              aria-label="Connection"
              aria-expanded={mode === "conn"}
              disabled={readOnly}
              onClick={() => setMode((m) => (m === "conn" ? null : "conn"))}
            >
              <span className="w6w-conn-label-name">{connName}</span>
            </button>
          )}
        </div>

        {mode === "app" && (
          <Flyout anchorRef={rowRef} onClose={() => setMode(null)}>
            <AppPicker
              onSelectApp={(a) => {
                const sameAppReselected = a.id === step.uses.app;
                onChangeApp(a.id);
                // Same app: nothing else changed (action/config untouched, per
                // the ask) — go straight to the connection picker so they can
                // still pick a different connection. Different app: the caller
                // already wiped action/connection/with; close, exactly
                // "start over" on the fresh (connection-less) app.
                setMode(sameAppReselected ? "conn" : null);
              }}
            />
          </Flyout>
        )}
        {mode === "conn" && (
          <Flyout anchorRef={rowRef} onClose={() => setMode(null)}>
            <div className="w6w-stack">
              <div className="w6w-stepbuilder-list">
                {(conns ?? []).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="w6w-stepbuilder-item"
                    onClick={() => {
                      onChangeConnection(c.id);
                      setMode(null);
                    }}
                  >
                    <span className="w6w-stepbuilder-item-main">
                      <strong>{c.displayName || c.id}</strong>
                      {c.state && <span className="w6w-muted w6w-small">{c.state}</span>}
                    </span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="w6w-btn"
                disabled={readOnly}
                onClick={() => {
                  setShowConnModal(true);
                  setMode(null);
                }}
              >
                + New connection
              </button>
            </div>
          </Flyout>
        )}
      </div>

      {!isInternal && showConnModal && (
        <AddConnectionModal
          initialAppId={step.uses.app}
          onClose={() => setShowConnModal(false)}
          onCreated={({ connectionId }) => {
            setShowConnModal(false);
            onChangeConnection(connectionId);
            onConnectionCreated();
            setMode(null);
          }}
        />
      )}

      {isInternal ? (
        <div className="w6w-field">
          <span>Action</span>
          <div className="w6w-muted w6w-small">
            <code>{step.uses.action}</code>
          </div>
        </div>
      ) : (
        <label className="w6w-field">
          <span>Action</span>
          <select
            value={step.uses.action}
            disabled={readOnly || actions === null}
            onChange={(e) => onChangeAction(e.target.value)}
          >
            {actions === null && <option>{step.uses.action}</option>}
            {(actions ?? []).map((a) => (
              <option key={a.key} value={a.key}>
                {a.title ?? a.key}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
