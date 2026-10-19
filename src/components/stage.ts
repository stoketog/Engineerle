import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export type Theme = 'dark' | 'light';

export interface StageOpts {
  lowCpu: boolean;
  reduceMotion: boolean;
  theme: Theme;
}

export interface PointerInfo {
  /** Pointer position in CSS pixels, relative to the canvas. */
  x: number;
  y: number;
  /** Normalised device coordinates. */
  ndc: THREE.Vector2;
  ev: PointerEvent;
}

export interface Handlers {
  /** Return true to claim the drag (stops the camera orbiting). */
  down?: (p: PointerInfo) => boolean;
  move?: (p: PointerInfo, dragging: boolean) => void;
  up?: (p: PointerInfo, wasDrag: boolean) => void;
  /** A tap or click that was not a drag. */
  click?: (p: PointerInfo) => void;
}

const INK = { dark: 0xcfe6f7, light: 0x123a63 } as const;

/**
 * A small stage for one Engineerle scene: renderer, camera, light rig, gentle orbit, picking, frame pacing.
 * The camera is a true perspective camera on a normal device, and falls back to a fixed oblique orthographic
 * view ("2.5D") in Low CPU mode or when there is no GPU behind WebGL.
 */
export class Stage {
  /** Null when WebGL is unavailable: the scene still runs (physics, controls) but nothing is drawn. */
  readonly renderer: THREE.WebGLRenderer | null;
  readonly headless: boolean;
  readonly scene = new THREE.Scene();
  readonly root = new THREE.Group();
  readonly soft: boolean;
  readonly flat: boolean;
  readonly ink: THREE.LineBasicMaterial;
  readonly sun: THREE.DirectionalLight;
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  reduce: boolean;
  lowCpu: boolean;
  handlers: Handlers = {};
  onFrame: (dt: number, t: number) => void = () => {};
  /** Orbit around `target`: yaw about Y, pitch above the horizon. */
  target = new THREE.Vector3();
  yaw = 0.5;
  pitch = 0.4;
  yawRange: [number, number] = [-0.35, 1.35];
  pitchRange: [number, number] = [0.12, 0.9];
  content = { w: 20, h: 10 };
  margin = 1.1;
  private fov = 34;
  private raf = 0;
  private last = 0;
  private acc = 0;
  private visible = true;
  private disposed = false;
  private size = { w: 1, h: 1 };
  private ro: ResizeObserver | null = null;
  private io: IntersectionObserver | null = null;
  private ray = new THREE.Raycaster();
  private drag: null | { x: number; y: number; moved: boolean; claimed: boolean; yaw: number; pitch: number } = null;
  private t = 0;
  readonly canvas: HTMLCanvasElement;
  private labels = new Map<string, THREE.Sprite>();

  constructor(canvas: HTMLCanvasElement, opts: StageOpts) {
    this.canvas = canvas;
    this.lowCpu = opts.lowCpu;
    this.reduce = opts.reduceMotion;
    let r: THREE.WebGLRenderer | null = null;
    try {
      r = new THREE.WebGLRenderer({ canvas, antialias: !opts.lowCpu, alpha: true, powerPreference: 'high-performance' });
    } catch {
      r = null;
    }
    this.renderer = r;
    this.headless = !r;
    let force = false;
    if (r) {
      r.outputColorSpace = THREE.SRGBColorSpace;
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.toneMappingExposure = 1;
      r.setClearColor(0x000000, 0);
      const gl = r.getContext();
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const gpu = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
      this.soft = /swiftshader|llvmpipe|softpipe|software|microsoft basic/i.test(gpu);
      // ?persp forces the full perspective view even on a software renderer (for checking the look without a GPU)
      force = typeof location !== 'undefined' && /[?&]persp(=|&|$)/.test(location.search);
    } else this.soft = true;
    this.flat = this.lowCpu || (this.soft && !force);
    const shadows = !!r && !this.lowCpu && (!this.soft || force);
    if (r) {
      r.shadowMap.enabled = shadows;
      r.shadowMap.type = THREE.PCFSoftShadowMap;
      if (!this.soft || force) {
        const pm = new THREE.PMREMGenerator(r);
        this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
        this.scene.environmentIntensity = 0.38;
        pm.dispose();
      }
    }
    this.scene.add(this.root);
    this.ink = new THREE.LineBasicMaterial({ color: INK[opts.theme], transparent: true, opacity: 0.55 });

    // light rig: cool sky, warm key from the upper left, a faint rim from behind
    this.scene.add(new THREE.HemisphereLight(0xbfd9f2, 0x1b2a3b, this.scene.environment ? 0.3 : 1.1));
    const sun = new THREE.DirectionalLight(0xfff1dc, this.scene.environment ? 1.9 : 2.0);
    sun.position.set(-9, 16, 11);
    sun.castShadow = shadows;
    sun.shadow.mapSize.set(1024, 1024);
    const sc = sun.shadow.camera;
    sc.left = -18;
    sc.right = 18;
    sc.top = 14;
    sc.bottom = -14;
    sc.near = 1;
    sc.far = 60;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    this.sun = sun;
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x8fc4ff, 0.7);
    rim.position.set(10, 6, -12);
    this.scene.add(rim);

    this.camera = this.flat ? new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200) : new THREE.PerspectiveCamera(this.fov, 1, 0.1, 200);
    if (this.flat) {
      this.yawRange = [this.yaw - 0.0001, this.yaw + 0.0001];
      this.pitchRange = [0.38, 0.38];
      this.pitch = 0.38;
    }

    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.style.touchAction = 'pan-y';
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.io = new IntersectionObserver((e) => (this.visible = e[e.length - 1].isIntersecting));
    this.io.observe(canvas);
    this.resize();
    this.raf = requestAnimationFrame(this.loop);
  }

  setTheme(theme: Theme) {
    this.ink.color.setHex(INK[theme]);
  }

  /** Where the camera looks, from what angle, and how much of the world (in metres) must fit. */
  setView(o: { target?: [number, number, number]; yaw?: number; pitch?: number; w?: number; h?: number; yawRange?: [number, number]; pitchRange?: [number, number] }) {
    if (o.target) this.target.set(...o.target);
    if (o.yaw !== undefined) this.yaw = o.yaw;
    if (o.pitch !== undefined) this.pitch = o.pitch;
    if (o.w) this.content.w = o.w;
    if (o.h) this.content.h = o.h;
    if (!this.flat) {
      if (o.yawRange) this.yawRange = o.yawRange;
      if (o.pitchRange) this.pitchRange = o.pitchRange;
    } else {
      this.yawRange = [this.yaw - 0.0001, this.yaw + 0.0001];
      this.pitchRange = [this.pitch, this.pitch];
    }
    this.placeCamera();
  }

  private resize() {
    if (this.disposed) return;
    const c = this.canvas;
    const w = Math.max(1, c.clientWidth), h = Math.max(1, c.clientHeight);
    this.size = { w, h };
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const cap = this.lowCpu ? 1 : this.soft ? 1 : 2;
    if (this.renderer) {
      this.renderer.setPixelRatio(Math.min(dpr, cap));
      this.renderer.setSize(w, h, false);
    }
    this.placeCamera();
  }

  private placeCamera() {
    const { w, h } = this.size;
    const aspect = w / h;
    const cam = this.camera;
    const cy = Math.cos(this.pitch), sy = Math.sin(this.pitch);
    const dir = new THREE.Vector3(Math.sin(this.yaw) * cy, sy, Math.cos(this.yaw) * cy);
    if (cam instanceof THREE.PerspectiveCamera) {
      const tan = Math.tan((this.fov * Math.PI) / 360);
      const d = Math.max(this.content.h / 2 / tan, this.content.w / 2 / (tan * aspect)) * this.margin;
      cam.aspect = aspect;
      cam.position.copy(this.target).addScaledVector(dir, d);
    } else {
      const halfH = Math.max(this.content.h / 2, this.content.w / 2 / aspect) * this.margin;
      cam.left = -halfH * aspect;
      cam.right = halfH * aspect;
      cam.top = halfH;
      cam.bottom = -halfH;
      cam.position.copy(this.target).addScaledVector(dir, 60);
    }
    cam.lookAt(this.target);
    cam.updateProjectionMatrix();
  }

  private info(ev: PointerEvent): PointerInfo {
    const r = this.canvas.getBoundingClientRect();
    const x = ev.clientX - r.left, y = ev.clientY - r.top;
    return { x, y, ndc: new THREE.Vector2((x / r.width) * 2 - 1, -(y / r.height) * 2 + 1), ev };
  }

  /** The nearest hit under a pointer among `objects` (searched recursively). */
  pick(p: PointerInfo, objects: THREE.Object3D[]): THREE.Intersection | null {
    this.ray.setFromCamera(p.ndc, this.camera);
    const hits = this.ray.intersectObjects(objects, true);
    return hits[0] ?? null;
  }

  /** The point where the pointer's ray meets a plane (for dragging things along it). */
  onPlane(p: PointerInfo, plane: THREE.Plane): THREE.Vector3 | null {
    this.ray.setFromCamera(p.ndc, this.camera);
    const out = new THREE.Vector3();
    return this.ray.ray.intersectPlane(plane, out) ? out : null;
  }

  private onDown = (ev: PointerEvent) => {
    const p = this.info(ev);
    const claimed = this.handlers.down?.(p) ?? false;
    this.drag = { x: ev.clientX, y: ev.clientY, moved: false, claimed, yaw: this.yaw, pitch: this.pitch };
    try {
      this.canvas.setPointerCapture(ev.pointerId);
    } catch {
      /* not capturable */
    }
    if (claimed) this.canvas.style.touchAction = 'none';
  };
  private onMove = (ev: PointerEvent) => {
    const p = this.info(ev);
    const d = this.drag;
    if (!d) {
      this.handlers.move?.(p, false);
      return;
    }
    const dx = ev.clientX - d.x, dy = ev.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) > 5) d.moved = true;
    if (d.claimed) {
      this.handlers.move?.(p, true);
    } else if (d.moved && !this.flat && this.yawRange[1] > this.yawRange[0]) {
      this.yaw = Math.min(this.yawRange[1], Math.max(this.yawRange[0], d.yaw - dx * 0.006));
      this.pitch = Math.min(this.pitchRange[1], Math.max(this.pitchRange[0], d.pitch + dy * 0.005));
      this.placeCamera();
    }
  };
  private onUp = (ev: PointerEvent) => {
    const d = this.drag;
    this.drag = null;
    this.canvas.style.touchAction = 'pan-y';
    if (!d) return;
    const p = this.info(ev);
    this.handlers.up?.(p, d.moved);
    if (!d.moved && ev.type === 'pointerup') this.handlers.click?.(p);
  };

  /** Ask for a redraw (scenes that only change when touched). */
  invalidate() {
  }

  private loop = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (!this.visible || document.visibilityState === 'hidden') {
      this.last = now;
      return;
    }
    const min = this.soft ? 1000 / 8 : this.lowCpu ? 1000 / 30 : 0;
    this.acc += now - (this.last || now);
    this.last = now;
    if (this.acc < min - 1) return;
    const dt = Math.min(this.soft ? 0.12 : 0.05, this.acc / 1000 || 0.016);
    this.acc = 0;
    this.t += dt;
    this.onFrame(dt, this.t);
    this.renderer?.render(this.scene, this.camera);
  };

  /** A text sprite for dimensions and masses. Cached by text and style. */
  label(text: string, o: { color?: string; size?: number; bg?: string } = {}): THREE.Sprite {
    const key = `${text}|${o.color ?? ''}|${o.bg ?? ''}`;
    const hit = this.labels.get(key);
    const s = (hit ? new THREE.Sprite(hit.material) : this.makeLabel(text, o));
    if (!hit) this.labels.set(key, s);
    const k = o.size ?? 1;
    const img = (s.material.map!.image as HTMLCanvasElement);
    s.scale.set((img.width / 96) * k, (img.height / 96) * k, 1);
    return s;
  }
  private makeLabel(text: string, o: { color?: string; bg?: string }) {
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d')!;
    const font = '600 38px ui-sans-serif, system-ui, sans-serif';
    ctx.font = font;
    const w = Math.ceil(ctx.measureText(text).width) + 30, h = 62;
    c.width = w;
    c.height = h;
    ctx.font = font;
    if (o.bg) {
      ctx.fillStyle = o.bg;
      ctx.beginPath();
      ctx.roundRect(2, 2, w - 4, h - 4, 16);
      ctx.fill();
    }
    ctx.fillStyle = o.color ?? '#f1f7fb';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(text, w / 2, h / 2 + 2);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
    sp.renderOrder = 20;
    return sp;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.io?.disconnect();
    const c = this.canvas;
    c.removeEventListener('pointerdown', this.onDown);
    c.removeEventListener('pointermove', this.onMove);
    c.removeEventListener('pointerup', this.onUp);
    c.removeEventListener('pointercancel', this.onUp);
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) {
        (mat as THREE.MeshStandardMaterial).map?.dispose?.();
        mat.dispose();
      }
    });
    this.scene.environment?.dispose();
    if (this.renderer) {
      this.renderer.dispose();
      try {
        this.renderer.forceContextLoss();
      } catch {
        /* already gone */
      }
    }
  }
}

/* ───────────────────────── small builders shared by the scenes ───────────────────────── */

export const steel = (color: THREE.ColorRepresentation, o: { metal?: number; rough?: number; flat?: boolean; opacity?: number } = {}) =>
  new THREE.MeshStandardMaterial({
    color,
    metalness: o.metal ?? 0.35,
    roughness: o.rough ?? 0.55,
    flatShading: o.flat ?? false,
    transparent: o.opacity !== undefined && o.opacity < 1,
    opacity: o.opacity ?? 1,
    depthWrite: !(o.opacity !== undefined && o.opacity < 0.9),
  });

export function box(w: number, h: number, d: number, m: THREE.Material, cast = true): THREE.Mesh {
  const x = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  x.castShadow = cast;
  x.receiveShadow = true;
  return x;
}

export function cyl(rt: number, rb: number, h: number, m: THREE.Material, seg = 20, cast = true): THREE.Mesh {
  const x = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
  x.castShadow = cast;
  x.receiveShadow = true;
  return x;
}

/** Add a thin outline around a mesh (the drafting-board look). */
export function outline(mesh: THREE.Mesh, ink: THREE.LineBasicMaterial, angle = 35): THREE.LineSegments {
  const l = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, angle), ink);
  mesh.add(l);
  return l;
}

/** A cylinder stretched between two points. */
export function strut(a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material, seg = 10): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, seg), m);
  mesh.castShadow = true;
  setStrut(mesh, a, b, r);
  return mesh;
}
const UP = new THREE.Vector3(0, 1, 0);
export function setStrut(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, r: number) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length() || 1e-6;
  mesh.position.copy(a).addScaledVector(d, 0.5);
  mesh.quaternion.setFromUnitVectors(UP, d.multiplyScalar(1 / len));
  mesh.scale.set(r, len, r);
}

/** A soft ground that only shows the shadows cast on it. */
export function shadowFloor(w: number, d: number, y = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.ShadowMaterial({ opacity: 0.32 }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  m.receiveShadow = true;
  return m;
}
