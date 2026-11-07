import { useEffect, useRef } from "react";
import { IdleAnimation, SkinViewer, WalkingAnimation } from "skinview3d";

// A live 3D player model (drag to turn it). `skin` is a data: URL; empty = the default Steve look.
export default function SkinModel({
  skin,
  slim,
  animate = true,
  walk = false,
  zoom = 0.82,
  className,
}: {
  skin: string;
  slim: boolean;
  animate?: boolean;
  walk?: boolean;
  zoom?: number;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewer = useRef<SkinViewer | null>(null);

  useEffect(() => {
    if (!canvas.current || !box.current) return;
    const v = new SkinViewer({
      canvas: canvas.current,
      width: box.current.clientWidth || 300,
      height: box.current.clientHeight || 400,
      zoom,
      fov: 40,
    });
    v.controls.enableZoom = false;
    v.controls.enablePan = false;
    v.playerWrapper.rotation.y = -0.45;
    v.globalLight.intensity = 3;
    v.cameraLight.intensity = 0.7;
    viewer.current = v;
    const ro = new ResizeObserver(() => {
      if (box.current) v.setSize(box.current.clientWidth, box.current.clientHeight);
    });
    ro.observe(box.current);
    return () => {
      ro.disconnect();
      v.dispose();
      viewer.current = null;
    };
  }, [zoom]);

  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    if (skin) v.loadSkin(skin, { model: slim ? "slim" : "default" });
    else v.loadSkin(null);
  }, [skin, slim, zoom]);

  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    if (!animate) {
      v.animation = null;
      return;
    }
    const a = walk ? new WalkingAnimation() : new IdleAnimation();
    a.speed = walk ? 0.55 : 1;
    v.animation = a;
  }, [animate, walk, zoom]);

  return (
    <div ref={box} className={"skin-model " + (className ?? "")}>
      <canvas ref={canvas} />
    </div>
  );
}
