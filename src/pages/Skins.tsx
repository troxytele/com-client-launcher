import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Account, api, Look, msg, Skin } from "../api";
import { toast } from "../stores";
import { shot } from "../skinShots";
import Icon from "../components/Icon";
import SkinModel from "../components/SkinModel";
import LockerPreview from "../components/LockerPreview";
import { Empty, Modal, Spinner } from "../components/Ui";

// Your skin library: click a skin to wear it right away; edit name and arm type; add from a file or another player.
export default function Skins({ signedIn, onAccounts, onSkinChanged }: { signedIn: boolean; onAccounts: (a: Account[]) => void; onSkinChanged: () => void }) {
  const [skins, setSkins] = useState<Skin[] | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [edit, setEdit] = useState<Skin | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    api.skins().then(setSkins).catch((e) => {
      setSkins([]);
      toast(msg(e), "error");
    });
  }, []);
  useEffect(load, [load]);

  async function wear(s: Skin) {
    if (!signedIn) return toast("Sign in with your Microsoft account first", "error");
    setBusy(s.id);
    try {
      onAccounts(await api.skinApply(s.id));
      toast("You're now wearing " + s.name, "ok");
      load();
      onSkinChanged();
    } catch (e) {
      toast(msg(e), "error");
    } finally {
      setBusy(null);
    }
  }

  const shown = (skins ?? []).filter((s) => s.name.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Skins</h1>
          <p className="muted">Click a skin to wear it. It changes right away (rejoin a server to see it there).</p>
        </div>
        <button className="btn primary" onClick={() => setAdding(true)}>
          <Icon name="plus" size={15} /> Add skin
        </button>
      </div>
      <div className="toolbar">
        <div className="search">
          <Icon name="search" size={16} />
          <input placeholder="Search skins…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>
      {!skins ? (
        <div className="center pad">
          <Spinner />
        </div>
      ) : (
        <div className="skin-grid">
          {!query && (
            <button className="skin-card add" onClick={() => setAdding(true)}>
              <div className="skin-add-icon">
                <Icon name="plus" size={26} />
              </div>
              <b>Add new skin</b>
              <span>Upload a file or copy a player's skin</span>
            </button>
          )}
          {shown.map((s) => (
            <SkinCard
              key={s.id}
              skin={s}
              busy={busy === s.id}
              onWear={() => wear(s)}
              onEdit={() => setEdit(s)}
              onDelete={() =>
                api
                  .skinDelete(s.id)
                  .then(() => {
                    toast("Deleted " + s.name);
                    load();
                  })
                  .catch((e) => toast(msg(e), "error"))
              }
            />
          ))}
        </div>
      )}
      {skins && skins.length === 0 && query === "" && !signedIn && (
        <Empty icon="user" title="No skins yet" text="Sign in and your current skin shows up here, or add one." />
      )}
      {edit && (
        <EditSkin
          skin={edit}
          onClose={() => setEdit(null)}
          onSaved={(apply) => {
            setEdit(null);
            load();
            if (apply) wear(edit);
          }}
        />
      )}
      {adding && (
        <AddSkin
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function SkinCard({ skin, busy, onWear, onEdit, onDelete }: { skin: Skin; busy: boolean; onWear: () => void; onEdit: () => void; onDelete: () => void }) {
  const [img, setImg] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    shot(skin.id, skin.data, skin.variant === "slim").then((u) => live && setImg(u)).catch(() => {});
    return () => {
      live = false;
    };
  }, [skin.id, skin.data, skin.variant]);
  return (
    <div className={"skin-card" + (skin.active ? " active" : "")} onClick={() => !busy && !skin.active && onWear()}>
      <div className="skin-tools" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn" title="Edit" onClick={onEdit}>
          <Icon name="edit" size={14} />
        </button>
        {!skin.active && (
          <button className="icon-btn danger" title="Delete" onClick={onDelete}>
            <Icon name="trash" size={14} />
          </button>
        )}
      </div>
      <div className="skin-shot">{img ? <img src={img} alt="" /> : <Spinner />}</div>
      <b>{skin.name}</b>
      <span>
        {skin.active ? (
          <>
            <Icon name="check" size={12} /> Wearing
          </>
        ) : busy ? (
          <>
            <Spinner size={10} /> Applying…
          </>
        ) : skin.variant === "slim" ? (
          "Slim"
        ) : (
          "Classic"
        )}
      </span>
    </div>
  );
}

function VariantPick({ value, onChange }: { value: string; onChange: (v: "classic" | "slim") => void }) {
  return (
    <div className="variant-pick">
      {(["classic", "slim"] as const).map((v) => (
        <button key={v} className={value === v ? "on" : ""} onClick={() => onChange(v)}>
          <span className="check-box">{value === v && <Icon name="check" size={12} />}</span>
          {v === "classic" ? "Classic (Steve)" : "Slim (Alex)"}
        </button>
      ))}
    </div>
  );
}

function EditSkin({ skin, onClose, onSaved }: { skin: Skin; onClose: () => void; onSaved: (apply: boolean) => void }) {
  const [name, setName] = useState(skin.name);
  const [variant, setVariant] = useState<"classic" | "slim">(skin.variant);
  const [saving, setSaving] = useState(false);
  // try the skin on with what you wear (cape, wings, hat, halo, pet...)
  const [look, setLook] = useState<Look | null>(null);
  const [withLook, setWithLook] = useState(true);
  useEffect(() => {
    api.lookGet().then(setLook).catch(() => setLook(null));
  }, []);
  async function save(apply: boolean) {
    setSaving(true);
    try {
      await api.skinUpdate(skin.id, name, variant);
      onSaved(apply);
    } catch (e) {
      toast(msg(e), "error");
      setSaving(false);
    }
  }
  return (
    <Modal title="Edit skin" onClose={onClose} width={420}>
      <input value={name} maxLength={32} onChange={(e) => setName(e.target.value)} placeholder="Name" />
      {look && withLook ? (
        <div className="edit-model">
          <LockerPreview
            skin={skin.data}
            slim={variant === "slim"}
            look={look}
            cape={look.cape !== "none" ? `/cosmetics/capes/${look.cape.slice(3)}.png` : null}
            wings={look.wings !== "none" ? `/cosmetics/wings/${look.wings}.png` : null}
            zoom={0.8}
          />
        </div>
      ) : (
        <SkinModel skin={skin.data} slim={variant === "slim"} className="edit-model" zoom={0.85} />
      )}
      {look && (
        <label className="row-gap small muted" style={{ cursor: "pointer" }}>
          <input type="checkbox" checked={withLook} onChange={(e) => setWithLook(e.target.checked)} /> With my cosmetics
        </label>
      )}
      <VariantPick value={variant} onChange={setVariant} />
      <div className="block-foot">
        <span className="grow" />
        <button className="btn" disabled={saving} onClick={() => save(false)}>
          Save
        </button>
        <button className="btn primary" disabled={saving} onClick={() => save(true)}>
          <Icon name="check" size={14} /> Save & wear
        </button>
      </div>
    </Modal>
  );
}

function AddSkin({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [tab, setTab] = useState<"file" | "player">("file");
  const [file, setFile] = useState("");
  const [name, setName] = useState("");
  const [player, setPlayer] = useState("");
  const [variant, setVariant] = useState<"classic" | "slim">("classic");
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    try {
      if (tab === "file") await api.skinAdd(file, name, variant);
      else await api.skinImport(player);
      toast("Skin added", "ok");
      onAdded();
    } catch (e) {
      toast(msg(e), "error");
      setBusy(false);
    }
  }

  return (
    <Modal title="Add a skin" onClose={onClose} width={420}>
      <div className="seg full">
        <button className={tab === "file" ? "on" : ""} onClick={() => setTab("file")}>
          <Icon name="folder" size={14} /> From a file
        </button>
        <button className={tab === "player" ? "on" : ""} onClick={() => setTab("player")}>
          <Icon name="user" size={14} /> From a player
        </button>
      </div>
      {tab === "file" ? (
        <>
          <div className="field">
            <label>Skin file (PNG, 64×64)</label>
            <div className="row-gap">
              <input value={file} readOnly placeholder="No file picked" />
              <button
                className="btn small"
                onClick={async () => {
                  const f = await open({ title: "Choose a skin", filters: [{ name: "Skin", extensions: ["png"] }] });
                  if (typeof f === "string") {
                    setFile(f);
                    if (!name) setName(f.split(/[\\/]/).pop()!.replace(/\.png$/i, ""));
                  }
                }}
              >
                <Icon name="folder" size={14} /> Choose
              </button>
            </div>
          </div>
          <div className="field">
            <label>Name</label>
            <input value={name} maxLength={32} onChange={(e) => setName(e.target.value)} placeholder="My skin" />
          </div>
          <div className="field">
            <label>Arms</label>
            <VariantPick value={variant} onChange={setVariant} />
          </div>
        </>
      ) : (
        <div className="field">
          <label>Minecraft name</label>
          <input autoFocus value={player} maxLength={16} onChange={(e) => setPlayer(e.target.value)} placeholder="e.g. Notch"
            onKeyDown={(e) => e.key === "Enter" && player.trim().length >= 3 && add()} />
          <span className="muted small">Copies that player's skin (and arm type) into your library.</span>
        </div>
      )}
      <div className="block-foot">
        <span className="grow" />
        <button className="btn primary" disabled={busy || (tab === "file" ? !file : player.trim().length < 3)} onClick={add}>
          {busy ? <Spinner size={13} /> : <Icon name="plus" size={14} />} Add
        </button>
      </div>
    </Modal>
  );
}
