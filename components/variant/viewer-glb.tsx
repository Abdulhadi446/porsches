"use client";

import {
  Component,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  type ReactNode,
  type RefObject,
} from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Bounds, ContactShadows, OrbitControls, useGLTF } from "@react-three/drei";
import type { Group, Mesh, MeshStandardMaterial, Object3D } from "three";
import { attachDecoders, ensureKTX2, warmDecoders } from "./lib/decoders";
import { VIEWER_DPR_CEILING } from "./lib/webgl";
import type { Paint, WheelOption } from "./lib/palette";

/**
 * The WebGL stage — the ONLY component in components/variant that creates a
 * canvas. It is reached only through `viewer-3d.tsx`, which owns the WebGL
 * lease and mounts this only while the section is actually in view.
 *
 * Contract:
 *  - `frameloop` becomes `"never"` the moment the section leaves the viewport,
 *    so the GPU stops while the context stays warm (and is disposed as soon as
 *    `<Canvas>` unmounts);
 *  - DPR is capped at `VIEWER_DPR_CEILING`;
 *  - every 3D action is also a real DOM button, so the viewer is fully
 *    operable with a keyboard;
 *  - a failed glTF load lands in an error boundary and degrades to a message;
 */

export interface GlbInspection {
  /** is there a material it is honest to tint, and how did we find it? */
  paintBasis: "named" | "heuristic" | "none";
  wheelGroups: WheelOption[] | null;
  meshCount: number;
}

export interface GlbStageProps {
  url: string;
  paint: Paint;
  wheel: WheelOption | null;
  /** false when off screen → the render loop stops */
  active: boolean;
  onInspect: (report: GlbInspection) => void;
  accent: string;
}

type ControlsRef = RefObject<ComponentRef<typeof OrbitControls> | null>;

export function GlbStage({ url, paint, wheel, active, onInspect, accent }: GlbStageProps) {
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null);
  const cameraApiRef = useRef<((action: "in" | "out" | "reset") => void) | null>(null);
  const [spinning, setSpinning] = useState(false);

  // Warm the decoders before anything is parsed, so the first load already has
  // Meshopt (and Draco, once `/decoders` exists) wired into the loader.
  useEffect(() => {
    void warmDecoders();
  }, []);

  return (
    <div className="relative h-full w-full">
      <Boundary label="3D model">
        <Canvas
          dpr={[1, VIEWER_DPR_CEILING]}
          frameloop={active ? "always" : "never"}
          gl={{
            antialias: true,
            alpha: true,
            powerPreference: "high-performance",
            preserveDrawingBuffer: false,
          }}
          camera={{ fov: 32, position: [4.4, 1.7, 4.8], near: 0.1, far: 400 }}
          onCreated={({ gl }) => {
            gl.setClearColor(0x050506, 0);
          }}
          style={{ touchAction: "pan-y" }}
        >
          <Suspense fallback={null}>
            <Scene
              url={url}
              paint={paint}
              wheel={wheel}
              controlsRef={controlsRef}
              cameraApiRef={cameraApiRef}
              onInspect={onInspect}
              accent={accent}
            />
          </Suspense>
        </Canvas>
      </Boundary>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-between gap-(--space-2) bg-gradient-to-t from-ink to-transparent p-(--space-3)">
        <p className="label pointer-events-none hidden md:block">
          Drag to orbit · scroll to zoom
        </p>
        <div className="pointer-events-auto flex flex-wrap items-center gap-(--space-2)">
          <StageButton onClick={() => cameraApiRef.current?.("out")} label="Zoom out">
            −
          </StageButton>
          <StageButton onClick={() => cameraApiRef.current?.("in")} label="Zoom in">
            +
          </StageButton>
          <StageButton onClick={() => cameraApiRef.current?.("reset")} label="Reset view">
            Reset
          </StageButton>
          <StageButton
            onClick={() => setSpinning((value) => !value)}
            label={spinning ? "Stop auto-orbit" : "Start auto-orbit"}
            pressed={spinning}
          >
            {spinning ? "Stop spin" : "Auto-orbit"}
          </StageButton>
        </div>
      </div>
    </div>
  );
}

function StageButton({
  children,
  onClick,
  label,
  pressed,
}: {
  children: ReactNode;
  onClick: () => void;
  label: string;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      className="rounded-(--radius-sm) border border-ink-4 bg-ink-2/90 px-(--space-3) py-(--space-2) font-mono text-mono-xs uppercase tracking-(--tracking-mono) text-metal-300 transition-colors hover:border-metal-500 hover:text-metal-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guards"
    >
      {children}
    </button>
  );
}

function Scene({
  url,
  paint,
  wheel,
  controlsRef,
  cameraApiRef,
  onInspect,
  accent,
}: {
  url: string;
  paint: Paint;
  wheel: WheelOption | null;
  controlsRef: ControlsRef;
  cameraApiRef: RefObject<((action: "in" | "out" | "reset") => void) | null>;
  onInspect: (report: GlbInspection) => void;
  accent: string;
}) {
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);

  useEffect(() => {
    void ensureKTX2(gl);
  }, [gl]);

  useEffect(() => {
    cameraApiRef.current = (action) => {
      const instance = controlsRef.current;
      if (!instance) return;
      if (action === "reset") {
        instance.reset();
        return;
      }
      const scale = action === "in" ? 0.82 : 1.22;
      camera.position.setLength(camera.position.length() * scale);
      instance.update();
    };
    return () => {
      cameraApiRef.current = null;
    };
    // `controlsRef` / `cameraApiRef` are ref objects: stable for the lifetime of
    // the canvas, so listing them would only re-run this after a remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera]);

  // suspends while parsing; the boundary above turns a throw into a message
  const gltf = useGLTF(url, false, false, (loader) =>
    attachDecoders(loader as unknown as Parameters<typeof attachDecoders>[0]),
  );

  /** Clone the cached scene so materials are per instance and undoable. */
  const model = useMemo(() => {
    const clone = gltf.scene.clone(true) as Group;
    clone.traverse((node) => {
      const mesh = node as Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const source = mesh.material as MeshStandardMaterial | MeshStandardMaterial[] | undefined;
      if (!source) return;
      mesh.material = Array.isArray(source)
        ? source.map((material) => material.clone())
        : source.clone();
    });
    return clone;
  }, [gltf.scene]);

  const inspection = useMemo(() => inspectModel(model), [model]);

  useEffect(() => {
    onInspect(inspection);
  }, [inspection, onInspect]);

  /* ---- paint: only materials the inspection vouched for ---- */
  useEffect(() => {
    const targets = inspection.paintMaterials;
    model.traverse((node) => {
      const mesh = node as Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if (!targets.includes(material as MeshStandardMaterial)) continue;
        const standard = material as MeshStandardMaterial;
        standard.color.set(paint.hex);
        standard.metalness = paint.finish.metalness;
        standard.roughness = paint.finish.roughness;
        standard.needsUpdate = true;
      }
    });
  }, [inspection, model, paint]);

  /* ---- wheels: hide every named group except the selected one ---- */
  useEffect(() => {
    if (!wheel) return;
    model.traverse((node) => {
      if (!isWheelName(node.name)) return;
      node.visible = wheel.nodes.includes(node.name);
    });
  }, [model, wheel]);

  return (
    <>
      <ambientLight intensity={0.5} />
      <hemisphereLight args={["#f4f4f5", "#131317", 0.7]} />
      <directionalLight position={[4, 6, 3]} intensity={1.6} castShadow />
      <directionalLight position={[-5, 2, -4]} intensity={0.55} color={accent} />

      <Bounds fit clip observe margin={1.25}>
        <primitive object={model} />
      </Bounds>

      <ContactShadows
        position={[0, -0.02, 0]}
        opacity={0.5}
        scale={16}
        blur={2.6}
        far={5}
        resolution={512}
        color="#050506"
      />

      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={2}
        maxDistance={16}
        maxPolarAngle={Math.PI / 2.05}
        target={[0, 0.55, 0]}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* model inspection                                                   */
/* ------------------------------------------------------------------ */

const PAINT_NAME_RE = /(paint|body|bodywork|shell)/i;
const DECAL_NAME_RE = /(decal|livery|number|sign|sticker|graphic|vinyl)/i;
const GLASS_NAME_RE = /(glass|window|windscreen|screen_?glas)/i;
const WHEEL_NAME_RE = /(wheel|rim|alloy)/i;

function isWheelName(name: string): boolean {
  return WHEEL_NAME_RE.test(name);
}

/** Only paint-ish, opaque, non-livery, non-glass materials may be tinted. */
function isTintable(material: MeshStandardMaterial): boolean {
  if (!material || typeof material !== "object") return false;
  if (!("color" in material)) return false;
  const name = typeof material.name === "string" ? material.name : "";
  if (DECAL_NAME_RE.test(name)) return false;
  if (GLASS_NAME_RE.test(name)) return false;
  if (material.transparent && material.opacity < 0.99) return false;
  return true;
}

export interface ModelInspection extends GlbInspection {
  paintMaterials: MeshStandardMaterial[];
}

function sphereRadius(mesh: Mesh): number {
  try {
    const geometry = mesh.geometry;
    if (!geometry) return 0;
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    return geometry.boundingSphere?.radius ?? 0;
  } catch {
    return 0;
  }
}

function inspectModel(model: Object3D): ModelInspection {
  const materials: MeshStandardMaterial[] = [];
  const nodeNames: string[] = [];
  const named: MeshStandardMaterial[] = [];
  let largest = 0;
  let largestMaterial: MeshStandardMaterial | null = null;

  model.traverse((node) => {
    nodeNames.push(node.name);
    const mesh = node as Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of list) {
      const standard = material as MeshStandardMaterial;
      if (!isTintable(standard)) continue;
      materials.push(standard);
      const name = typeof standard.name === "string" ? standard.name : "";
      if (PAINT_NAME_RE.test(name)) {
        if (!named.includes(standard)) named.push(standard);
        continue;
      }
      const area = Math.PI * sphereRadius(mesh) ** 2;
      if (area > largest) {
        largest = area;
        largestMaterial = standard;
      }
    }
  });

  let paintMaterials = named;
  let paintBasis: GlbInspection["paintBasis"] = named.length > 0 ? "named" : "none";
  if (paintMaterials.length === 0 && largestMaterial) {
    paintMaterials = [largestMaterial];
    paintBasis = "heuristic";
  }

  return {
    paintBasis,
    paintMaterials,
    wheelGroups: wheelGroupsFrom(nodeNames),
    meshCount: materials.length,
  };
}

export function wheelGroupsFrom(nodeNames: readonly string[]): WheelOption[] | null {
  const groups = new Map<string, string[]>();
  let any = false;
  for (const name of nodeNames) {
    if (!isWheelName(name)) continue;
    any = true;
    const match = /^(?:wheel|rim|alloy)[-_]([a-z0-9]+)/i.exec(name);
    const id = match ? match[1].toLowerCase() : "default";
    const bucket = groups.get(id);
    if (bucket) bucket.push(name);
    else groups.set(id, [name]);
  }
  if (!any || groups.size < 2) return null;
  return [...groups.entries()].map(([id, nodes]) => ({
    id,
    label: id.charAt(0).toUpperCase() + id.slice(1),
    nodes,
  }));
}

/* ------------------------------------------------------------------ */
/* error boundary — a bad .glb must not take the page down            */
/* ------------------------------------------------------------------ */

interface BoundaryProps {
  children: ReactNode;
  label: string;
}

interface BoundaryState {
  message: string | null;
}

class Boundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { message: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return {
      message: error instanceof Error ? error.message : "The model could not be parsed.",
    };
  }

  componentDidCatch(error: unknown) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[viewer] 3D model failed to load:", error);
    }
  }

  render() {
    if (this.state.message) {
      return (
        <div className="absolute inset-0 grid place-items-center bg-ink-2 p-(--space-6)">
          <p className="max-w-[46ch] text-center font-mono text-mono-sm leading-relaxed tracking-(--tracking-mono) text-metal-500">
            The 3D model could not be loaded on this device. Every other part of this
            page works without it.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}