import { useCallback, useEffect, useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ago, api, fmtBytes, msg, Profile, Replay, Shot } from "../api";
import { toast } from "../stores";
import Icon from "../components/Icon";
import { Empty, Modal, Spinner } from "../components/Ui";

/** A screenshot through the launcher's own picture protocol (only screenshots folders are served). */
export function shotUrl(path: string) {
  return convertFileSrc(path, "ccimg");
}

// Gallery: every screenshot from every profile in one grid, and the ReplayMod recordings.
export default function Gallery({ profiles, running, onWatch }: { profiles: Profile[]; running: boolean; onWatch: (r: Replay) => void }) {
  const [tab, setTab] = useState<"shots" | "replays">("shots");
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Gallery</h1>
          <p className="muted">Screenshots (F2 in game) and ReplayMod recordings from all your profiles.</p>
        </div>
        <button className="btn" onClick={() => api.openFolder(tab === "shots" ? "screenshots" : "replay_recordings")}>
          <Icon name="folder" size={15} /> Open folder
        </button>
      </div>
      <div className="toolbar">
        <div className="seg">
          <button className={tab === "shots" ? "on" : ""} onClick={() => setTab("shots")}>
            <Icon name="image" size={15} /> Screenshots
          </button>
          <button className={tab === "replays" ? "on" : ""} onClick={() => setTab("replays")}>
            <Icon name="film" size={15} /> Replays
          </button>
        </div>
      </div>
      {tab === "shots" ? <Shots profiles={profiles} /> : <Replays profiles={profiles} running={running} onWatch={onWatch} />}
    </div>
  );
}

function ProfileFilter({ profiles, value, onChange }: { profiles: Profile[]; value: string; onChange: (v: string) => void }) {
  if (profiles.length < 2) return null;
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">All profiles</option>
      {profiles.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------- screenshots

function Shots({ profiles }: { profiles: Profile[] }) {
  const [shots, setShots] = useState<Shot[] | null>(null);
  const [profile, setProfile] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [del, setDel] = useState<Shot | null>(null);

  const load = useCallback(() => {
    api.shots().then(setShots).catch((e) => {
      setShots([]);
      toast(msg(e), "error");
    });
  }, []);
  useEffect(load, [load]);

  const shown = useMemo(() => (shots ?? []).filter((s) => !profile || s.profile === profile), [shots, profile]);

  async function copy(s: Shot) {
    try {
      await api.shotCopy(s.path);
      toast("Picture copied: paste it anywhere (Ctrl+V)", "ok");
    } catch (e) {
      toast(msg(e), "error");
    }
  }
  async function share(s: Shot) {
    try {
      await api.shotShare(s.path);
      toast("Ready to share: press Ctrl+V in Discord or a chat to attach it", "ok");
    } catch (e) {
      toast(msg(e), "error");
    }
  }
  async function remove(s: Shot) {
    try {
      await api.galleryDelete(s.path);
      setShots((cur) => (cur ?? []).filter((x) => x.path !== s.path));
      setDel(null);
      setOpen(null);
      toast("Screenshot deleted");
    } catch (e) {
      toast(msg(e), "error");
    }
  }

  // arrow keys in the big view
  useEffect(() => {
    if (open === null) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setOpen((i) => (i === null ? i : Math.min(shown.length - 1, i + 1)));
      if (e.key === "ArrowLeft") setOpen((i) => (i === null ? i : Math.max(0, i - 1)));
      if (e.key === "Delete" && open !== null && shown[open]) setDel(shown[open]);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, shown]);

  if (!shots)
    return (
      <div className="center pad">
        <Spinner />
      </div>
    );
  const cur = open !== null ? shown[open] : null;
  return (
    <>
      <div className="toolbar">
        <span className="muted">
          {shown.length} screenshot{shown.length === 1 ? "" : "s"}
        </span>
        <div className="row-gap">
          <ProfileFilter profiles={profiles} value={profile} onChange={setProfile} />
          <button className="btn" onClick={load}>
            <Icon name="refresh" size={15} /> Refresh
          </button>
        </div>
      </div>
      {shown.length === 0 ? (
        <Empty icon="image" title="No screenshots yet" text="Press F2 in the game. They show up here from every profile." />
      ) : (
        <div className="shot-grid">
          {shown.map((s, i) => (
            <div key={s.path} className="shot glass" onClick={() => setOpen(i)}>
              <img src={shotUrl(s.path)} loading="lazy" alt="" draggable={false} />
              <div className="shot-info">
                <b>{ago(s.modified)}</b>
                <span>{s.profile_name}</span>
              </div>
              <div className="shot-tools" onClick={(e) => e.stopPropagation()}>
                <button className="icon-btn" title="Open" onClick={() => api.openFile(s.path)}>
                  <Icon name="external" size={15} />
                </button>
                <button className="icon-btn" title="Copy picture" onClick={() => copy(s)}>
                  <Icon name="copy" size={15} />
                </button>
                <button className="icon-btn" title="Share (copies the file, Ctrl+V in Discord)" onClick={() => share(s)}>
                  <Icon name="share" size={15} />
                </button>
                <button className="icon-btn danger" title="Delete" onClick={() => setDel(s)}>
                  <Icon name="trash" size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {cur && (
        <div className="viewer" onMouseDown={(e) => e.target === e.currentTarget && setOpen(null)}>
          <img src={shotUrl(cur.path)} alt="" draggable={false} />
          <button className="viewer-nav left" disabled={open === 0} onClick={() => setOpen((i) => Math.max(0, (i ?? 0) - 1))}>
            <Icon name="chevron" size={22} className="flip" />
          </button>
          <button className="viewer-nav right" disabled={open === shown.length - 1} onClick={() => setOpen((i) => Math.min(shown.length - 1, (i ?? 0) + 1))}>
            <Icon name="chevron" size={22} />
          </button>
          <div className="viewer-bar glass">
            <div className="viewer-meta">
              <b>{cur.name}</b>
              <span className="muted">
                {cur.profile_name} · {new Date(cur.modified * 1000).toLocaleString()} · {fmtBytes(cur.size)}
              </span>
            </div>
            <button className="btn small" onClick={() => api.openFile(cur.path)}>
              <Icon name="external" size={14} /> Open
            </button>
            <button className="btn small" onClick={() => copy(cur)}>
              <Icon name="copy" size={14} /> Copy
            </button>
            <button className="btn small" onClick={() => share(cur)}>
              <Icon name="share" size={14} /> Share
            </button>
            <button className="btn small ghost danger" onClick={() => setDel(cur)}>
              <Icon name="trash" size={14} /> Delete
            </button>
            <button className="icon-btn" title="Close (Esc)" onClick={() => setOpen(null)}>
              <Icon name="x" size={16} />
            </button>
          </div>
        </div>
      )}
      {del && (
        <Modal title="Delete screenshot?" onClose={() => setDel(null)} width={400}>
          <p className="muted">{del.name} is deleted from your PC for good.</p>
          <div className="block-foot">
            <span className="grow" />
            <button className="btn" onClick={() => setDel(null)}>
              Keep it
            </button>
            <button className="btn danger" onClick={() => remove(del)}>
              <Icon name="trash" size={14} /> Delete
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

// ---------------------------------------------------------------- replays

function fmtLength(ms: number) {
  if (!ms) return "?";
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m ? `${m}:${String(s % 60).padStart(2, "0")}` : `${s} s`;
}

function Replays({ profiles, running, onWatch }: { profiles: Profile[]; running: boolean; onWatch: (r: Replay) => void }) {
  const [list, setList] = useState<Replay[] | null>(null);
  const [profile, setProfile] = useState("");
  const [del, setDel] = useState<Replay | null>(null);

  const load = useCallback(() => {
    api.replays().then(setList).catch((e) => {
      setList([]);
      toast(msg(e), "error");
    });
  }, []);
  useEffect(load, [load]);

  async function remove(r: Replay) {
    try {
      await api.galleryDelete(r.path);
      setList((cur) => (cur ?? []).filter((x) => x.path !== r.path));
      setDel(null);
      toast("Replay deleted");
    } catch (e) {
      toast(msg(e), "error");
    }
  }

  if (!list)
    return (
      <div className="center pad">
        <Spinner />
      </div>
    );
  const shown = list.filter((r) => !profile || r.profile === profile);
  return (
    <>
      <div className="toolbar">
        <span className="muted">
          {shown.length} recording{shown.length === 1 ? "" : "s"}
        </span>
        <div className="row-gap">
          <ProfileFilter profiles={profiles} value={profile} onChange={setProfile} />
          <button className="btn" onClick={load}>
            <Icon name="refresh" size={15} /> Refresh
          </button>
        </div>
      </div>
      {running && <p className="hint">The game is running: close it to watch a replay.</p>}
      {shown.length === 0 ? (
        <Empty
          icon="film"
          title="No replays yet"
          text="Turn on ReplayMod for a profile (Profiles page). Every time you play, it records; the recordings show up here."
        />
      ) : (
        <div className="list">
          {shown.map((r) => (
            <div key={r.path} className="item glass replay-row">
              <div className="item-icon none">
                <Icon name="film" size={20} />
              </div>
              <div className="item-text">
                <div className="item-title">
                  <b>{r.name}</b>
                  <span className="muted small">{fmtLength(r.duration_ms)}</span>
                </div>
                <p>
                  {r.server || "Singleplayer"} · {r.profile_name} · {ago(r.modified)} · {fmtBytes(r.size)}
                </p>
              </div>
              <div className="item-actions">
                <button className="btn primary small" disabled={running} onClick={() => onWatch(r)}>
                  <Icon name="play" size={13} fill /> Watch
                </button>
                <button className="icon-btn" title="Share (copies the file)" onClick={() => api.shotShare(r.path).then(() => toast("Replay file copied: Ctrl+V to send it", "ok")).catch((e) => toast(msg(e), "error"))}>
                  <Icon name="share" size={15} />
                </button>
                <button className="icon-btn danger" title="Delete" onClick={() => setDel(r)}>
                  <Icon name="trash" size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {del && (
        <Modal title="Delete replay?" onClose={() => setDel(null)} width={400}>
          <p className="muted">{del.name} is deleted from your PC for good.</p>
          <div className="block-foot">
            <span className="grow" />
            <button className="btn" onClick={() => setDel(null)}>
              Keep it
            </button>
            <button className="btn danger" onClick={() => remove(del)}>
              <Icon name="trash" size={14} /> Delete
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
