import { useEffect, useMemo, useState } from "react";
import { api, Catalog, CosmeticItem, CurrentSkin, Look, msg } from "../api";
import { toast } from "../stores";
import Icon from "../components/Icon";
import LockerPreview from "../components/LockerPreview";
import { AuraArt, HaloArt, HatArt } from "../components/CosmeticArt";
import { Empty, Spinner } from "../components/Ui";

type Tab = "capes" | "wings" | "halos" | "hats" | "auras";
const TABS: { id: Tab; label: string; field: keyof Look }[] = [
  { id: "capes", label: "Capes", field: "cape" },
  { id: "wings", label: "Wings", field: "wings" },
  { id: "halos", label: "Halos", field: "halo" },
  { id: "hats", label: "Hats", field: "hat" },
  { id: "auras", label: "Auras", field: "aura" },
];
const HALO_COLORS = [0xffe07a, 0xffffff, 0x8fd8ff, 0xb98cff, 0xff7ab6, 0xff5a5a, 0x7dff9a, 0xffa048];
// ears come in real fur colours: white, cream, golden, ginger, brown, dark brown, grey, black
const HAT_COLORS = [0xededed, 0xefddb8, 0xd9a55b, 0xd07a33, 0x7b4a2d, 0x4a2e1c, 0x8c8782, 0x1e1a19];
const AURA_COLORS = [0xa77bff, 0x8fd8ff, 0xff5aa8, 0xffd36b, 0x6bffb0, 0xff6b4a, 0xffffff, 0x4f7bff];

const hex = (c: number) => "#" + (c & 0xffffff).toString(16).padStart(6, "0");
const NONE: Look = { cape: "none", wings: "none", halo: "none", haloColor: 0xffe07a, hat: "none", hatColor: 0xededed, aura: "none", auraColor: 0xa77bff };

// Locker + shop: everything you can wear on Com Client (all free for now), tried on your own skin in 3D. Saving
// wears it in game for everyone with Com Client.
export default function Locker({ signedIn, onAccounts, skinKey }: { signedIn: boolean; onAccounts: () => void; skinKey: number }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [saved, setSaved] = useState<Look | null>(null);
  const [look, setLook] = useState<Look>(NONE);
  const [tab, setTab] = useState<Tab>("capes");
  const [query, setQuery] = useState("");
  const [skin, setSkin] = useState<CurrentSkin | null>(null);
  const [textures, setTextures] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.catalog().then(setCatalog).catch((e) => toast(msg(e), "error"));
  }, []);
  useEffect(() => {
    if (!signedIn) return;
    api
      .lookGet()
      .then((l) => {
        setSaved(l);
        setLook(l);
      })
      .catch((e) => toast(msg(e), "error"));
  }, [signedIn]);
  useEffect(() => {
    api.skinCurrent().then(setSkin).catch(() => setSkin({ data: "", variant: "classic", name: "" }));
  }, [skinKey]);

  // textures for the cards and the 3D model, loaded once each
  const texture = (kind: "cape" | "wings", id: string) => (id === "none" ? null : textures[kind + ":" + id] || null);
  const [asked] = useState(() => new Set<string>());
  function want(kind: "cape" | "wings", ids: string[]) {
    for (const id of ids) {
      const key = kind + ":" + id;
      if (id === "none" || asked.has(key)) continue;
      asked.add(key);
      api
        .cosmeticTexture(kind, id)
        .then((url) => setTextures((t) => ({ ...t, [key]: url })))
        .catch(() => {});
    }
  }
  const capeTex = look.cape !== "none" ? texture("cape", look.cape) : null;
  const wingTex = look.wings !== "none" ? texture("wings", look.wings) : null;

  const dirty = saved !== null && JSON.stringify(saved) !== JSON.stringify(look);
  async function save() {
    setSaving(true);
    try {
      await api.lookSave(look);
      setSaved(look);
      toast("Saved: everyone with Com Client sees it next time you play", "ok");
    } catch (e) {
      toast(msg(e), "error");
    } finally {
      setSaving(false);
    }
  }

  const t = TABS.find((x) => x.id === tab)!;
  const items: CosmeticItem[] = useMemo(() => {
    const list = catalog?.[tab] ?? [];
    const q = query.trim().toLowerCase();
    return q ? list.filter((i) => i.name.toLowerCase().includes(q)) : list;
  }, [catalog, tab, query]);
  const current = look[t.field] as string;
  useEffect(() => {
    want("cape", [look.cape]);
    want("wings", [look.wings]);
    if (tab === "capes") want("cape", items.slice(0, 80).map((i) => i.id));
    if (tab === "wings") want("wings", items.map((i) => i.id));
  }, [look.cape, look.wings, tab, items]);
  const pick = (id: string) => setLook({ ...look, [t.field]: id });

  if (!signedIn)
    return (
      <div className="page">
        <Empty icon="sparkle" title="Sign in to use the Locker" text="Cosmetics are tied to your Minecraft account, so other players see them.">
          <button className="btn primary" onClick={onAccounts}>
            <Icon name="user" size={15} /> Sign in
          </button>
        </Empty>
      </div>
    );

  return (
    <div className="page locker-page">
      <div className="page-head">
        <div>
          <h1>Locker</h1>
          <p className="muted">Capes, wings, halos, hats and auras. Everything is free for now: try it on, then save.</p>
        </div>
        <div className="row-gap">
          {dirty && (
            <button className="btn" onClick={() => saved && setLook(saved)}>
              <Icon name="refresh" size={15} /> Undo
            </button>
          )}
          <button className="btn primary" disabled={!dirty || saving} onClick={save}>
            {saving ? <Spinner size={13} /> : <Icon name="check" size={15} />} {dirty ? "Save & wear" : "Saved"}
          </button>
        </div>
      </div>
      <div className="locker-layout">
        <div className="locker-stage glass">
          <LockerPreview skin={skin?.data ?? ""} slim={skin?.variant === "slim"} look={look} cape={capeTex} wings={wingTex} />
          <div className="locker-wearing">
            {TABS.map((x) => {
              const v = look[x.field] as string;
              if (v === "none") return null;
              const name = catalog?.[x.id].find((i) => i.id === v)?.name ?? x.label;
              return (
                <span key={x.id} className="chip" onClick={() => setTab(x.id)}>
                  {name}
                  <button title="Take off" onClick={(e) => (e.stopPropagation(), setLook({ ...look, [x.field]: "none" }))}>
                    <Icon name="x" size={11} />
                  </button>
                </span>
              );
            })}
          </div>
          <p className="muted small locker-tip">Drag to turn</p>
        </div>
        <div className="locker-shop">
          <div className="toolbar">
            <div className="seg">
              {TABS.map((x) => (
                <button key={x.id} className={x.id === tab ? "on" : ""} onClick={() => setTab(x.id)}>
                  {x.label}
                </button>
              ))}
            </div>
            {tab === "capes" && (
              <div className="search small">
                <Icon name="search" size={15} />
                <input placeholder="Search capes" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
            )}
          </div>
          {(tab === "halos" || tab === "hats" || tab === "auras") && (
            <ColourBar
              colors={tab === "halos" ? HALO_COLORS : tab === "hats" ? HAT_COLORS : AURA_COLORS}
              value={tab === "halos" ? look.haloColor : tab === "hats" ? look.hatColor : look.auraColor}
              rainbow={tab === "auras"}
              custom={tab !== "hats"}
              onChange={(c) => setLook({ ...look, ...(tab === "halos" ? { haloColor: c } : tab === "hats" ? { hatColor: c } : { auraColor: c }) })}
            />
          )}
          {!catalog ? (
            <div className="center pad">
              <Spinner />
            </div>
          ) : (
            <div className="shop-grid">
              {!query && (
                <button className={"shop-card" + (current === "none" ? " on" : "")} onClick={() => pick("none")}>
                  <div className="shop-art none">
                    <Icon name="x" size={22} />
                  </div>
                  <b>Nothing</b>
                </button>
              )}
              {items.map((i) => (
                <button key={i.id} className={"shop-card" + (current === i.id ? " on" : "")} onClick={() => pick(i.id)}>
                  <div className="shop-art">
                    {tab === "capes" ? (
                      <CapeFront url={texture("cape", i.id)} />
                    ) : tab === "wings" ? (
                      <WingArt url={texture("wings", i.id)} />
                    ) : tab === "halos" ? (
                      <HaloArt id={i.id} color={look.haloColor} />
                    ) : tab === "hats" ? (
                      <HatArt id={i.id} color={look.hatColor} />
                    ) : (
                      <AuraArt id={i.id} color={look.auraColor} />
                    )}
                  </div>
                  <b>{i.name}</b>
                  <span className="price">{current === i.id ? "Wearing" : "Free"}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** The front of a cape (texture pixels 1..11 x 1..17 of a 64x32 cape). */
function CapeFront({ url }: { url: string | null }) {
  const s = 4;
  if (!url) return <span className="cape-front loading" style={{ width: 10 * s, height: 16 * s }} />;
  return (
    <span
      className="cape-front"
      style={{ width: 10 * s, height: 16 * s, backgroundImage: `url("${url}")`, backgroundSize: `${64 * s}px auto`, backgroundPosition: `-${s}px -${s}px` }}
    />
  );
}

/** The two wings as the card picture, like the client: the elytra's back face (u 36..46, v 2..22), leaning out. */
function WingArt({ url }: { url: string | null }) {
  const s = 2.5;
  if (!url) return <span className="cape-front loading" style={{ width: 20 * s, height: 20 * s }} />;
  const wing = { width: 10 * s, height: 20 * s, backgroundImage: `url("${url}")`, backgroundSize: `${64 * s}px auto`, backgroundPosition: `-${36 * s}px -${2 * s}px` };
  return (
    <span className="wing-art">
      <span className="cape-front" style={{ ...wing, transform: "rotate(12.6deg) scaleX(-1)", transformOrigin: "100% 0" }} />
      <span className="cape-front" style={{ ...wing, transform: "rotate(-12.6deg)", transformOrigin: "0 0" }} />
    </span>
  );
}

function ColourBar({ colors, value, rainbow, custom = true, onChange }: { colors: number[]; value: number; rainbow: boolean; custom?: boolean; onChange: (c: number) => void }) {
  return (
    <div className="colour-bar">
      <span className="muted small">Colour</span>
      {colors.map((c) => (
        <button key={c} className={"swatch" + (value === c ? " on" : "")} style={{ background: hex(c) }} onClick={() => onChange(c)} title={hex(c)} />
      ))}
      {rainbow && (
        <button className={"swatch rainbow" + (value === -1 ? " on" : "")} onClick={() => onChange(-1)} title="Rainbow" />
      )}
      {custom && (
        <label className="swatch custom" title="Any colour">
          <input type="color" value={hex(value === -1 ? 0xa77bff : value)} onChange={(e) => onChange(parseInt(e.target.value.slice(1), 16))} />
          <Icon name="plus" size={12} />
        </label>
      )}
    </div>
  );
}
