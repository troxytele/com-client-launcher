import { useEffect, useState } from "react";
import { api, GiftFriend, msg, ShopKind, Wallet } from "../api";
import { toast } from "../stores";
import Coin from "./Coin";
import Face from "./Face";
import Icon from "./Icon";
import { Modal, Spinner } from "./Ui";

// Send a cosmetic to a friend: you pay the points, they own it and get told it's from you.
export default function GiftDialog({ kind, id, name, onClose, onSent }: { kind: ShopKind; id: string; name: string; onClose: () => void; onSent: (w: Wallet) => void }) {
  const [data, setData] = useState<{ friends: GiftFriend[]; price: number; points: number } | null>(null);
  const [error, setError] = useState("");
  const [to, setTo] = useState<GiftFriend | null>(null);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  useEffect(() => {
    api.giftable(kind, id).then(setData).catch((e) => setError(msg(e)));
  }, [kind, id]);
  const short = data ? Math.max(0, data.price - data.points) : 0;

  async function send() {
    if (!to) return;
    setSending(true);
    try {
      const r = await api.gift(to.uuid, kind, id, note.trim());
      toast(`${to.name} got ${name}!`, "ok");
      onSent(r.wallet);
      onClose();
    } catch (e) {
      toast(msg(e), "error");
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal title="Send a gift" onClose={onClose} width={440}>
      <div className="gift">
        <div className="gift-item">
          <Icon name="gift" size={18} />
          <div>
            <b>{name}</b>
            <span className="muted small">{data ? `You have ${data.points.toLocaleString()} points` : "Loading…"}</span>
          </div>
          {data && (
            <span className="gift-price">
              <Coin size={15} /> {data.price.toLocaleString()}
            </span>
          )}
        </div>
        <h4>Who is it for?</h4>
        {error ? (
          <p className="error small">{error}</p>
        ) : !data ? (
          <div className="center pad">
            <Spinner />
          </div>
        ) : data.friends.length === 0 ? (
          <p className="muted small">Add friends first: gifts can only go to friends.</p>
        ) : (
          <div className="gift-list">
            {data.friends.map((f) => (
              <button key={f.uuid} className={"gift-friend" + (to?.uuid === f.uuid ? " on" : "")} disabled={f.has} onClick={() => setTo(f)}>
                <Face name={f.name} size={26} />
                <span>{f.name}</span>
                {f.has && <small className="muted">Already has it</small>}
              </button>
            ))}
          </div>
        )}
        <input placeholder="Add a message (optional)" value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} />
        <button className="btn primary wide" disabled={!to || sending || !data || short > 0} onClick={send}>
          {sending ? <Spinner size={13} /> : <Icon name="gift" size={15} />}{" "}
          {!to ? "Pick a friend" : short > 0 ? `${short.toLocaleString()} more points needed` : `Send to ${to.name} · ${data?.price.toLocaleString()} points`}
        </button>
      </div>
    </Modal>
  );
}
