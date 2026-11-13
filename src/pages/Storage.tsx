import { useEffect, useState } from "react";
import { api, fmtBytes, msg, StorageReport } from "../api";
import { toast } from "../stores";
import Icon from "../components/Icon";
import ProfileIcon from "../components/ProfileIcon";
import { Modal, Spinner } from "../components/Ui";

// Storage: how much space each profile (its worlds, mods, packs, screenshots, logs ...) and the shared game files
// take, and one-click clean-ups for what isn't needed (old logs, crash reports, unused Minecraft versions, cache).

const PART_COLORS: Record<string, string> = {
  worlds: "#7dffa0",
  mods: "#8cc8ff",
  resourcepacks: "#ffcd6e",
  shaderpacks: "#ff9ad5",
  screenshots: "#b9a6ff",
  replays: "#6fe3e3",
  logs: "#9a9aa6",
  crash: "#ff6a7d",
  other: "#5d5d68",
};
const SHARED_ICONS: Record<string, string> = {
  versions: "cube",
  libraries: "layers",
  assets: "volume",
  runtime: "memory",
  client: "sparkle",
  cache: "refresh",
};

export default function Storage({ running }: { running: boolean }) {
  const [r, setR] = useState<StorageReport | null>(null);
  const [busy, setBusy] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<StorageReport["cleanups"][number] | null>(null);

  const load = () => {
    api
      .storageReport()
      .then((x) => {
        setR(x);
        setOpen((o) => o ?? x.profiles[0]?.id ?? null);
      })
      .catch((e) => toast(msg(e), "error"));
  };
  useEffect(load, []);

  async function clean(key: string) {
    setConfirm(null);
    setBusy(key);
    try {
      const freed = await api.storageClean(key);
      toast(freed > 0 ? `Freed ${fmtBytes(freed)}` : "Nothing to clean", "ok");
      load();
    } catch (e) {
      toast(msg(e), "error");
    } finally {
      setBusy("");
    }
  }
  const openPath = (p: string) => api.storageOpen(p).catch((e) => toast(msg(e), "error"));

  if (!r) {
    return (
      <div className="page">
        <div className="page-head">
          <div>
            <h1>Storage</h1>
            <p className="muted">Measuring your profiles, worlds and game files…</p>
          </div>
        </div>
        <div className="center pad">
          <Spinner size={22} />
        </div>
      </div>
    );
  }

  const profilesBytes = r.profiles.reduce((n, p) => n + p.bytes, 0);
  const sharedBytes = r.shared.reduce((n, p) => n + p.bytes, 0);
  const cleanable = r.cleanups.reduce((n, c) => n + c.bytes, 0);

  return (
    <div className="page storage-page">
      {confirm && (
        <Modal title={`Delete ${confirm.label.toLowerCase()}?`} onClose={() => setConfirm(null)} width={460}>
          <p className="muted">
            {confirm.files} {confirm.key === "versions" ? `version folder${confirm.files === 1 ? "" : "s"}` : `file${confirm.files === 1 ? "" : "s"}`},{" "}
            {fmtBytes(confirm.bytes)}. They're deleted for good (not moved to the Recycle Bin).
            {confirm.key === "versions" && " A profile that needs one of them again just downloads it."}
          </p>
          <div className="modal-actions">
            <button className="btn" onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button className="btn danger" onClick={() => clean(confirm.key)}>
              <Icon name="trash" size={14} /> Delete
            </button>
          </div>
        </Modal>
      )}

      <div className="page-head">
        <div>
          <h1>Storage</h1>
          <p className="muted">What Com Client keeps on your PC, and what you can clean up.</p>
        </div>
        <button className="btn" onClick={() => { setR(null); load(); }}>
          <Icon name="refresh" size={14} /> Measure again
        </button>
      </div>

      <div className="pstats storage-stats">
        <div>
          <small>All together</small>
          <b>{fmtBytes(r.total)}</b>
        </div>
        <div>
          <small>Your profiles</small>
          <b>{fmtBytes(profilesBytes)}</b>
        </div>
        <div>
          <small>Game files</small>
          <b>{fmtBytes(sharedBytes)}</b>
        </div>
        <div>
          <small>Free on this drive</small>
          <b>{r.free ? fmtBytes(r.free) : "–"}</b>
        </div>
      </div>

      <section className="settings-block glass">
        <div className="block-head">
          <h2>
            <Icon name="sparkle" size={17} /> Clean up
          </h2>
          <span className="muted small">{cleanable > 0 ? `${fmtBytes(cleanable)} can go` : "Nothing to clean right now"}</span>
        </div>
        <div className="st-cleanups">
          {r.cleanups.map((c) => (
            <div key={c.key} className="st-clean">
              <div className="st-clean-text">
                <b>{c.label}</b>
                <span className="muted small">{c.detail}</span>
              </div>
              <b className="st-size">{fmtBytes(c.bytes)}</b>
              <button
                className="btn small"
                disabled={!c.bytes || !!busy || (c.key === "versions" && running)}
                title={c.key === "versions" && running ? "Close the game first" : undefined}
                onClick={() => setConfirm(c)}
              >
                {busy === c.key ? <Spinner size={12} /> : <Icon name="trash" size={13} />} Clean
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="settings-block glass">
        <div className="block-head">
          <h2>
            <Icon name="layers" size={17} /> Profiles
          </h2>
        </div>
        <div className="st-profiles">
          {r.profiles.map((p) => {
            const on = open === p.id;
            return (
              <div key={p.id} className={"st-profile" + (on ? " open" : "")}>
                <button className="st-profile-head" onClick={() => setOpen(on ? null : p.id)}>
                  <ProfileIcon icon={p.icon} size={34} />
                  <span className="st-profile-name">
                    <b>{p.name}</b>
                    <small className="muted">Minecraft {p.version}</small>
                  </span>
                  <span className="st-bar" aria-hidden="true">
                    {p.parts.map((x) => (
                      <i key={x.key} style={{ flexGrow: Math.max(x.bytes, 1), background: PART_COLORS[x.key] ?? "#777" }} />
                    ))}
                  </span>
                  <b className="st-size">{fmtBytes(p.bytes)}</b>
                  <Icon name="chevronDown" size={15} className={on ? "flip" : ""} />
                </button>
                {on && (
                  <div className="st-profile-body">
                    <div className="st-parts">
                      {p.parts.map((x) => (
                        <button key={x.key} className="st-part" onClick={() => openPath(x.path)} title="Open the folder">
                          <i style={{ background: PART_COLORS[x.key] ?? "#777" }} />
                          <span>{x.label}</span>
                          <b>{fmtBytes(x.bytes)}</b>
                        </button>
                      ))}
                    </div>
                    {p.worlds.length > 0 && (
                      <>
                        <h3 className="st-sub">Worlds</h3>
                        <div className="st-worlds">
                          {p.worlds.slice(0, 12).map((w) => (
                            <button key={w.path} className="st-world" onClick={() => openPath(w.path)} title="Open the world's folder">
                              <Icon name="globe" size={14} />
                              <span>{w.name}</span>
                              <b>{fmtBytes(w.bytes)}</b>
                            </button>
                          ))}
                        </div>
                        {p.worlds.length > 12 && <p className="muted small">and {p.worlds.length - 12} more</p>}
                      </>
                    )}
                    <button className="btn small" onClick={() => openPath(p.path)}>
                      <Icon name="folder" size={13} /> Open the profile's folder
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="settings-block glass">
        <div className="block-head">
          <h2>
            <Icon name="cube" size={17} /> Game files
          </h2>
          <span className="muted small">Shared by every profile</span>
        </div>
        <div className="st-parts">
          {r.shared.map((x) => (
            <button key={x.key} className="st-part" onClick={() => openPath(x.path)} title="Open the folder">
              <Icon name={SHARED_ICONS[x.key] ?? "folder"} size={14} />
              <span>{x.label}</span>
              <b>{fmtBytes(x.bytes)}</b>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
