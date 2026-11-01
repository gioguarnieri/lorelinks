import { linkIndex } from "./link-index.mjs";
import { createMissingNote, normalizeName } from "./wikilinks.mjs";

const { ApplicationV2 } = foundry.applications.api;

/** Layout tuning. Distances are in graph units, which equal screen pixels at 100% zoom. */
const LAYOUT = {
  repulsion: 5000,     // How strongly every pair of nodes pushes apart.
  linkLength: 120,     // Resting length of a link.
  linkStrength: 0.06,  // How strongly links pull toward their resting length.
  gravity: 0.012,      // Pull toward the center, which keeps unlinked nodes from drifting away.
  friction: 0.6,       // Fraction of velocity kept each step.
  cooling: 0.985,      // Activity decay per step; the simulation stops when it is nearly still.
  minAlpha: 0.004
};

const COLORS = { journal: "#d9a74a", actor: "#5fa8e8", unresolved: "#8a8a8a", edge: "rgba(190, 190, 190, 0.6)",
  edgeActive: "rgba(255, 200, 120, 0.9)" };

/**
 * @typedef SimNode
 * @property {string} id
 * @property {string} label
 * @property {"journal"|"actor"|"unresolved"} kind
 * @property {foundry.abstract.Document} [doc]
 * @property {number} x
 * @property {number} y
 * @property {number} vx
 * @property {number} vy
 * @property {number} degree
 * @property {boolean} [fixed]   Pinned while being dragged.
 */

/**
 * A window showing journal entries and actors as nodes, connected by their wikilinks.
 */
export class GraphView extends ApplicationV2 {
  /** @override */
  static DEFAULT_OPTIONS = {
    id: "lorelinks-graph",
    classes: ["lorelinks-graph"],
    window: { title: "LORELINKS.Graph.Title", icon: "fa-solid fa-diagram-project", resizable: true },
    position: { width: 900, height: 650 }
  };

  /** @type {GraphView} */
  static #instance;

  /**
   * Open the graph window, or bring it to the front if it is already open.
   * @returns {GraphView}
   */
  static open() {
    this.#instance ??= new this();
    if ( this.#instance.rendered ) this.#instance.bringToFront();
    else this.#instance.render({ force: true });
    return this.#instance;
  }

  /** Reload the graph's data if the window is open. Called when journals or actors change. */
  static refresh = foundry.utils.debounce(() => {
    if ( GraphView.#instance?.rendered ) GraphView.#instance.#loadData();
  }, 300);

  #filters = { actors: true, unresolved: true, orphans: true };
  #search = "";

  /** @type {SimNode[]} */
  #nodes = [];

  /** @type {{source: SimNode, target: SimNode}[]} */
  #edges = [];

  /** @type {Map<string, Set<string>>} Neighbor ids of each node, for hover highlighting. */
  #neighbors = new Map();

  /** Pan offset in screen pixels and zoom factor. */
  #view = { x: 0, y: 0, k: 1 };

  #alpha = 1;
  #frame = null;

  /** @type {HTMLCanvasElement} */
  #canvas;

  /** @type {SimNode|null} */
  #hover = null;

  /** Current pointer interaction: dragging a node or panning the view. */
  #pointer = null;

  /** @type {ResizeObserver} */
  #resizeObserver;

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** @override */
  async _renderHTML() {
    const root = document.createElement("div");
    root.classList.add("lorelinks-graph-body");

    const toolbar = document.createElement("div");
    toolbar.classList.add("lorelinks-graph-toolbar");
    const search = document.createElement("input");
    Object.assign(search, { type: "search", placeholder: game.i18n.localize("LORELINKS.Graph.Search"),
      value: this.#search });
    search.addEventListener("input", () => {
      this.#search = normalizeName(search.value);
      this.#draw();
    });
    toolbar.append(search);
    for ( const key of ["actors", "unresolved", "orphans"] ) {
      const label = document.createElement("label");
      const box = document.createElement("input");
      Object.assign(box, { type: "checkbox", checked: this.#filters[key] });
      box.addEventListener("change", () => {
        this.#filters[key] = box.checked;
        this.#loadData();
      });
      label.append(box, game.i18n.localize(`LORELINKS.Graph.Show.${key}`));
      toolbar.append(label);
    }

    const legend = document.createElement("div");
    legend.classList.add("lorelinks-graph-legend");
    for ( const kind of ["journal", "actor", "unresolved"] ) {
      const item = document.createElement("span");
      item.style.setProperty("--swatch", COLORS[kind]);
      item.dataset.kind = kind;
      item.textContent = game.i18n.localize(`LORELINKS.Graph.Kind.${kind}`);
      legend.append(item);
    }

    this.#canvas = document.createElement("canvas");
    root.append(toolbar, this.#canvas, legend);
    return root;
  }

  /** @override */
  _replaceHTML(result, content) {
    content.replaceChildren(result);
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const canvas = this.#canvas;
    canvas.addEventListener("pointerdown", this.#onPointerDown.bind(this));
    canvas.addEventListener("pointermove", this.#onPointerMove.bind(this));
    canvas.addEventListener("pointerup", this.#onPointerUp.bind(this));
    canvas.addEventListener("pointerleave", () => this.#setHover(null));
    canvas.addEventListener("wheel", this.#onWheel.bind(this), { passive: false });
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = new ResizeObserver(() => this.#resize());
    this.#resizeObserver.observe(canvas);
    this.#resize();
    this.#loadData();
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    if ( this.#frame ) cancelAnimationFrame(this.#frame);
    this.#frame = null;
    this.#resizeObserver?.disconnect();
  }

  /* -------------------------------------------- */
  /*  Data and Simulation                         */
  /* -------------------------------------------- */

  /** Load nodes and edges from the link index, keeping the positions of nodes that were already shown. */
  #loadData() {
    const { nodes, edges } = linkIndex.graph(this.#filters);
    const previous = new Map(this.#nodes.map(n => [n.id, n]));
    const spread = Math.sqrt(nodes.length) * 40;
    const byId = new Map();
    this.#nodes = nodes.map(node => {
      const old = previous.get(node.id);
      const sim = old ? Object.assign(old, node, { degree: 0 }) : { ...node, degree: 0, vx: 0, vy: 0,
        x: (Math.random() - 0.5) * spread, y: (Math.random() - 0.5) * spread };
      byId.set(sim.id, sim);
      return sim;
    });
    this.#edges = edges.map(e => ({ source: byId.get(e.source), target: byId.get(e.target) }));
    this.#neighbors.clear();
    for ( const { source, target } of this.#edges ) {
      source.degree++;
      target.degree++;
      if ( !this.#neighbors.has(source.id) ) this.#neighbors.set(source.id, new Set());
      if ( !this.#neighbors.has(target.id) ) this.#neighbors.set(target.id, new Set());
      this.#neighbors.get(source.id).add(target.id);
      this.#neighbors.get(target.id).add(source.id);
    }
    if ( this.#hover && !byId.has(this.#hover.id) ) this.#hover = null;
    this.#reheat(previous.size ? 0.5 : 1);
  }

  /**
   * Restart the simulation with the given activity level.
   * @param {number} alpha
   */
  #reheat(alpha) {
    this.#alpha = Math.max(this.#alpha, alpha);
    if ( !this.#frame ) this.#frame = requestAnimationFrame(this.#step.bind(this));
  }

  /** Advance the simulation one step and redraw, until it comes to rest. */
  #step() {
    const nodes = this.#nodes;
    const alpha = this.#alpha;

    // Every pair of nodes repels.
    for ( let i = 0; i < nodes.length; i++ ) {
      const a = nodes[i];
      for ( let j = i + 1; j < nodes.length; j++ ) {
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d2 = (dx * dx) + (dy * dy);
        if ( d2 < 1 ) {
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
          d2 = 1;
        }
        const f = (LAYOUT.repulsion * alpha) / d2;
        const d = Math.sqrt(d2);
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        a.vx -= fx; a.vy -= fy;
        b.vx += fx; b.vy += fy;
      }
    }

    // Links pull their ends toward the resting length.
    for ( const { source, target } of this.#edges ) {
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const d = Math.sqrt((dx * dx) + (dy * dy)) || 1;
      const f = ((d - LAYOUT.linkLength) / d) * LAYOUT.linkStrength * alpha;
      source.vx += dx * f; source.vy += dy * f;
      target.vx -= dx * f; target.vy -= dy * f;
    }

    for ( const node of nodes ) {
      if ( node.fixed ) {
        node.vx = node.vy = 0;
        continue;
      }
      node.vx = (node.vx - (node.x * LAYOUT.gravity * alpha)) * LAYOUT.friction;
      node.vy = (node.vy - (node.y * LAYOUT.gravity * alpha)) * LAYOUT.friction;
      node.x += node.vx;
      node.y += node.vy;
    }

    this.#draw();
    this.#alpha *= LAYOUT.cooling;
    if ( (this.#alpha > LAYOUT.minAlpha) || this.#pointer?.node ) {
      this.#frame = requestAnimationFrame(this.#step.bind(this));
    } else {
      this.#alpha = 0;
      this.#frame = null;
    }
  }

  /* -------------------------------------------- */
  /*  Drawing                                     */
  /* -------------------------------------------- */

  /** Match the canvas resolution to its displayed size. */
  #resize() {
    const canvas = this.#canvas;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    this.#draw();
  }

  /**
   * @param {SimNode} node
   * @returns {number}
   */
  #radius(node) {
    return 4 + (Math.sqrt(node.degree) * 2.5);
  }

  #draw() {
    const canvas = this.#canvas;
    if ( !canvas?.isConnected ) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const { x, y, k } = this.#view;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * ((canvas.clientWidth / 2) + x), dpr * ((canvas.clientHeight / 2) + y));

    const hover = this.#hover;
    const near = hover ? this.#neighbors.get(hover.id) ?? new Set() : null;
    const matches = node => !this.#search || normalizeName(node.label).includes(this.#search);
    const dimmed = node => (near && (node !== hover) && !near.has(node.id)) || !matches(node);

    ctx.lineWidth = 1 / k;
    for ( const { source, target } of this.#edges ) {
      const active = hover && ((source === hover) || (target === hover));
      ctx.strokeStyle = active ? COLORS.edgeActive : COLORS.edge;
      ctx.globalAlpha = (!active && (dimmed(source) || dimmed(target))) ? 0.15 : 1;
      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.lineTo(target.x, target.y);
      ctx.stroke();
    }

    const textColor = getComputedStyle(canvas).color || "#ddd";
    ctx.font = `${12 / k}px ${getComputedStyle(canvas).fontFamily || "sans-serif"}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for ( const node of this.#nodes ) {
      const r = this.#radius(node);
      const faded = dimmed(node);
      ctx.globalAlpha = faded ? 0.2 : 1;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      if ( node.kind === "unresolved" ) {
        ctx.setLineDash([3 / k, 2 / k]);
        ctx.strokeStyle = COLORS.unresolved;
        ctx.lineWidth = 1.5 / k;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineWidth = 1 / k;
      } else {
        ctx.fillStyle = COLORS[node.kind];
        ctx.fill();
      }
      if ( node === hover || (this.#search && !faded) ) {
        ctx.strokeStyle = textColor;
        ctx.lineWidth = 2 / k;
        ctx.stroke();
        ctx.lineWidth = 1 / k;
      }

      // Labels appear when zoomed in, and always for the hovered node, its neighbors and search matches.
      const showLabel = (k > 0.8) || (node === hover) || near?.has(node.id) || (this.#search && !faded);
      if ( showLabel && !faded ) {
        ctx.fillStyle = textColor;
        ctx.fillText(node.label, node.x, node.y + r + (3 / k));
      }
    }
    ctx.globalAlpha = 1;
  }

  /* -------------------------------------------- */
  /*  Interaction                                 */
  /* -------------------------------------------- */

  /**
   * Convert a pointer event position to graph coordinates.
   * @param {PointerEvent|WheelEvent} event
   * @returns {{x: number, y: number}}
   */
  #toGraph(event) {
    const rect = this.#canvas.getBoundingClientRect();
    const { x, y, k } = this.#view;
    return {
      x: (event.clientX - rect.left - (rect.width / 2) - x) / k,
      y: (event.clientY - rect.top - (rect.height / 2) - y) / k
    };
  }

  /**
   * The node under a pointer event, if any.
   * @param {PointerEvent} event
   * @returns {SimNode|null}
   */
  #nodeAt(event) {
    const p = this.#toGraph(event);
    const slop = 4 / this.#view.k;
    for ( let i = this.#nodes.length - 1; i >= 0; i-- ) {
      const node = this.#nodes[i];
      const r = this.#radius(node) + slop;
      if ( (((node.x - p.x) ** 2) + ((node.y - p.y) ** 2)) <= r * r ) return node;
    }
    return null;
  }

  /**
   * @param {SimNode|null} node
   */
  #setHover(node) {
    if ( node === this.#hover ) return;
    this.#hover = node;
    this.#canvas.style.cursor = node ? "pointer" : "grab";
    this.#canvas.dataset.tooltipText = node?.label ?? "";
    this.#draw();
  }

  /** @param {PointerEvent} event */
  #onPointerDown(event) {
    if ( event.button !== 0 ) return;
    this.#canvas.setPointerCapture(event.pointerId);
    const node = this.#nodeAt(event);
    this.#pointer = { node, startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY,
      moved: false };
    if ( node ) {
      node.fixed = true;
      this.#reheat(0.3);
    } else this.#canvas.style.cursor = "grabbing";
  }

  /** @param {PointerEvent} event */
  #onPointerMove(event) {
    const pointer = this.#pointer;
    if ( !pointer ) return this.#setHover(this.#nodeAt(event));

    if ( Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) > 3 ) pointer.moved = true;
    if ( pointer.node ) {
      const p = this.#toGraph(event);
      pointer.node.x = p.x;
      pointer.node.y = p.y;
      this.#reheat(0.3);
    } else {
      this.#view.x += event.clientX - pointer.lastX;
      this.#view.y += event.clientY - pointer.lastY;
      this.#draw();
    }
    pointer.lastX = event.clientX;
    pointer.lastY = event.clientY;
  }

  /** @param {PointerEvent} event */
  #onPointerUp(event) {
    const pointer = this.#pointer;
    this.#pointer = null;
    if ( !pointer ) return;
    if ( pointer.node ) pointer.node.fixed = false;
    this.#canvas.style.cursor = this.#hover ? "pointer" : "grab";
    if ( pointer.node && !pointer.moved ) this.#openNode(pointer.node);
  }

  /** @param {WheelEvent} event */
  #onWheel(event) {
    event.preventDefault();
    const rect = this.#canvas.getBoundingClientRect();
    const view = this.#view;
    const k = Math.min(4, Math.max(0.15, view.k * Math.exp(-event.deltaY * 0.0015)));
    // Keep the point under the cursor fixed while zooming.
    const sx = event.clientX - rect.left - (rect.width / 2);
    const sy = event.clientY - rect.top - (rect.height / 2);
    view.x = sx - (((sx - view.x) / view.k) * k);
    view.y = sy - (((sy - view.y) / view.k) * k);
    view.k = k;
    this.#draw();
  }

  /**
   * Open the sheet of a clicked node; clicking a missing note creates it.
   * @param {SimNode} node
   */
  #openNode(node) {
    if ( node.doc ) node.doc.sheet.render({ force: true });
    else createMissingNote(node.label);
  }
}
