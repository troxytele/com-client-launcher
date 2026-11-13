import { useEffect, useMemo, useState } from "react";
import { Advent, api, Catalog, CosmeticItem, CurrentSkin, Deal, Look, msg, Outfit, Shop, ShopItem, ShopKind, ShopSet, Wallet } from "../api";
import { toast } from "../stores";
import Icon from "../components/Icon";
import Coin from "../components/Coin";
import LockerPreview from "../components/LockerPreview";
import { AuraArt, HaloArt } from "../components/CosmeticArt";
import { Empty, Modal, Spinner } from "../components/Ui";
import GiftDialog from "../components/GiftDialog";
import NameTag from "../components/NameTag";
import { CUSTOM_CAPES } from "../../website-src/helpers.js";
import { WING_SHAPES, wingShape } from "../../website-src/wings.js";

// Com Client's own voxel pets and hats (the card picture is a rendered PNG)
// the advent calendar's items: hidden until you have them (they're a surprise)
const ADVENT_ITEMS = new Set(["cape:cc_northpole", "wings:snowflake", ...["tree", "snowman", "present", "candy_cane", "gingerbread", "bell", "xmas_star", "santa_hat", "snowflake", "reindeer"].map((i) => "icon:" + i)]);
const VOXEL_HATS = new Set(["bunny_hat", "axolotl_hat", "frog_hat", "fire_horns", "pumpkin_hat", "headband_com", "headband_gg", "headband_pvp", "headband_ez", "headband_mvp", "headband_rainbow", "headband_ninja", "bow_white", "bow_pink", "bow_black", "bow_red", "bow_blue", "bow_purple", "double_bow_white", "double_bow_pink", "double_bow_black", "double_bow_red", "double_bow_blue", "double_bow_purple", "koala_hat", "bandana_fire_white", "bandana_fire_black", "bandana_fire_red", "bandana_fire_blue", "bandana_fire_toxic", "bandana_fire_purple", "bandana_galaxy", "bandana_stars", "bandana_aurora", "bandana_lava", "bandana_ocean", "bandana_lightning", "bandana_matrix", "bandana_neon", "bandana_sakura", "bandana_frost", "bandana_gg", "bandana_ez", "bandana_pvp", "bandana_mvp", "bandana_toxic", "bandana_king", "bandana_glitch", "bandana_noob"]);

type Tab = "capes" | "wings" | "halos" | "hats" | "auras" | "pets" | "shields" | "nametags" | "icons";
const TABS: { id: Tab; label: string; field: ShopKind }[] = [
  { id: "capes", label: "Capes", field: "cape" },
  { id: "wings", label: "Wings", field: "wings" },
  { id: "halos", label: "Halos", field: "halo" },
  { id: "hats", label: "Hats", field: "hat" },
  { id: "auras", label: "Auras", field: "aura" },
  { id: "pets", label: "Pets", field: "pet" },
  { id: "shields", label: "Shields", field: "shield" },
  { id: "nametags", label: "Name tags", field: "nametag" },
  { id: "icons", label: "Icons", field: "icon" },
];
const CAPE_DEFAULT_PRICE = 300; // capes the server has no price for
const HALO_COLORS = [0xffe07a, 0xffffff, 0x8fd8ff, 0xb98cff, 0xff7ab6, 0xff5a5a, 0x7dff9a, 0xffa048];
// ears come in real fur colours: white, cream, golden, ginger, brown, dark brown, grey, black
const HAT_COLORS = [0xededed, 0xefddb8, 0xd9a55b, 0xd07a33, 0x7b4a2d, 0x4a2e1c, 0x8c8782, 0x1e1a19];
const PET_COLORS = [-1, 0xffd24a, 0x6fd3ff, 0xff7ab8, 0x8cff9e, 0xb48cff, 0x3a3a48, -2];
const AURA_COLORS = [0xa77bff, 0x8fd8ff, 0xff5aa8, 0xffd36b, 0x6bffb0, 0xff6b4a, 0xffffff, 0x4f7bff];

const hex = (c: number) => "#" + (c & 0xffffff).toString(16).padStart(6, "0");
const NONE: Look = { cape: "none", wings: "none", halo: "none", haloColor: 0xffe07a, hat: "none", hatColor: 0xededed, aura: "none", auraColor: 0xa77bff, pet: "none", petLeft: false, nametag: "none", icon: "none", petName: "", petColor: -1, plainTag: false, shield: "none" };

// what you're trying on, kept while you look at other pages (cleared once it's saved)
let draft: Look | null = null;

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
  const [giftOpen, setGiftOpen] = useState(false);
  const [adventOpen, setAdventOpen] = useState(false);
  const [view, setView] = useState<"shop" | "outfits">("shop");

  useEffect(() => {
    api.catalog().then(setCatalog).catch((e) => toast(msg(e), "error"));
  }, []);
  useEffect(() => {
    if (!signedIn) return;
    api
      .lookGet()
      .then((l) => {
        setSaved(l);
        setLook(draft ?? l);
      })
      .catch((e) => toast(msg(e), "error"));
    api.shop().then(setShop).catch(() => setShop(null));
  }, [signedIn]);

  // price and ownership of one item ("none" is always yours)
  const itemOf = (kind: ShopKind, id: string): ShopItem | undefined => shop?.items.find((i) => i.kind === kind && i.id === id);
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
  // every cape and wing comes with the launcher; a design newer than the launcher is read from the Com Client jar
  const texture = (kind: "cape" | "wings", id: string) =>
    id === "none" ? null : textures[kind + ":" + id] || (kind === "wings" ? `/cosmetics/wings/${id}.png` : `/cosmetics/capes/${id.slice(3)}.png`);
  const [asked] = useState(() => new Set<string>());
  function want(kind: "cape" | "wings", ids: string[]) {
    for (const id of ids) {
      const key = kind + ":" + id;
      if (id === "none" || asked.has(key) || (kind === "wings" ? KNOWN_WINGS.has(id) : CUSTOM_CAPES[id])) continue;
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
  useEffect(() => {
    draft = dirty ? look : null;
  }, [look, dirty]);
  // everything you own is worn as soon as you pick it (in game too, within half a minute)
  useEffect(() => {
    if (!dirty || saving || !shop || locked.length > 0) return;
    const t = setTimeout(() => save(true), 700);
    return () => clearTimeout(t);
  }, [look, dirty, shop]); // eslint-disable-line react-hooks/exhaustive-deps
  async function save(quiet = false) {
    setSaving(true);
    try {
      const want = look;
      const kept = await api.lookSave(want);
      setSaved(kept);
      setLook((l) => (l === want ? kept : l));
      if (!quiet) toast("Saved: everyone with Com Client sees it next time you play", "ok");
    } catch (e) {
      toast(msg(e), "error");
    } finally {
      setSaving(false);
    }
  }

  const t = TABS.find((x) => x.id === tab)!;
  const items: CosmeticItem[] = useMemo(() => {
    // advent calendar items only show once they're yours
    const owned = (id: string) => !!shop?.items.find((x) => x.kind === t.field && x.id === id && x.owned);
    const list = (catalog?.[tab] ?? []).filter((i) => !ADVENT_ITEMS.has(t.field + ":" + i.id) || owned(i.id));
    const q = query.trim().toLowerCase();
    return q ? list.filter((i) => i.name.toLowerCase().includes(q)) : list;
  }, [catalog, tab, query, shop]);
  const current = look[t.field] as string;
  useEffect(() => {
    want("cape", [look.cape]);
    want("wings", [look.wings]);
    if (tab === "capes") want("cape", items.slice(0, 80).map((i) => i.id));
    if (shop?.wallet.deal?.kind === "cape") want("cape", [shop.wallet.deal.id]);
    if (tab === "wings") want("wings", items.map((i) => i.id));
  }, [look.cape, look.wings, tab, items, shop?.wallet.deal?.id]);
  const pick = (id: string) => setLook({ ...look, [t.field]: id });
  // what can be gifted from this tab: the item picked here, if it costs points
  const giftName = catalog?.[tab].find((i) => i.id === current)?.name;
  const canGift = !!shop && current !== "none" && !!giftName && priceOf(t.field, current) > 0 && !itemOf(t.field, current)?.only;
  const advent = shop?.wallet.advent;
  const adventSeason = !!advent && (advent.active || advent.start - Date.now() / 1000 < 16 * 86400);

  // the picture of an item, for its card and today's deal
  function art(kind: ShopKind, id: string) {
    switch (kind) {
      case "cape":
        return <CapeFront url={texture("cape", id)} />;
      case "wings":
        return <img className="voxel-art" src={`/cosmetics/wings_card/${id}.png`} alt="" />;
      case "halo":
        return <HaloArt id={id} color={look.haloColor} />;
      case "hat":
        return <img className="voxel-art" src={`/cosmetics/hats/${id}.png`} alt="" />; // the same 3D renders as the game's Locker
      case "pet":
        return <img className="voxel-art" src={`/cosmetics/pets/${id}.png`} alt="" />;
      case "shield":
        return <img className="voxel-art" src={`/cosmetics/shields/${id}.webp`} alt="" />; // animated, like in game
      case "nametag":
        return <NameTag style={id} name={skin?.name || "Name"} className="nametag-art" still />;
      case "icon":
        return <img className="icon-art" src={`/cosmetics/icons/${id}.png`} alt="" />;
      case "aura":
        return <AuraArt id={id} color={look.auraColor} />;
      default:
        return <Icon name="sparkle" size={22} />;
    }
  }

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
          <p className="muted">Capes, wings, halos, hats, auras, pets, name tags and name icons. Try anything on, unlock it with points (or gift it to a friend), then save.</p>
        </div>
        <div className="row-gap">
          {adventSeason && (
            <button className={"btn" + (advent!.claimable > 0 ? " primary" : "")} onClick={() => setAdventOpen(true)} title="One door a day, December 1 to 24">
              <Icon name="gift" size={15} /> Advent calendar{advent!.claimable > 0 ? ` (${advent!.claimable})` : ""}
            </button>
          )}
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
              <Coin size={17} />
              {shop.wallet.everything ? "Everything unlocked" : `${shop.wallet.points.toLocaleString()} points`}
            </button>
          )}
          {canGift && (
            <button className="btn" onClick={() => setGiftOpen(true)} title={`Buy ${giftName} for a friend`}>
              <Icon name="gift" size={15} /> Gift
            </button>
          )}
          {dirty && (
            <button className="btn" onClick={() => saved && setLook(saved)}>
              <Icon name="refresh" size={15} /> Undo
            </button>
          )}
          <button className="btn primary" disabled={!dirty || saving || locked.length > 0} title={locked.length ? "Unlock what you're trying on first" : undefined} onClick={() => save()}>
            {saving ? <Spinner size={13} /> : <Icon name="check" size={15} />} {dirty ? "Save & wear" : "Saved"}
          </button>
        </div>
      </div>
      <div className="locker-layout">
        <div className="locker-stage glass">
          <LockerPreview skin={skin?.data ?? ""} slim={skin?.variant === "slim"} look={look} cape={capeTex} wings={wingTex} />
          {(look.nametag !== "none" || look.icon !== "none") && (
            <span className="locker-nametag">
              {look.icon !== "none" && <img className="nametag-icon before" src={`/cosmetics/icons/${look.icon}.png`} alt="" />}
              {look.nametag !== "none" ? <NameTag style={look.nametag} name={skin?.name || "You"} /> : skin?.name || "You"}
            </span>
          )}
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
                const it = itemOf(x.field, id);
                const notYet = it?.season && (Date.now() / 1000 < it.season.start || Date.now() / 1000 >= it.season.end);
                if (it?.only === "advent" || notYet)
                  return (
                    <div key={x.id} className="unlock-row">
                      <Icon name="lock" size={14} />
                      <span>
                        <b>{name}</b> <span className="muted">{x.label.replace(/s$/, "").toLowerCase()}</span>
                      </span>
                      {it?.only === "advent" ? (
                        <button className="btn small" disabled={!adventSeason} onClick={() => setAdventOpen(true)}>
                          <Icon name="gift" size={13} /> Only in the advent calendar
                        </button>
                      ) : (
                        <span className="muted small">Back {new Date(it!.season!.start * 1000).toLocaleDateString("en", { month: "short", day: "numeric" })}</span>
                      )}
                    </div>
                  );
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
                        {buying === x.field + ":" + id ? <Spinner size={12} /> : <Coin size={15} />} Unlock for {price.toLocaleString()}
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
              <button className={view === "outfits" ? "on" : ""} onClick={() => setView("outfits")}>
                <Icon name="sparkle" size={13} /> Outfits & sets
              </button>
              {TABS.map((x) => (
                <button key={x.id} className={view === "shop" && x.id === tab ? "on" : ""} onClick={() => (setView("shop"), setTab(x.id))}>
                  {x.label}
                </button>
              ))}
            </div>
            {view === "shop" && (tab === "capes" || tab === "wings" || tab === "icons") && (
              <div className="search small">
                <Icon name="search" size={15} />
                <input placeholder={`Search ${TABS.find((t) => t.id === tab)?.label ?? tab}`} value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
            )}
          </div>
          {view === "outfits" ? (
            <OutfitsPanel
              look={look}
              catalog={catalog}
              onWear={(l) => setLook({ ...l })}
              onWallet={setWallet}
              onOwned={(ks) => setShop((sh) => (sh ? { ...sh, items: sh.items.map((i) => (ks.includes(i.kind + ":" + i.id) ? { ...i, owned: true } : i)) } : sh))}
              art={art}
            />
          ) : (
            <>
          {tab === "pets" && (
            <div className="colour-bar">
              <span className="muted small">Side</span>
              <div className="seg small">
                <button className={look.petLeft ? "on" : ""} onClick={() => setLook({ ...look, petLeft: true })}>
                  Left shoulder
                </button>
                <button className={!look.petLeft ? "on" : ""} onClick={() => setLook({ ...look, petLeft: false })}>
                  Right shoulder
                </button>
              </div>
            </div>
          )}
          {tab === "pets" && (
            <div className="colour-bar">
              <span className="muted small">Colour</span>
              {PET_COLORS.map((c) => (
                <button
                  key={c}
                  className={"swatch" + (c === -2 ? " rainbow" : "") + ((look.petColor ?? -1) === c ? " on" : "")}
                  style={c >= 0 ? { background: hex(c) } : c === -1 ? { background: "rgba(255,255,255,.12)" } : undefined}
                  title={c === -1 ? "Its own colours" : c === -2 ? "Rainbow" : hex(c)}
                  onClick={() => setLook({ ...look, petColor: c })}
                >
                  {c === -1 && <Icon name="x" size={10} />}
                </button>
              ))}
            </div>
          )}
          {view === "shop" && tab === "nametags" && (
            <label className="plain-tag">
              <input type="checkbox" checked={!!look.plainTag} onChange={(e) => setLook({ ...look, plainTag: e.target.checked })} />
              <span>
                <b>Plain name tag for others</b>
                <small className="muted">Other Com Client players see your normal Minecraft name tag (no style, icon or glass tag).</small>
              </span>
            </label>
          )}
          {((tab === "halos" && look.halo !== "wreath") || (tab === "hats" && !["crown", "santa", "antlers"].includes(look.hat) && !VOXEL_HATS.has(look.hat)) || (tab === "auras" && !["snow", "trail_snow", "trail_hearts", "trail_cape"].includes(look.aura))) && (
            <ColourBar
              colors={tab === "halos" ? HALO_COLORS : tab === "hats" ? HAT_COLORS : AURA_COLORS}
              value={tab === "halos" ? look.haloColor : tab === "hats" ? look.hatColor : look.auraColor}
              rainbow={tab === "auras"}
              custom={tab !== "hats"}
              onChange={(c) => setLook({ ...look, ...(tab === "halos" ? { haloColor: c } : tab === "hats" ? { hatColor: c } : { auraColor: c }) })}
            />
          )}
          {shop?.wallet.deal && !ownsIt(shop.wallet.deal.kind, shop.wallet.deal.id) && (
            <button
              className="deal-banner"
              onClick={() => {
                const d = shop.wallet.deal!;
                const tb = TABS.find((x) => x.field === d.kind);
                if (tb) {
                  setTab(tb.id);
                  setQuery("");
                  setLook((l) => ({ ...l, [tb.field]: d.id }));
                }
              }}
            >
              <span className="deal-off">-{shop.wallet.deal.off}%</span>
              <div className="deal-art">{art(shop.wallet.deal.kind, shop.wallet.deal.id)}</div>
              <span>
                Today's deal: <b>{shop.wallet.deal.name}</b> <span className="muted">({shop.wallet.deal.kind === "wings" ? "wings" : shop.wallet.deal.kind})</span>
              </span>
              <span className="deal-price">
                <s>{shop.wallet.deal.full_price}</s> <Coin size={14} /> {shop.wallet.deal.price}
              </span>
            </button>
          )}
          {shop?.wallet.limited && shop.wallet.limited.length > 0 && (
            <div className="limited-bar">
              {shop.wallet.limited.map((d) => (
                <button
                  key={d.kind + d.id}
                  className="limited-drop"
                  onClick={() => {
                    const tb = TABS.find((x) => x.field === d.kind);
                    if (tb) {
                      setTab(tb.id);
                      setQuery("");
                      setLook((l) => ({ ...l, [tb.field]: d.id }));
                    }
                  }}
                >
                  <span className="limited-tag">Limited</span>
                  <div className="deal-art">{art(d.kind, d.id)}</div>
                  <span>
                    <b>{d.name}</b> <span className="muted">({d.kind}) · {timeLeft(d.end)} left</span>
                  </span>
                  <span className="deal-price">
                    <Coin size={14} /> {d.price.toLocaleString()}
                  </span>
                </button>
              ))}
            </div>
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
                    {art(t.field, i.id)}
                  </div>
                  <b>{i.name}</b>
                  {tab === "wings" && <small className="muted wing-type">{WING_SHAPES[wingShape(i.id)].label}</small>}
                  <PriceTag
                    item={shop?.items.find((x) => x.kind === t.field && x.id === i.id)}
                    giftFrom={shop?.items.find((x) => x.kind === t.field && x.id === i.id)?.gift_from}
                    wearing={saved?.[t.field] === i.id}
                    owned={ownsIt(t.field, i.id)}
                    free={priceOf(t.field, i.id) === 0}
                    price={priceOf(t.field, i.id)}
                    deal={shop?.wallet.deal && shop.wallet.deal.kind === t.field && shop.wallet.deal.id === i.id ? shop.wallet.deal : undefined}
                  />
                </button>
              ))}
            </div>
          )}
            </>
          )}
        </div>
      </div>
      {giftOpen && canGift && (
        <GiftDialog kind={t.field} id={current} name={giftName!} onClose={() => setGiftOpen(false)} onSent={setWallet} />
      )}
      {earnOpen && shop && <EarnPoints wallet={shop.wallet} onWallet={setWallet} onClose={() => setEarnOpen(false)} />}
      {adventOpen && (
        <AdventDialog
          onClose={() => setAdventOpen(false)}
          onGot={(w, kind, id) => {
            setShop((s) => (s ? { wallet: w, items: s.items.map((i) => (i.kind === kind && i.id === id ? { ...i, owned: true } : i)) } : s));
          }}
        />
      )}
    </div>
  );
}

const KNOWN_WINGS = new Set(Object.keys({ heaven: 1, purple: 1, dragon: 1, devil: 1, blue_dragon: 1, frost: 1, candy_cane: 1, snowflake: 1, golden: 1, celestial: 1, seraph: 1, void: 1, phoenix: 1, monarch: 1, morpho: 1, pixie: 1, bat: 1, emerald: 1, crystal: 1, flame: 1, leaf: 1, bone: 1, peacock: 1, ribbon: 1, rose_fairy: 1, lilac_fairy: 1, mint_fairy: 1 }));

function timeLeft(end: number) {
  const s = Math.max(0, end - Date.now() / 1000);
  return s >= 86400 ? `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h` : `${Math.max(1, Math.floor(s / 3600))}h`;
}

function PriceTag({ item, wearing, owned, free, price, deal, giftFrom }: { item?: ShopItem; wearing: boolean; owned: boolean; free: boolean; price: number; deal?: Deal; giftFrom?: string }) {
  if (wearing) return <span className="price">Wearing</span>;
  if (!owned && item?.only === "advent")
    return (
      <span className="price advent" title="Only behind a door of the advent calendar (December 1 to 24)">
        <Icon name="gift" size={12} /> Advent calendar
      </span>
    );
  if (!owned && item?.season) {
    const now = Date.now() / 1000;
    const open = now >= item.season.start && now < item.season.end;
    const when = new Date((open ? item.season.end : item.season.start) * 1000).toLocaleDateString("en", { month: "short", day: "numeric" });
    if (!open)
      return (
        <span className="price" title={`${item.season.name ?? "Seasonal"}: back in the shop on ${when}`}>
          <Icon name="clock" size={12} /> Back {when}
        </span>
      );
    if (item.only === "limited")
      return (
        <span className="price cost limited" title={`A limited drop: in the shop until ${when}`}>
          <Coin size={13} /> {price.toLocaleString()} · {timeLeft(item.season.end)}
        </span>
      );
  }
  if (free) return <span className="price">Free</span>;
  if (owned && giftFrom)
    return (
      <span className="price gift-from" title={`A gift from ${giftFrom}`}>
        <Icon name="gift" size={12} /> From {giftFrom}
      </span>
    );
  if (owned) return <span className="price">Owned</span>;
  if (deal)
    return (
      <span className="price cost deal">
        <s>{deal.full_price.toLocaleString()}</s> <Coin size={13} /> {deal.price.toLocaleString()}
      </span>
    );
  return (
    <span className="price cost">
      <Coin size={13} /> {price.toLocaleString()}
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
          <Coin size={22} />
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
            <b>Daily reward</b>
            <p className="muted small">
              {w.streak_claimed_today
                ? `Claimed today (${w.streak} day streak). Come back tomorrow for +${w.streak_bonus_next}.`
                : `Claim +${w.streak_bonus_next} in the game's main menu today. Grows every day up to 25, and higher every week you keep it. Miss a day and it starts over.`}
            </p>
            {w.calendar && (
              <div className="cal-row">
                {w.calendar.days.map((d) => (
                  <span key={d.day} className={"cal-day" + (d.claimed ? " done" : "") + (d.today ? " today" : "")}>
                    <small>D{d.day}</small>
                    {d.claimed ? <Icon name="check" size={12} /> : <b>+{d.points}</b>}
                  </span>
                ))}
              </div>
            )}
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


/** The advent calendar: 24 doors, one a day in December. Behind them: points and Christmas items you can't buy. */
function AdventDialog({ onClose, onGot }: { onClose: () => void; onGot: (w: Wallet, kind: string, id: string) => void }) {
  const [cal, setCal] = useState<Advent | null>(null);
  const [busy, setBusy] = useState(0);
  const [got, setGot] = useState("");
  useEffect(() => {
    api.advent().then(setCal).catch((e) => toast(msg(e), "error"));
  }, []);
  async function open(day: number) {
    setBusy(day);
    try {
      const r = await api.adventOpen(day);
      setCal(r.advent);
      setGot(r.got.name);
      onGot(r.wallet, r.got.kind, r.got.id ?? "");
      toast(`Door ${day}: ${r.got.name}!`, "ok");
    } catch (e) {
      toast(msg(e), "error");
    } finally {
      setBusy(0);
    }
  }
  const startText = cal ? new Date(cal.start * 1000).toLocaleDateString("en", { month: "long", day: "numeric" }) : "";
  return (
    <Modal title="Advent calendar" onClose={onClose} width={620}>
      {!cal ? (
        <div className="center pad">
          <Spinner />
        </div>
      ) : (
        <div className="advent">
          <p className="muted small">
            {cal.active
              ? "One door a day until Christmas. Missed a door? You can still open it until December 26."
              : `The calendar opens on ${startText}.`}{" "}
            Behind the doors: points and Christmas cosmetics you can't get anywhere else. Every door is a surprise!
          </p>
          <div className="advent-grid">
            {cal.doors.map((d) => (
              <button
                key={d.day}
                className={"advent-door" + (d.claimed ? " done" : d.open ? " ready" : "") + (d.today ? " today" : "")}
                disabled={!d.open || d.claimed || busy !== 0}
                onClick={() => open(d.day)}
                title={d.claimed && d.reward ? d.reward.name : d.open ? "Open it" : `Opens on December ${d.day}`}
              >
                {d.claimed && d.reward ? (
                  <>
                    {d.reward.kind === "icon" ? (
                      <img className="icon-art" src={`/cosmetics/icons/${d.reward.id}.png`} alt="" />
                    ) : d.reward.kind === "points" ? (
                      <Coin size={22} />
                    ) : (
                      <Icon name="sparkle" size={22} />
                    )}
                    <small>{d.reward.name}</small>
                  </>
                ) : (
                  <>
                    <b>{d.day}</b>
                    {busy === d.day ? <Spinner size={12} /> : !d.open ? <Icon name="lock" size={12} /> : <small>Open</small>}
                  </>
                )}
              </button>
            ))}
          </div>
          {got && <p className="advent-got">You got: <b>{got}</b></p>}
        </div>
      )}
    </Modal>
  );
}


/** Outfits (saved looks, the same as in game) and sets (items that go together, cheaper together). */
function OutfitsPanel({ look, catalog, onWear, onWallet, onOwned, art }: {
  look: Look; catalog: Catalog | null; onWear: (l: Look) => void; onWallet: (w: Wallet) => void; onOwned: (keys: string[]) => void;
  art: (kind: ShopKind, id: string) => JSX.Element;
}) {
  const [outfits, setOutfits] = useState<Outfit[] | null>(null);
  const [sets, setSets] = useState<ShopSet[] | null>(null);
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState(-1);
  const [busy, setBusy] = useState("");
  useEffect(() => {
    api.outfits().then((r) => setOutfits(r.outfits)).catch(() => setOutfits([]));
    api.sets().then((r) => setSets(r.sets)).catch(() => setSets([]));
  }, []);
  async function store(list: Outfit[]) {
    setOutfits(list);
    try {
      const r = await api.outfitsSave(list);
      setOutfits(r.outfits);
    } catch (e) {
      toast(msg(e), "error");
    }
  }
  const same = (a: Look, b: Look) => (["cape", "wings", "halo", "hat", "aura", "pet", "nametag", "icon"] as const).every((k) => a[k] === b[k]);
  const nameOf = (kind: ShopKind, id: string) => {
    const tab = TABS.find((x) => x.field === kind);
    return (tab && catalog?.[tab.id].find((i) => i.id === id)?.name) || id.replace(/^cc_/, "").replace(/_/g, " ");
  };
  async function buySet(st: ShopSet) {
    setBusy(st.id);
    try {
      const r = await api.setBuy(st.id);
      onWallet(r.wallet);
      onOwned(st.items.map((i) => i.kind + ":" + i.id));
      setSets((ss) => ss && ss.map((x) => (x.id === st.id ? { ...x, owned: true, items: x.items.map((i) => ({ ...i, owned: true })) } : x)));
      wearSet(st);
      toast(`The ${st.name} set is yours!`, "ok");
    } catch (e) {
      toast(msg(e), "error");
    } finally {
      setBusy("");
    }
  }
  function wearSet(st: ShopSet) {
    const l: Look = { ...look };
    for (const it of st.items) (l as Record<string, unknown>)[it.kind] = it.id;
    onWear(l);
  }
  return (
    <div className="outfits">
      <div className="outfits-head">
        <b>Your outfits</b>
        <span className="muted small">{outfits?.length ?? 0} / 12 · the same in game (Locker → Outfits)</span>
        <div className="outfits-save">
          <input placeholder="Name for what you wear now" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} />
          <button
            className="btn small primary"
            disabled={!outfits || outfits.length >= 12}
            onClick={() => {
              store([...(outfits ?? []), { name: name.trim() || `Outfit ${(outfits?.length ?? 0) + 1}`, look }]);
              setName("");
              toast("Outfit saved", "ok");
            }}
          >
            <Icon name="plus" size={13} /> Save outfit
          </button>
        </div>
      </div>
      {!outfits ? (
        <div className="center pad">
          <Spinner />
        </div>
      ) : outfits.length === 0 ? (
        <p className="muted small">No outfits yet: put something on and save it here, then switch looks with one click.</p>
      ) : (
        <div className="outfit-grid">
          {outfits.map((o, i) => {
            const parts = (["wings", "cape", "halo", "hat", "aura", "pet", "nametag", "icon"] as const).filter((k) => o.look[k] !== "none");
            return (
              <div key={i} className={"outfit-card glass" + (same(o.look, look) ? " on" : "")} onClick={() => onWear(o.look)}>
                <div className="outfit-art">
                  {parts.slice(0, 3).map((k) => (
                    <div key={k} className="outfit-thumb">
                      {art(k, o.look[k] as string)}
                    </div>
                  ))}
                  {parts.length === 0 && <Icon name="x" size={18} />}
                </div>
                {renaming === i ? (
                  <input
                    autoFocus
                    defaultValue={o.name}
                    maxLength={24}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                    }}
                    onBlur={(e) => {
                      setRenaming(-1);
                      const v = e.currentTarget.value.trim();
                      if (v && v !== o.name) store(outfits.map((x, j) => (j === i ? { ...x, name: v } : x)));
                    }}
                  />
                ) : (
                  <b>{o.name}</b>
                )}
                <small className="muted">{parts.map((k) => nameOf(k, o.look[k] as string)).join(" · ") || "Nothing on"}</small>
                <div className="outfit-actions" onClick={(e) => e.stopPropagation()}>
                  <button title="Rename" onClick={() => setRenaming(i)}>
                    <Icon name="edit" size={13} />
                  </button>
                  <button title="Save what you wear now into this outfit" onClick={() => (store(outfits.map((x, j) => (j === i ? { ...x, look } : x))), toast("Outfit updated", "ok"))}>
                    <Icon name="refresh" size={13} />
                  </button>
                  <button title="Delete" onClick={() => store(outfits.filter((_, j) => j !== i))}>
                    <Icon name="trash" size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="outfits-head">
        <b>Sets</b>
        <span className="muted small">Cheaper together: you only pay for the parts you don't have</span>
      </div>
      {!sets ? (
        <div className="center pad">
          <Spinner />
        </div>
      ) : (
        <div className="set-list">
          {sets.map((st) => (
            <div key={st.id} className={"set-card glass" + (st.owned ? " owned" : "")}>
              <div className="set-art" onClick={() => wearSet(st)} title="Try it on">
                {st.items.slice(0, 5).map((it) => (
                  <div key={it.kind + it.id} className={"outfit-thumb" + (it.owned ? " have" : "")} title={it.name}>
                    {art(it.kind, it.id)}
                  </div>
                ))}
              </div>
              <div className="set-info">
                <b>{st.name}</b>
                <small className="muted">{st.items.map((it) => (it.owned ? "✓ " : "") + it.name).join(" · ")}</small>
              </div>
              <div className="set-buy">
                {st.owned ? (
                  <button className="btn small" onClick={() => wearSet(st)}>
                    <Icon name="check" size={13} /> Wear set
                  </button>
                ) : st.why ? (
                  <span className="muted small">{st.why}</span>
                ) : (
                  <>
                    <span className="price cost deal">
                      <s>{st.full_price.toLocaleString()}</s> <Coin size={13} /> {st.price.toLocaleString()}
                    </span>
                    <button className="btn small primary" disabled={busy !== ""} onClick={() => buySet(st)}>
                      {busy === st.id ? <Spinner size={12} /> : <Coin size={14} />} Buy set (-{st.off}%)
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
