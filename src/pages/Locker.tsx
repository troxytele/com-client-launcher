import { useEffect, useMemo, useState } from "react";
import { api, Catalog, CosmeticItem, CurrentSkin, Look, msg, Shop, ShopKind, Wallet } from "../api";
import { toast } from "../stores";
import Icon from "../components/Icon";
import LockerPreview from "../components/LockerPreview";
import { AuraArt, HaloArt, HatArt } from "../components/CosmeticArt";
import { Empty, Modal, Spinner } from "../components/Ui";

type Tab = "capes" | "wings" | "halos" | "hats" | "auras";
const TABS: { id: Tab; label: string; field: ShopKind }[] = [
  { id: "capes", label: "Capes", field: "cape" },
  { id: "wings", label: "Wings", field: "wings" },
  { id: "halos", label: "Halos", field: "halo" },
  { id: "hats", label: "Hats", field: "hat" },
  { id: "auras", label: "Auras", field: "aura" },
];
const CAPE_DEFAULT_PRICE = 300; // capes the server has no price for
const HALO_COLORS = [0xffe07a, 0xffffff, 0x8fd8ff, 0xb98cff, 0xff7ab6, 0xff5a5a, 0x7dff9a, 0xffa048];
// ears come in real fur colours: white, cream, golden, ginger, brown, dark brown, grey, black
const HAT_COLORS = [0xededed, 0xefddb8, 0xd9a55b, 0xd07a33, 0x7b4a2d, 0x4a2e1c, 0x8c8782, 0x1e1a19];
const AURA_COLORS = [0xa77bff, 0x8fd8ff, 0xff5aa8, 0xffd36b, 0x6bffb0, 0xff6b4a, 0xffffff, 0x4f7bff];

const hex = (c: number) => "#" + (c & 0xffffff).toString(16).padStart(6, "0");
const NONE: Look = { cape: "none", wings: "none", halo: "none", haloColor: 0xffe07a, hat: "none", hatColor: 0xededed, aura: "none", auraColor: 0xa77bff };

// Locker + shop: everything you can wear on Com Client, tried on your own skin in 3D. Most items cost points
// (earned by playing, daily streaks and invites); staff own everything. Saving wears it in game for everyone.
export default function Locker({ signedIn, onAccounts, skinKey }: { signedIn: boolean; onAccounts: () => void; skinKey: number }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [saved, setSaved] = useState<Look | null>(null);
  const [look, setLook] = useState<Look>(NONE);
  const [tab, setTab] = useState<Tab>("capes");
  const [query, setQuery] = useState("");
  const [skin, setSkin] = useState<CurrentSkin | null>(null);
  const [textures, setTextures] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [shop, setShop] = useState<Shop | null>(null);
  const [buying, setBuying] = useState("");
  const [earnOpen, setEarnOpen] = useState(false);

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
    api.shop().then(setShop).catch(() => setShop(null));
  }, [signedIn]);

  // price and ownership of one item ("none" is always yours)
  const priceOf = (kind: ShopKind, id: string) => shop?.items.find((i) => i.kind === kind && i.id === id)?.price ?? (kind === "cape" ? CAPE_DEFAULT_PRICE : 0);
  const ownsIt = (kind: ShopKind, id: string) => {
    if (id === "none" || !shop || shop.wallet.everything) return true;
    const it = shop.items.find((i) => i.kind === kind && i.id === id);
    return it ? it.owned : false;
  };
  const locked = TABS.filter((x) => !ownsIt(x.field, look[x.field] as string));
  const setWallet = (w: Wallet) => setShop((s) => (s ? { ...s, wallet: w } : s));
  async function buy(kind: ShopKind, id: string) {
    setBuying(kind + ":" + id);
    try {
      const r = await api.shopBuy(kind, id);
      setShop((s) => (s ? { wallet: r.wallet, items: s.items.map((i) => (i.kind === kind && i.id === id ? { ...i, owned: true } : i)) } : s));
      if (kind === "cape" && !shop?.items.some((i) => i.kind === kind && i.id === id))
        setShop((s) => (s ? { ...s, items: [...s.items, { kind, id, name: "Cape", price: CAPE_DEFAULT_PRICE, owned: true }] } : s));
      toast("Unlocked! It's yours to wear", "ok");
    } catch (e) {
      toast(msg(e), "error");
    } finally {
      setBuying("");
    }
  }
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
      const kept = await api.lookSave(look);
      setSaved(kept);
      setLook(kept);
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
          <p className="muted">Capes, wings, halos, hats and auras. Try anything on, unlock it with points, then save.</p>
        </div>
        <div className="row-gap">
          {shop && (
            <button
              className="btn"
              title="Copy your invite link: you both get points once they've played an hour"
              onClick={() => navigator.clipboard.writeText(shop.wallet.invite_link).then(() => toast("Invite link copied", "ok"))}
            >
              <Icon name="share" size={15} /> Invite
            </button>
          )}
          {shop && (
            <button className="points-pill" onClick={() => setEarnOpen(true)} title="How to earn points">
              <Icon name="gem" size={15} />
              {shop.wallet.everything ? "Everything unlocked" : `${shop.wallet.points.toLocaleString()} points`}
            </button>
          )}
          {dirty && (
            <button className="btn" onClick={() => saved && setLook(saved)}>
              <Icon name="refresh" size={15} /> Undo
            </button>
          )}
          <button className="btn primary" disabled={!dirty || saving || locked.length > 0} title={locked.length ? "Unlock what you're trying on first" : undefined} onClick={save}>
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
          {locked.length > 0 && shop && (
            <div className="locker-unlock">
              {locked.map((x) => {
                const id = look[x.field] as string;
                const price = priceOf(x.field, id);
                const name = catalog?.[x.id].find((i) => i.id === id)?.name ?? x.label;
                const short = Math.max(0, price - shop.wallet.points);
                return (
                  <div key={x.id} className="unlock-row">
                    <Icon name="lock" size={14} />
                    <span>
                      <b>{name}</b> <span className="muted">{x.label.replace(/s$/, "").toLowerCase()}</span>
                    </span>
                    {short > 0 ? (
                      <button className="btn small" onClick={() => setEarnOpen(true)} title="How to earn points">
                        {short.toLocaleString()} more points needed
                      </button>
                    ) : (
                      <button className="btn small primary" disabled={buying !== ""} onClick={() => buy(x.field, id)}>
                        {buying === x.field + ":" + id ? <Spinner size={12} /> : <Icon name="gem" size={13} />} Unlock for {price.toLocaleString()}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
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
                <button key={i.id} className={"shop-card" + (current === i.id ? " on" : "") + (ownsIt(t.field, i.id) ? "" : " locked")} onClick={() => pick(i.id)}>
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
                  <PriceTag wearing={saved?.[t.field] === i.id} owned={ownsIt(t.field, i.id)} free={priceOf(t.field, i.id) === 0} price={priceOf(t.field, i.id)} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {earnOpen && shop && <EarnPoints wallet={shop.wallet} onWallet={setWallet} onClose={() => setEarnOpen(false)} />}
    </div>
  );
}

function PriceTag({ wearing, owned, free, price }: { wearing: boolean; owned: boolean; free: boolean; price: number }) {
  if (wearing) return <span className="price">Wearing</span>;
  if (free) return <span className="price">Free</span>;
  if (owned) return <span className="price">Owned</span>;
  return (
    <span className="price cost">
      <Icon name="gem" size={11} /> {price.toLocaleString()}
    </span>
  );
}

/** How to earn points: play time today, the streak bonus, your invite link and "who invited you". */
function EarnPoints({ wallet: w, onWallet, onClose }: { wallet: Wallet; onWallet: (w: Wallet) => void; onClose: () => void }) {
  const [who, setWho] = useState("");
  const [busy, setBusy] = useState(false);
  async function claim() {
    setBusy(true);
    try {
      const r = await api.inviteClaim(who.trim());
      onWallet(r.wallet);
      toast("Thanks! You both get points once you've played an hour", "ok");
    } catch (e) {
      toast(msg(e), "error");
    } finally {
      setBusy(false);
    }
  }
  const copy = () => navigator.clipboard.writeText(w.invite_link).then(() => toast("Invite link copied", "ok"));
  return (
    <Modal title="Earn points" onClose={onClose} width={480}>
      <div className="earn">
        <div className="earn-balance">
          <Icon name="gem" size={20} />
          <b>{w.points.toLocaleString()}</b>
          <span className="muted">points{w.everything ? " · you have everything unlocked" : ""}</span>
        </div>
        <div className="earn-row">
          <Icon name="clock" size={17} />
          <div>
            <b>Play</b>
            <p className="muted small">
              1 point for every {w.per_minutes} minutes in game, up to {w.today_cap} a day.
            </p>
            <div className="earn-bar">
              <span style={{ width: `${Math.min(100, (w.today / w.today_cap) * 100)}%` }} />
            </div>
            <p className="muted small">
              {w.today} / {w.today_cap} today
            </p>
          </div>
        </div>
        <div className="earn-row">
          <Icon name="bolt" size={17} />
          <div>
            <b>Daily streak</b>
            <p className="muted small">
              {w.streak_claimed_today
                ? `Today's bonus is yours (${w.streak} day streak). Play tomorrow for +${w.streak_bonus_next}.`
                : `Play today for +${w.streak_bonus_next}. The bonus grows every day in a row.`}
            </p>
          </div>
        </div>
        <div className="earn-row">
          <Icon name="users" size={17} />
          <div>
            <b>Invite friends</b>
            <p className="muted small">
              +{w.invite_reward} for you and +{w.invite_welcome} for them once they've played an hour.
              {w.invited > 0 && ` ${w.invited} joined with your link so far.`}
            </p>
            <div className="earn-link">
              <code>{w.invite_link.replace("https://", "")}</code>
              <button className="btn small" onClick={copy}>
                <Icon name="copy" size={13} /> Copy
              </button>
            </div>
          </div>
        </div>
        {w.referred_by ? (
          <p className="muted small">Invited by {w.referred_by.name}</p>
        ) : (
          w.can_claim_invite && (
            <div className="earn-row">
              <Icon name="user" size={17} />
              <div>
                <b>Did a friend invite you?</b>
                <div className="earn-link">
                  <input placeholder="Their name or Com ID" value={who} onChange={(e) => setWho(e.target.value)} maxLength={40} />
                  <button className="btn small primary" disabled={busy || !who.trim()} onClick={claim}>
                    {busy ? <Spinner size={12} /> : "Add"}
                  </button>
                </div>
              </div>
            </div>
          )
        )}
        {w.history.length > 0 && (
          <details className="earn-history">
            <summary className="muted small">Recent</summary>
            {w.history.map((h, i) => (
              <div key={i} className="small">
                <span className={h.n >= 0 ? "plus" : "minus"}>{h.n >= 0 ? "+" + h.n : h.n}</span> {h.why}
              </div>
            ))}
          </details>
        )}
      </div>
    </Modal>
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
