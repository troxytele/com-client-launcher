// Still pictures of skins for the library grid: one hidden 3D viewer renders them one after another
// (dozens of live 3D views would be too heavy).
import { SkinViewer } from "skinview3d";

const cache = new Map<string, string>();
let viewer: SkinViewer | null = null;
let chain: Promise<unknown> = Promise.resolve();

function getViewer() {
  if (!viewer) {
    const c = document.createElement("canvas");
    viewer = new SkinViewer({ canvas: c, width: 300, height: 400, preserveDrawingBuffer: true, renderPaused: true, zoom: 0.78, fov: 40 });
    viewer.globalLight.intensity = 3;
    viewer.cameraLight.intensity = 0.7;
  }
  return viewer;
}

/** A waving 3/4 view of the skin, as a PNG data URL (cached). */
export function shot(key: string, skin: string, slim: boolean): Promise<string> {
  const k = key + (slim ? ":s" : ":c") + skin.length;
  const hit = cache.get(k);
  if (hit) return Promise.resolve(hit);
  const job = chain.then(async () => {
    const v = getViewer();
    await v.loadSkin(skin, { model: slim ? "slim" : "default" });
    const p = v.playerObject;
    p.rotation.y = -0.5;
    const s = p.skin;
    s.leftArm.rotation.set(0, 0, 0);
    s.rightArm.rotation.set(0, 0, 0);
    s.rightArm.rotation.x = Math.PI * 0.95; // waving arm up
    s.rightArm.rotation.z = -0.35;
    s.leftArm.rotation.x = -0.25;
    s.rightLeg.rotation.x = 0.35;
    s.leftLeg.rotation.x = -0.35;
    v.render();
    const url = v.canvas.toDataURL("image/png");
    cache.set(k, url);
    return url;
  });
  chain = job.catch(() => undefined);
  return job;
}
