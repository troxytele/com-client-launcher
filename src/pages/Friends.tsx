import { useCallback, useEffect, useRef, useState } from "react";
import { ago, api, Chat, ChatSummary, msg, ServerFriend, ServerState } from "../api";
import { toast } from "../stores";
import Icon from "../components/Icon";
import { Empty, Spinner } from "../components/Ui";

export function head(uuid: string, size = 32) {
  return `https://mc-heads.net/avatar/${uuid.replace(/-/g, "")}/${size}`;
}

function Head({ uuid, size = 34, online }: { uuid: string; size?: number; online?: boolean }) {
  return (
    <span className="fr-head" style={{ width: size, height: size }}>
      <img src={head(uuid, size * 2)} alt="" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
      {online !== undefined && <i className={online ? "on" : ""} />}
    </span>
  );
}

const display = (f: { name: string; username?: string }) => (f.username ? "@" + f.username : f.name);

// Friends: who's online and where (with quick join), friend requests, and chat with them (same chats as in game).
export default function Friends({ signedIn, running, onJoin, onAccounts, onUnread }: {
  signedIn: boolean;
  running: boolean;
  onJoin: (server: string) => void;
  onAccounts: () => void;
  onUnread: (n: number) => void;
}) {
  const [state, setState] = useState<ServerState | null>(null);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<{ uuid: string; name: string } | null>(null);
  const [add, setAdd] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([api.serverGet<ServerState>("/state"), api.serverGet<{ chats: ChatSummary[]; unread: number; requests: number }>("/chats")]);
      setState(s);
      setChats(c.chats);
      onUnread(c.unread + c.requests);
      setError(null);
    } catch (e) {
      setError(msg(e));
    }
  }, [onUnread]);

  useEffect(() => {
    if (!signedIn) return;
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [signedIn, load]);

  async function request() {
    const name = add.trim();
    if (!name) return;
    setAdding(true);
    try {
      await api.serverPost("/friends/request", { name });
      toast("Friend request sent to " + name, "ok");
      setAdd("");
      load();
    } catch (e) {
      toast(msg(e), "error");
    } finally {
      setAdding(false);
    }
  }

  async function answer(uuid: string, accept: boolean) {
    try {
      await api.serverPost(accept ? "/friends/accept" : "/friends/decline", { uuid });
      load();
    } catch (e) {
      toast(msg(e), "error");
    }
  }

  if (!signedIn)
    return (
      <div className="page">
        <Empty icon="users" title="Sign in to see your friends" text="Friends are your Com Client friends: the same list as in game.">
          <button className="btn primary" onClick={onAccounts}>
            <Icon name="user" size={15} /> Sign in
          </button>
        </Empty>
      </div>
    );

  const friends = [...(state?.friends ?? [])].sort((a, b) => Number(b.online) - Number(a.online) || b.last_seen - a.last_seen);
  const online = friends.filter((f) => f.online);
  const unreadOf = (uuid: string) => chats.find((c) => c.uuid === uuid)?.unread ?? 0;
  // chats with people who aren't friends (message requests)
  const others = chats.filter((c) => !friends.some((f) => f.uuid === c.uuid));

  return (
    <div className="page friends-page">
      <div className="page-head">
        <div>
          <h1>Friends</h1>
          <p className="muted">
            {state ? `${online.length} of ${friends.length} online` : "Loading…"} · join their server with one click, or chat right here.
          </p>
        </div>
        <div className="row-gap">
          <div className="search small">
            <Icon name="userPlus" size={15} />
            <input placeholder="Add friend (Minecraft name)" value={add} onChange={(e) => setAdd(e.target.value)} onKeyDown={(e) => e.key === "Enter" && request()} />
          </div>
          <button className="btn primary" disabled={!add.trim() || adding} onClick={request}>
            {adding ? <Spinner size={13} /> : <Icon name="plus" size={15} />} Add
          </button>
        </div>
      </div>
      {error && <p className="hint error">{error}</p>}
      <div className="friends-layout">
        <div className="friends-list">
          {!state ? (
            <div className="center pad">
              <Spinner />
            </div>
          ) : (
            <>
              {state.incoming.length > 0 && (
                <>
                  <div className="fr-section">Friend requests</div>
                  {state.incoming.map((r) => (
                    <div key={r.uuid} className="fr-row glass">
                      <Head uuid={r.uuid} />
                      <div className="fr-text">
                        <b>{r.name}</b>
                        <span>wants to be friends · {ago(r.created)}</span>
                      </div>
                      <button className="btn small primary" onClick={() => answer(r.uuid, true)}>
                        <Icon name="check" size={13} /> Accept
                      </button>
                      <button className="icon-btn" title="Decline" onClick={() => answer(r.uuid, false)}>
                        <Icon name="x" size={15} />
                      </button>
                    </div>
                  ))}
                </>
              )}
              <div className="fr-section">Friends</div>
              {friends.length === 0 && <p className="muted small pad">No friends yet: add someone by their Minecraft name.</p>}
              {friends.map((f) => (
                <FriendRow
                  key={f.uuid}
                  f={f}
                  unread={unreadOf(f.uuid)}
                  active={open?.uuid === f.uuid}
                  running={running}
                  onChat={() => setOpen({ uuid: f.uuid, name: display(f) })}
                  onJoin={onJoin}
                />
              ))}
              {others.length > 0 && (
                <>
                  <div className="fr-section">Other chats</div>
                  {others.map((c) => (
                    <button key={c.uuid} className={"fr-row glass" + (open?.uuid === c.uuid ? " on" : "")} onClick={() => setOpen({ uuid: c.uuid, name: display(c) })}>
                      <Head uuid={c.uuid} />
                      <div className="fr-text">
                        <b>{display(c)}</b>
                        <span>{c.request ? "Message request" : c.last?.text ?? ""}</span>
                      </div>
                      {c.unread > 0 && <em className="badge">{c.unread}</em>}
                    </button>
                  ))}
                </>
              )}
            </>
          )}
        </div>
        <div className="chat-pane glass">
          {open ? (
            <ChatView key={open.uuid} uuid={open.uuid} name={open.name} onChanged={load} />
          ) : (
            <Empty icon="chat" title="Pick a friend to chat" text="Messages also show up in game (Com Client chats)." />
          )}
        </div>
      </div>
    </div>
  );
}

function FriendRow({ f, unread, active, running, onChat, onJoin }: {
  f: ServerFriend;
  unread: number;
  active: boolean;
  running: boolean;
  onChat: () => void;
  onJoin: (server: string) => void;
}) {
  const where = f.online ? (f.server ? "Playing on " + f.server : f.activity || "Online") : "Last seen " + ago(f.last_seen);
  return (
    <div className={"fr-row glass" + (active ? " on" : "") + (f.online ? "" : " off")} onClick={onChat}>
      <Head uuid={f.uuid} online={f.online} />
      <div className="fr-text">
        <b>
          {display(f)} <span className="muted small">LV {f.level}</span>
        </b>
        <span>{where}</span>
      </div>
      {unread > 0 && <em className="badge">{unread}</em>}
      {f.online && f.server && (
        <button
          className="btn small primary"
          disabled={running}
          title={running ? "Close the game first" : "Start the game and join " + f.server}
          onClick={(e) => {
            e.stopPropagation();
            onJoin(f.server!);
          }}
        >
          <Icon name="play" size={12} fill /> Join them
        </button>
      )}
    </div>
  );
}

function ChatView({ uuid, name, onChanged }: { uuid: string; name: string; onChanged: () => void }) {
  const [chat, setChat] = useState<Chat | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    api.serverGet<Chat>("/chats/" + uuid).then(setChat).catch((e) => toast(msg(e), "error"));
  }, [uuid]);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  const count = chat?.messages.length ?? 0;
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: count ? "smooth" : "auto" });
  }, [count]);

  async function send() {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    try {
      await api.serverPost("/chats/" + uuid, { text: t });
      setText("");
      load();
      onChanged();
    } catch (e) {
      toast(msg(e), "error");
    } finally {
      setSending(false);
    }
  }

  async function answer(accept: boolean) {
    try {
      await api.serverPost(`/chats/${uuid}/${accept ? "accept" : "decline"}`);
      load();
      onChanged();
    } catch (e) {
      toast(msg(e), "error");
    }
  }

  return (
    <div className="chat">
      <div className="chat-head">
        <Head uuid={uuid} size={30} />
        <b>{name}</b>
        {chat && !chat.friend && <span className="muted small">not your friend</span>}
      </div>
      <div className="chat-msgs">
        {!chat ? (
          <div className="center pad">
            <Spinner />
          </div>
        ) : chat.messages.length === 0 ? (
          <p className="muted small center pad">No messages yet. Say hi!</p>
        ) : (
          chat.messages.map((m, i) => {
            const mine = m.from !== uuid;
            const prev = chat.messages[i - 1];
            const gap = !prev || m.at - prev.at > 600;
            return (
              <div key={m.id} className={"msg-wrap" + (mine ? " mine" : "")}>
                {gap && <div className="msg-time">{new Date(m.at * 1000).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}</div>}
                <div className="msg">{m.text}</div>
              </div>
            );
          })
        )}
        {chat && chat.messages.length > 0 && chat.messages[chat.messages.length - 1].from !== uuid && chat.other_read >= chat.messages[chat.messages.length - 1].at && (
          <div className="msg-seen">Seen</div>
        )}
        <div ref={end} />
      </div>
      {chat?.request ? (
        <div className="chat-request">
          <span>{name} wants to message you.</span>
          <button className="btn small primary" onClick={() => answer(true)}>
            Accept
          </button>
          <button className="btn small" onClick={() => answer(false)}>
            Decline
          </button>
        </div>
      ) : chat?.declined ? (
        <p className="hint error">They declined your messages.</p>
      ) : (
        <div className="chat-input">
          <input
            placeholder={"Message " + name}
            value={text}
            maxLength={500}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
          />
          <button className="btn primary" disabled={!text.trim() || sending} onClick={send} title="Send (Enter)">
            {sending ? <Spinner size={13} /> : <Icon name="send" size={15} />}
          </button>
        </div>
      )}
    </div>
  );
}
