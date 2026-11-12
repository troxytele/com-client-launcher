import { useEffect, useRef } from "react";
// the halo, hat and aura shapes are shared with the website's 3D viewer, so both look like the game
import { CUSTOM_CAPES, auraColour, auraPoints, glow, makeHalo, makeHat, playCape, setHatBase } from "../../website-src/helpers.js";
import { loadPet } from "../../website-src/pets.js";
import { makeWings } from "../../website-src/wings.js";

export { auraPoints };
setHatBase("/cosmetics/hats"); // the launcher keeps the voxel hats here
import * as THREE from "three";
import { IdleAnimation, SkinViewer } from "skinview3d";
import { Look } from "../api";


// A 3D player wearing the look: cape or wings on the back, halo and hat on the head, the aura around the body.
export default function LockerPreview({ skin, slim, look, cape, wings, zoom = 0.78, front = false }: { skin: string; slim: boolean; look: Look; cape: string | null; wings: string | null; zoom?: number; front?: boolean }) {
  const box_ = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewer = useRef<SkinViewer | null>(null);
  const extras = useRef<{ halo?: THREE.Group; hat?: THREE.Group; aura?: THREE.Group }>({});
  const pet = useRef<{ group: THREE.Group; tick(now: number): void; setColor(c: number): void; dispose(): void } | null>(null);
  const wingObj = useRef<{ group: THREE.Group; tick(now: number): void; dispose(): void } | null>(null);
  const lookRef = useRef(look);
  lookRef.current = look;

  useEffect(() => {
    if (!canvas.current || !box_.current) return;
    const v = new SkinViewer({ canvas: canvas.current, width: box_.current.clientWidth || 320, height: box_.current.clientHeight || 420, zoom, fov: 40 });
    v.controls.enableZoom = false;
    v.controls.enablePan = false;
    v.autoRotate = true;
    v.autoRotateSpeed = 0.6;
    v.playerWrapper.rotation.y = front ? -0.45 : Math.PI + 0.5; // the Locker starts from behind, so the cape / wings show
    v.globalLight.intensity = 3;
    v.cameraLight.intensity = 0.7;
    const idle = new IdleAnimation();
    v.animation = idle;
    viewer.current = v;
    const ro = new ResizeObserver(() => box_.current && v.setSize(box_.current.clientWidth, box_.current.clientHeight));
    ro.observe(box_.current);

    // the aura: a pool of glowing dots moved every frame
    const aura = new THREE.Group();
    const dots: THREE.Mesh[] = [];
    for (let i = 0; i < 70; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 8), glow(0xffffff, 0));
      dots.push(m);
      aura.add(m);
    }
    v.playerObject.add(aura);
    extras.current.aura = aura;
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const now = performance.now();
      const l = lookRef.current;
      pet.current?.tick(now);
      // feet of the model: skinview3d's player is 32 units tall, centred on 0
      const unit = 16;
      const feet = -16;
      let i = 0;
      if (l.aura !== "none") {
        auraPoints(l.aura, now, (x, y, z, size, bright, t) => {
          const d = dots[i++];
          if (!d) return;
          d.visible = true;
          d.position.set(x * unit, feet + y * unit, z * unit);
          d.scale.setScalar(Math.max(0.35, size * unit * 0.8));
          const mat = d.material as THREE.MeshBasicMaterial;
          mat.color = auraColour(l.aura, l.auraColor, t, now);
          mat.opacity = Math.max(0, Math.min(1, bright));
        });
      }
      for (; i < dots.length; i++) dots[i].visible = false;
      // wings: the elytra shape held out to the sides and beating, like the client (WingsFeature.java)
      wingObj.current?.tick(now);
      extras.current.hat?.userData.tick?.(now); // the fire of the Fire horns
      // orbiting sparks of the halo
      const halo = extras.current.halo;
      if (halo) {
        halo.position.y = 11 + Math.sin(now / 700) * 0.25;
        if (halo.userData.spin) halo.rotation.y = -(now / 1000) * 0.21; // the wreath turns slowly, like in game
        halo.children.forEach((c) => {
          if (c.userData.orbit !== undefined) {
            const a = now / 600 + (c.userData.orbit * Math.PI * 2) / 3;
            c.position.set(Math.cos(a) * 4.6, 0, Math.sin(a) * 4.6);
          }
        });
      }
    };
    tick();
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      v.dispose();
      viewer.current = null;
      extras.current = {};
    };
  }, []);

  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    if (skin) v.loadSkin(skin, { model: slim ? "slim" : "default" });
    else v.loadSkin(null);
  }, [skin, slim]);

  // the cape: Com Client's capes are (mostly animated) strips that come with the launcher. Wings are their own
  // model (below), so the cape keeps showing under them, like in game.
  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    let stop: (() => void) | null = null;
    let gone = false;
    if (CUSTOM_CAPES[look.cape]) {
      const img = new Image();
      img.onload = () => {
        if (!gone) stop = playCape(v, img, look.cape);
      };
      img.src = `/cosmetics/capes/${look.cape.slice(3)}.png`;
    } else if (cape) v.loadCape(cape, { backEquipment: "cape" });
    else v.loadCape(null);
    return () => {
      gone = true;
      if (stop) stop();
    };
  }, [cape, look.cape]);

  // wings, in their type (classic, butterfly, seraph, fairy, drake)
  useEffect(() => {
    const v = viewer.current;
    if (!v || !wings || look.wings === "none") return;
    let gone = false;
    let mine: typeof wingObj.current = null;
    makeWings(look.wings, wings).then((w) => {
      if (!w) return;
      if (gone) return w.dispose();
      mine = w;
      wingObj.current = w;
      v.playerObject.add(w.group);
    });
    return () => {
      gone = true;
      if (mine) {
        v.playerObject.remove(mine.group);
        mine.dispose();
        if (wingObj.current === mine) wingObj.current = null;
      }
    };
  }, [wings, look.wings]);

  // halo + hat on the head
  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    const head = v.playerObject.skin.head;
    for (const k of ["halo", "hat"] as const) {
      const old = extras.current[k];
      if (old) {
        head.remove(old);
        old.userData.dispose?.();
        delete extras.current[k];
      }
    }
    if (look.halo !== "none") {
      extras.current.halo = makeHalo(look.halo, look.haloColor & 0xffffff);
      head.add(extras.current.halo);
    }
    if (look.hat !== "none") {
      extras.current.hat = makeHat(look.hat, look.hatColor & 0xffffff);
      head.add(extras.current.hat);
    }
  }, [look.halo, look.haloColor, look.hat, look.hatColor]);

  // the pet: the game's own mob model on (or beside) the shoulder
  useEffect(() => {
    const v = viewer.current;
    if (!v || look.pet === "none") return;
    let gone = false;
    let mine: typeof pet.current = null;
    loadPet(look.pet, "/cosmetics/pets", look.petLeft).then((p) => {
      if (!p) return;
      if (gone) return p.dispose();
      mine = p;
      pet.current = p;
      p.setColor(lookRef.current.petColor ?? -1);
      v.playerObject.add(p.group);
    });
    return () => {
      gone = true;
      if (mine) {
        v.playerObject.remove(mine.group);
        mine.dispose();
        if (pet.current === mine) pet.current = null;
      }
    };
  }, [look.pet, look.petLeft]);

  // the pet's colour (own colours, a tint or a rainbow), the same as in game
  useEffect(() => {
    pet.current?.setColor(look.petColor ?? -1);
  }, [look.petColor, look.pet]);

  return (
    <div ref={box_} className="skin-model locker-model">
      <canvas ref={canvas} />
    </div>
  );
}
