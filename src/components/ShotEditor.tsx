import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, msg, Shot } from "../api";
import { toast } from "../stores";
import { shotUrl } from "../pages/Gallery";
import Icon from "./Icon";
import { Spinner } from "./Ui";

// Screenshot editor: crop, draw, arrows, boxes, text and blur, then save as a copy next to the original, copy the
// picture, get a link or share it to Discord. Everything is kept as a list of steps, so Undo / Redo is easy, and the
// picture is drawn again from the original every time (nothing gets blurry from editing twice).

type Pt = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };
type Op =
  | { t: "pen"; pts: Pt[]; color: string; size: number }
  | { t: "arrow"; a: Pt; b: Pt; color: string; size: number }
  | { t: "rect"; a: Pt; b: Pt; color: string; size: number }
  | { t: "text"; at: Pt; text: string; color: string; size: number }
  | { t: "blur"; a: Pt; b: Pt };
type Tool = "crop" | "pen" | "arrow" | "rect" | "text" | "blur";

const COLORS = ["#ff4d5e", "#ffcd3c", "#4ade80", "#4db8ff", "#b9a6ff", "#ffffff", "#111111"];
const TOOLS: { id: Tool; icon: string; label: string; key: string }[] = [
  { id: "crop", icon: "box", label: "Crop", key: "c" },
  { id: "pen", icon: "edit", label: "Draw", key: "d" },
  { id: "arrow", icon: "arrowRight", label: "Arrow", key: "a" },
  { id: "rect", icon: "block", label: "Box", key: "b" },
  { id: "text", icon: "file", label: "Text", key: "t" },
  { id: "blur", icon: "lock", label: "Blur", key: "x" },
];

const norm = (a: Pt, b: Pt): Rect => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });

function drawOp(g: CanvasRenderingContext2D, op: Op, scale: number) {
  g.save();
  g.lineCap = "round";
  g.lineJoin = "round";
  if (op.t === "pen") {
    g.strokeStyle = op.color;
    g.lineWidth = op.size * scale;
    g.beginPath();
    op.pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    if (op.pts.length === 1) g.lineTo(op.pts[0].x + 0.1, op.pts[0].y);
    g.stroke();
  } else if (op.t === "arrow") {
    const w = op.size * scale;
    const ang = Math.atan2(op.b.y - op.a.y, op.b.x - op.a.x);
    const head = Math.max(14 * scale, w * 3.2);
    g.strokeStyle = g.fillStyle = op.color;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(op.a.x, op.a.y);
    g.lineTo(op.b.x - Math.cos(ang) * head * 0.6, op.b.y - Math.sin(ang) * head * 0.6);
    g.stroke();
    g.beginPath();
    g.moveTo(op.b.x, op.b.y);
    g.lineTo(op.b.x - Math.cos(ang - 0.45) * head, op.b.y - Math.sin(ang - 0.45) * head);
    g.lineTo(op.b.x - Math.cos(ang + 0.45) * head, op.b.y - Math.sin(ang + 0.45) * head);
    g.closePath();
    g.fill();
  } else if (op.t === "rect") {
    const r = norm(op.a, op.b);
    g.strokeStyle = op.color;
    g.lineWidth = op.size * scale;
    g.beginPath();
    g.roundRect(r.x, r.y, r.w, r.h, 6 * scale);
    g.stroke();
  } else if (op.t === "text") {
    const px = op.size * 6 * scale;
    g.font = `700 ${px}px Poppins, system-ui, sans-serif`;
    g.textBaseline = "top";
    g.lineWidth = Math.max(2, px / 7);
    g.strokeStyle = op.color === "#111111" ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0.75)";
    op.text.split("\n").forEach((line, i) => {
      g.strokeText(line, op.at.x, op.at.y + i * px * 1.15);
      g.fillStyle = op.color;
      g.fillText(line, op.at.x, op.at.y + i * px * 1.15);
    });
  } else if (op.t === "blur") {
    // pixelate the area: hides names, chat and coordinates for real (a soft blur can be undone)
    const r = norm(op.a, op.b);
    if (r.w >= 2 && r.h >= 2) {
      const cell = Math.max(8, Math.round(Math.min(r.w, r.h) / 12));
      const tmp = document.createElement("canvas");
      tmp.width = Math.max(1, Math.round(r.w / cell));
      tmp.height = Math.max(1, Math.round(r.h / cell));
      const tg = tmp.getContext("2d")!;
      tg.imageSmoothingEnabled = true;
      tg.drawImage(g.canvas, r.x, r.y, r.w, r.h, 0, 0, tmp.width, tmp.height);
      g.imageSmoothingEnabled = false;
      g.drawImage(tmp, 0, 0, tmp.width, tmp.height, r.x, r.y, r.w, r.h);
    }
  }
  g.restore();
}

export default function ShotEditor({ shot, onClose, onSaved }: { shot: Shot; onClose: () => void; onSaved: (path: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [ops, setOps] = useState<Op[]>([]);
  const [redo, setRedo] = useState<Op[]>([]);
  const [crop, setCrop] = useState<Rect | null>(null);
  const [tool, setTool] = useState<Tool>("arrow");
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(6);
  const [draft, setDraft] = useState<Op | null>(null);
  const [cropDraft, setCropDraft] = useState<Rect | null>(null);
  const [typing, setTyping] = useState<{ at: Pt; text: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [saved, setSaved] = useState<string | null>(null); // the edited file, once saved (until changed again)
  const start = useRef<Pt | null>(null);

  // the original picture (through the launcher's picture protocol, which allows reading it back from the canvas)
  useEffect(() => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => setImg(i);
    i.onerror = () => toast("Couldn't open the picture", "error");
    i.src = shotUrl(shot.path);
  }, [shot.path]);

  // a stroke size that looks the same on a 720p and a 4K screenshot
  const scale = img ? Math.max(1, img.naturalWidth / 1280) : 1;

  // draw everything again whenever something changes
  useEffect(() => {
    const c = canvas.current;
    if (!c || !img) return;
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0);
    for (const op of ops) drawOp(g, op, scale);
    if (draft) drawOp(g, draft, scale);
    if (typing && typing.text) drawOp(g, { t: "text", at: typing.at, text: typing.text + "▏", color, size }, scale);
    const cr = cropDraft ?? crop;
    if (cr) {
      // darken what gets cut away
      g.save();
      g.fillStyle = "rgba(0,0,0,0.55)";
      g.beginPath();
      g.rect(0, 0, c.width, c.height);
      g.rect(cr.x, cr.y, cr.w, cr.h);
      g.fill("evenodd");
      g.strokeStyle = "#fff";
      g.lineWidth = 2 * scale;
      g.setLineDash([10 * scale, 7 * scale]);
      g.strokeRect(cr.x, cr.y, cr.w, cr.h);
      g.restore();
    }
  }, [img, ops, draft, crop, cropDraft, typing, color, size, scale]);

  useEffect(() => setSaved(null), [ops, crop]);

  function pos(e: React.PointerEvent): Pt {
    const c = canvas.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
  }

  function commit(op: Op) {
    setOps((o) => [...o, op]);
    setRedo([]);
  }
  function commitText() {
    if (typing && typing.text.trim()) commit({ t: "text", at: typing.at, text: typing.text, color, size });
    setTyping(null);
  }

  function down(e: React.PointerEvent) {
    if (!img) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const p = pos(e);
    if (tool === "text") {
      commitText();
      setTyping({ at: p, text: "" });
      return;
    }
    commitText();
    start.current = p;
    if (tool === "crop") setCropDraft({ x: p.x, y: p.y, w: 0, h: 0 });
    else if (tool === "pen") setDraft({ t: "pen", pts: [p], color, size });
    else if (tool === "blur") setDraft({ t: "blur", a: p, b: p });
    else setDraft({ t: tool, a: p, b: p, color, size } as Op);
  }
  function move(e: React.PointerEvent) {
    const s = start.current;
    if (!s) return;
    const p = pos(e);
    if (tool === "crop") setCropDraft(norm(s, p));
    else if (draft?.t === "pen") setDraft({ ...draft, pts: [...draft.pts, p] });
    else if (draft && "b" in draft) setDraft({ ...draft, b: p } as Op);
  }
  function up() {
    if (!start.current) return;
    start.current = null;
    if (tool === "crop") {
      if (cropDraft && cropDraft.w > 8 && cropDraft.h > 8) setCrop(cropDraft);
      setCropDraft(null);
      return;
    }
    if (draft) {
      const tiny = "b" in draft && Math.hypot(draft.b.x - draft.a.x, draft.b.y - draft.a.y) < 4;
      if (!tiny) commit(draft);
      setDraft(null);
    }
  }

  function undo() {
    if (typing) return setTyping(null);
    if (ops.length) {
      setRedo((r) => [ops[ops.length - 1], ...r]);
      setOps((o) => o.slice(0, -1));
    } else if (crop) setCrop(null);
  }
  function redoOne() {
    if (!redo.length) return;
    setOps((o) => [...o, redo[0]]);
    setRedo((r) => r.slice(1));
  }

  // keys: Ctrl+Z / Ctrl+Y, tool letters, Esc
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (typing) {
        if (e.key === "Escape") setTyping(null);
        else if (e.key === "Enter" && !e.shiftKey) commitText();
        else if (e.key === "Enter") setTyping({ ...typing, text: typing.text + "\n" });
        else if (e.key === "Backspace") setTyping({ ...typing, text: typing.text.slice(0, -1) });
        else if (e.key.length === 1 && !e.ctrlKey) setTyping({ ...typing, text: typing.text + e.key });
        else return;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.ctrlKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
      } else if (e.ctrlKey && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redoOne();
      } else if (e.key === "Escape") onClose();
      else {
        const t = TOOLS.find((x) => x.key === e.key.toLowerCase());
        if (t && !e.ctrlKey) setTool(t.id);
      }
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  });

  /** The finished picture (cropped), as a PNG data URL. */
  function render(): string {
    const c = document.createElement("canvas");
    const g = c.getContext("2d")!;
    const r = crop ?? { x: 0, y: 0, w: img!.naturalWidth, h: img!.naturalHeight };
    const full = document.createElement("canvas");
    full.width = img!.naturalWidth;
    full.height = img!.naturalHeight;
    const fg = full.getContext("2d")!;
    fg.drawImage(img!, 0, 0);
    for (const op of ops) drawOp(fg, op, scale);
    if (typing && typing.text.trim()) drawOp(fg, { t: "text", at: typing.at, text: typing.text, color, size }, scale);
    c.width = Math.max(1, Math.round(r.w));
    c.height = Math.max(1, Math.round(r.h));
    g.drawImage(full, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
    return c.toDataURL("image/png");
  }

  /** Saves the edit as a copy (once per change) and gives its path. */
  async function save(): Promise<string> {
    if (saved) return saved;
    const p = await api.shotSaveEdit(shot.path, render());
    setSaved(p);
    onSaved(p);
    return p;
  }

  async function act(kind: string, f: () => Promise<void>) {
    commitText();
    setBusy(kind);
    try {
      await f();
    } catch (e) {
      toast(msg(e), "error");
    } finally {
      setBusy("");
    }
  }

  const changed = ops.length > 0 || !!crop || !!(typing && typing.text.trim());

  // drawn over the whole window (the page itself sits under the side rail)
  return createPortal(
    <div className="sed">
      <div className="sed-top glass">
        <div className="sed-tools">
          {TOOLS.map((t) => (
            <button key={t.id} className={"sed-tool" + (tool === t.id ? " on" : "")} title={`${t.label} (${t.key.toUpperCase()})`} onClick={() => setTool(t.id)}>
              <Icon name={t.icon} size={15} />
              <span>{t.label}</span>
            </button>
          ))}
        </div>
        <span className="sed-sep" />
        <div className="sed-colors">
          {COLORS.map((c) => (
            <button key={c} className={"sed-color" + (color === c ? " on" : "")} style={{ background: c }} title={c} onClick={() => setColor(c)} />
          ))}
        </div>
        <input className="sed-size" type="range" min={2} max={20} value={size} title="Thickness / text size" onChange={(e) => setSize(+e.target.value)} />
        <span className="sed-sep" />
        <button className="icon-btn" title="Undo (Ctrl+Z)" disabled={!ops.length && !crop && !typing} onClick={undo}>
          <Icon name="refresh" size={15} className="flip" />
        </button>
        <button className="icon-btn" title="Redo (Ctrl+Y)" disabled={!redo.length} onClick={redoOne}>
          <Icon name="refresh" size={15} />
        </button>
        {crop && (
          <button className="btn small ghost" onClick={() => setCrop(null)}>
            <Icon name="x" size={13} /> Uncrop
          </button>
        )}
        <span className="grow" />
        <button className="btn small" disabled={!changed || !!busy} onClick={() => act("save", async () => {
          await save();
          toast("Saved as a copy next to the original", "ok");
        })}>
          {busy === "save" ? <Spinner size={12} /> : <Icon name="download" size={14} />} Save copy
        </button>
        <button className="btn small" disabled={!img || !!busy} onClick={() => act("copy", async () => {
          await api.shotCopy(changed ? await save() : shot.path);
          toast("Picture copied: paste it anywhere (Ctrl+V)", "ok");
        })}>
          {busy === "copy" ? <Spinner size={12} /> : <Icon name="copy" size={14} />} Copy
        </button>
        <button className="btn small" disabled={!img || !!busy} onClick={() => act("link", async () => {
          const url = await api.shotLink(changed ? await save() : shot.path);
          await navigator.clipboard.writeText(url).catch(() => {});
          toast("Link copied: " + url.replace("https://", ""), "ok");
        })}>
          {busy === "link" ? <Spinner size={12} /> : <Icon name="link" size={14} />} Get link
        </button>
        <button className="btn small primary" disabled={!img || !!busy} onClick={() => act("share", async () => {
          await api.shotShare(changed ? await save() : shot.path);
          toast("Ready for Discord: press Ctrl+V in a chat to attach it", "ok");
        })}>
          {busy === "share" ? <Spinner size={12} /> : <Icon name="share" size={14} />} Share to Discord
        </button>
        <button className="icon-btn" title="Close (Esc)" onClick={onClose}>
          <Icon name="x" size={16} />
        </button>
      </div>
      <div className="sed-stage">
        {!img && <Spinner size={22} />}
        <canvas
          ref={canvas}
          className={"sed-canvas tool-" + tool}
          style={{ display: img ? "block" : "none" }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
        />
        {tool === "text" && !typing && <p className="sed-hint">Click where the text goes, then type. Enter = done, Shift+Enter = new line.</p>}
        {tool === "crop" && !crop && <p className="sed-hint">Drag over the part you want to keep.</p>}
        {tool === "blur" && <p className="sed-hint">Drag over names, chat or coordinates to hide them.</p>}
      </div>
    </div>,
    document.body,
  );
}
