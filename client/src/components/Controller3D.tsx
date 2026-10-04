/**
 * Animated 3D game controller (PS5-style) for the login screen, built with
 * three.js from simple shapes — no model file to download.
 *
 *   - the body is a controller silhouette extruded into 3D
 *   - thumbsticks wiggle, △ ○ ✕ □ buttons light up in turn, the light bar
 *     cycles colour, and the whole controller floats and leans toward the mouse
 *
 * Loaded lazily (React.lazy) so three.js never delays the login form.
 * If WebGL isn't available, `onError` is called and the page shows a fallback.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/** Top-view outline of the controller (right half mirrored to the left). */
function controllerShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0, 1.0);
  s.bezierCurveTo(0.8, 1.05, 1.6, 1.1, 2.0, 0.9);
  s.bezierCurveTo(2.35, 0.7, 2.45, 0.1, 2.4, -0.4);
  s.bezierCurveTo(2.35, -1.0, 2.25, -1.55, 1.85, -1.65);
  s.bezierCurveTo(1.45, -1.75, 1.2, -1.3, 1.0, -0.85);
  s.bezierCurveTo(0.8, -0.5, 0.5, -0.45, 0, -0.45);
  s.bezierCurveTo(-0.5, -0.45, -0.8, -0.5, -1.0, -0.85);
  s.bezierCurveTo(-1.2, -1.3, -1.45, -1.75, -1.85, -1.65);
  s.bezierCurveTo(-2.25, -1.55, -2.35, -1.0, -2.4, -0.4);
  s.bezierCurveTo(-2.45, 0.1, -2.35, 0.7, -2.0, 0.9);
  s.bezierCurveTo(-1.6, 1.1, -0.8, 1.05, 0, 1.0);
  return s;
}

/** Flat symbol (△ ○ ✕ □) as a thin glowing mesh, to sit on a face button. */
function symbolMesh(kind: 'triangle' | 'circle' | 'cross' | 'square', color: THREE.Color): THREE.Mesh {
  const mat = new THREE.MeshBasicMaterial({ color });
  let geo: THREE.BufferGeometry;
  if (kind === 'circle') geo = new THREE.RingGeometry(0.055, 0.08, 32);
  else if (kind === 'square') {
    const shape = new THREE.Shape();
    shape.moveTo(-0.07, -0.07).lineTo(0.07, -0.07).lineTo(0.07, 0.07).lineTo(-0.07, 0.07).lineTo(-0.07, -0.07);
    const hole = new THREE.Path();
    hole.moveTo(-0.045, -0.045).lineTo(-0.045, 0.045).lineTo(0.045, 0.045).lineTo(0.045, -0.045).lineTo(-0.045, -0.045);
    shape.holes.push(hole);
    geo = new THREE.ShapeGeometry(shape);
  } else if (kind === 'triangle') {
    const outer = new THREE.Shape();
    outer.moveTo(0, 0.085).lineTo(0.08, -0.055).lineTo(-0.08, -0.055).lineTo(0, 0.085);
    const hole = new THREE.Path();
    hole.moveTo(0, 0.045).lineTo(-0.045, -0.032).lineTo(0.045, -0.032).lineTo(0, 0.045);
    outer.holes.push(hole);
    geo = new THREE.ShapeGeometry(outer);
  } else {
    const bar = new THREE.PlaneGeometry(0.2, 0.035);
    const a = bar.clone().rotateZ(Math.PI / 4);
    const b = bar.clone().rotateZ(-Math.PI / 4);
    const group = new THREE.Mesh(a, mat);
    group.add(new THREE.Mesh(b, mat));
    return group;
  }
  return new THREE.Mesh(geo, mat);
}

export default function Controller3D({ onError, spin = false }: { onError?: () => void; spin?: boolean }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const spinRef = useRef(spin);
  spinRef.current = spin;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch {
      onError?.();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    camera.position.set(0, 0.6, 9);
    camera.lookAt(0, 0, 0);

    // ---- lights: soft key light + neon magenta/cyan rims
    scene.add(new THREE.HemisphereLight(0xc7d2fe, 0x1e1b4b, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(2, 4, 6);
    scene.add(key);
    const rimL = new THREE.PointLight(0xd946ef, 40, 20);
    rimL.position.set(-5, 1, 2);
    scene.add(rimL);
    const rimR = new THREE.PointLight(0x22d3ee, 40, 20);
    rimR.position.set(5, -1, 2);
    scene.add(rimR);

    // ---- controller
    const controller = new THREE.Group();
    scene.add(controller);
    const disposables: Array<{ dispose: () => void }> = [];
    const track = <T extends { dispose: () => void }>(x: T) => (disposables.push(x), x);

    const bodyMat = track(new THREE.MeshPhysicalMaterial({ color: 0xe6e8f2, roughness: 0.38, metalness: 0.05, clearcoat: 0.8, clearcoatRoughness: 0.3 }));
    const darkMat = track(new THREE.MeshPhysicalMaterial({ color: 0x0f1226, roughness: 0.45, metalness: 0.2, clearcoat: 0.5 }));
    const DEPTH = 0.35;
    const BEVEL = 0.2;
    const bodyGeo = track(
      new THREE.ExtrudeGeometry(controllerShape(), {
        depth: DEPTH,
        bevelEnabled: true,
        bevelThickness: BEVEL,
        bevelSize: 0.18,
        bevelSegments: 8,
        curveSegments: 48,
      }),
    );
    bodyGeo.center();
    controller.add(new THREE.Mesh(bodyGeo, bodyMat));
    const FRONT = DEPTH / 2 + BEVEL; // z of the front face

    // Black centre plate behind the touchpad/sticks.
    const plate = new THREE.Mesh(track(new RoundedBoxGeometry(2.3, 1.35, 0.06, 4, 0.25)), darkMat);
    plate.position.set(0, 0.0, FRONT + 0.01);
    controller.add(plate);

    // Touchpad
    const pad = new THREE.Mesh(
      track(new RoundedBoxGeometry(1.5, 0.75, 0.08, 4, 0.12)),
      track(new THREE.MeshPhysicalMaterial({ color: 0x1a1f3d, roughness: 0.25, clearcoat: 1 })),
    );
    pad.position.set(0, 0.45, FRONT + 0.06);
    controller.add(pad);

    // Light bar (two glowing strips beside the touchpad) — colour cycles.
    const barMat = track(new THREE.MeshBasicMaterial({ color: 0x8b5cf6 }));
    for (const x of [-0.82, 0.82]) {
      const bar = new THREE.Mesh(track(new RoundedBoxGeometry(0.06, 0.7, 0.06, 2, 0.03)), barMat);
      bar.position.set(x, 0.45, FRONT + 0.07);
      bar.rotation.z = x < 0 ? -0.12 : 0.12;
      controller.add(bar);
    }

    // D-pad
    const dpadMat = track(new THREE.MeshPhysicalMaterial({ color: 0x2b3060, roughness: 0.4, clearcoat: 0.6 }));
    for (const [w, h] of [[0.62, 0.2], [0.2, 0.62]] as const) {
      const arm = new THREE.Mesh(track(new RoundedBoxGeometry(w, h, 0.1, 2, 0.05)), dpadMat);
      arm.position.set(-1.5, 0.25, FRONT + 0.03);
      controller.add(arm);
    }

    // Face buttons △ ○ ✕ □ with glowing symbols.
    const faces = [
      { kind: 'triangle', color: 0x34d399, pos: [0, 0.36] },
      { kind: 'circle', color: 0xf87171, pos: [0.36, 0] },
      { kind: 'cross', color: 0x60a5fa, pos: [0, -0.36] },
      { kind: 'square', color: 0xf472b6, pos: [-0.36, 0] },
    ] as const;
    const buttonGeo = track(new THREE.CylinderGeometry(0.16, 0.16, 0.1, 32));
    const faceButtons = faces.map((f) => {
      const mat = track(new THREE.MeshPhysicalMaterial({ color: 0x14172e, emissive: new THREE.Color(f.color), emissiveIntensity: 0.15, roughness: 0.3, clearcoat: 1 }));
      const btn = new THREE.Mesh(buttonGeo, mat);
      btn.rotation.x = Math.PI / 2;
      btn.position.set(1.5 + f.pos[0], 0.25 + f.pos[1], FRONT + 0.03);
      const sym = symbolMesh(f.kind, new THREE.Color(f.color));
      sym.scale.setScalar(1.25);
      sym.position.set(1.5 + f.pos[0], 0.25 + f.pos[1], FRONT + 0.085);
      controller.add(btn, sym);
      return mat;
    });

    // Thumbsticks — a base ring plus a cap that tilts.
    const sticks = [-0.68, 0.68].map((x) => {
      const base = new THREE.Mesh(track(new THREE.CylinderGeometry(0.34, 0.34, 0.08, 40)), darkMat);
      base.rotation.x = Math.PI / 2;
      base.position.set(x, -0.42, FRONT + 0.04);
      controller.add(base);

      const pivot = new THREE.Group();
      pivot.position.set(x, -0.42, FRONT + 0.06);
      const cap = new THREE.Mesh(track(new THREE.CylinderGeometry(0.27, 0.24, 0.22, 40)), darkMat);
      cap.rotation.x = Math.PI / 2;
      cap.position.z = 0.14;
      const ring = new THREE.Mesh(track(new THREE.TorusGeometry(0.24, 0.025, 12, 48)), barMat);
      ring.position.z = 0.26;
      pivot.add(cap, ring);
      controller.add(pivot);
      return pivot;
    });

    // PS button
    const psMat = track(new THREE.MeshBasicMaterial({ color: 0xc7d2fe }));
    const ps = new THREE.Mesh(track(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 32)), psMat);
    ps.rotation.x = Math.PI / 2;
    ps.position.set(0, -0.32, FRONT + 0.04);
    controller.add(ps);

    // Shoulder buttons (L1/R1) along the top edge.
    for (const x of [-1.55, 1.55]) {
      const l1 = new THREE.Mesh(track(new RoundedBoxGeometry(0.9, 0.22, 0.5, 3, 0.1)), darkMat);
      l1.position.set(x, 0.98, -0.05);
      l1.rotation.z = x < 0 ? 0.12 : -0.12;
      controller.add(l1);
    }

    controller.scale.setScalar(1.12);

    // ---- sizing
    const resize = () => {
      const { clientWidth: w, clientHeight: h } = mount;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      camera.aspect = w / h;
      // Keep the whole controller in view on narrow screens.
      camera.position.z = w / h < 1.2 ? 9 / Math.max(0.6, w / h / 1.2) : 9;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(mount);
    resize();

    // ---- mouse: the controller leans toward the cursor
    const pointer = { x: 0, y: 0 };
    const onPointer = (e: PointerEvent) => {
      pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener('pointermove', onPointer);

    // ---- animation loop
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const clock = new THREE.Clock();
    const lightColor = new THREE.Color();
    let frame = 0;
    let spinAngle = 0;

    const render = () => {
      const dt = Math.min(clock.getDelta(), 0.05); // must come first: it also advances elapsedTime
      const t = clock.elapsedTime;

      // Float, gentle sway, lean toward the mouse (smoothed).
      spinAngle += (spinRef.current ? 6 : 0) * dt;
      const targetY = Math.sin(t * 0.5) * 0.35 + pointer.x * 0.45 + spinAngle;
      const targetX = -0.42 + pointer.y * 0.25;
      controller.rotation.y += (targetY - controller.rotation.y) * 0.06;
      controller.rotation.x += (targetX - controller.rotation.x) * 0.06;
      controller.rotation.z = Math.sin(t * 0.7) * 0.04;
      controller.position.y = Math.sin(t * 1.2) * 0.12;

      // Thumbsticks move in little circles.
      sticks[0].rotation.x = Math.sin(t * 1.6) * 0.3;
      sticks[0].rotation.y = Math.cos(t * 1.6) * 0.3;
      sticks[1].rotation.x = Math.cos(t * 1.1) * 0.25;
      sticks[1].rotation.y = Math.sin(t * 2.2) * 0.25;

      // Face buttons light up one after another.
      const active = Math.floor(t * 1.5) % faceButtons.length;
      faceButtons.forEach((m, i) => {
        const target = i === active ? 1.6 : 0.15;
        m.emissiveIntensity += (target - m.emissiveIntensity) * 0.15;
      });

      // Light bar colour cycle (violet → pink → cyan).
      lightColor.setHSL(0.72 + Math.sin(t * 0.6) * 0.12, 0.85, 0.6);
      barMat.color.copy(lightColor);

      renderer.render(scene, camera);
      if (!reduceMotion) frame = requestAnimationFrame(render);
    };
    render();

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onPointer);
      ro.disconnect();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
        }
      });
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [onError]);

  return <div ref={mountRef} className="h-full w-full" aria-hidden />;
}
