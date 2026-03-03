import { useState, useEffect, useRef, useCallback, createContext, useContext } from 'react';
import { io } from 'socket.io-client';

// ─── Config ─────────────────────────────────────────────────────────────────
// In development:  Vite proxy forwards /api → localhost:5000 (no env var needed)
// In production:   Netlify sets VITE_API_URL + VITE_SOCKET_URL to Railway URL
const API        = import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api';
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || '';

// ─── Auth Context ────────────────────────────────────────────────────────────
const AuthCtx = createContext(null);
const useAuth = () => useContext(AuthCtx);

// ─── API helper ──────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const token = localStorage.getItem('sc_token');
  const res = await fetch(`${API}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ─── Design tokens ───────────────────────────────────────────────────────────
const C = {
  bg0: '#0b0d12',
  bg1: '#0e1118',
  bg2: '#131720',
  bg3: '#1a2030',
  bg4: '#212840',
  border: 'rgba(74,175,255,0.12)',
  borderHover: 'rgba(74,175,255,0.28)',
  accent: '#4aafff',
  accentDim: 'rgba(74,175,255,0.15)',
  accentGlow: 'rgba(74,175,255,0.35)',
  green: '#3ecf8e',
  yellow: '#f0b429',
  red: '#e05c5c',
  orange: '#f0832a',
  text0: '#e8ecf0',
  text1: '#9daab8',
  text2: '#5a6478',
  text3: '#3a4258',
};

const STATUS_COLOR = { online: C.green, idle: C.yellow, dnd: C.red, invisible: C.text2, offline: C.text2 };
const CL_COLOR = ['', '#4aafff', '#3ecf8e', '#f0b429', '#f0832a', '#e05c5c'];

// ─── Tiny utilities ──────────────────────────────────────────────────────────
function clx(...args) { return args.filter(Boolean).join(' '); }
function timeStr(d) {
  const dt = new Date(d);
  return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function dateStr(d) {
  return new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}
function avatarHue(name = '') {
  return ([...name].reduce((a, c) => a + c.charCodeAt(0), 0) * 137) % 360;
}

// ─── Avatar ──────────────────────────────────────────────────────────────────
function Avatar({ user, size = 36, showStatus = false, style }) {
  const initials = (user?.displayName || user?.username || '?')[0].toUpperCase();
  const hue = avatarHue(user?.username);
  const status = user?.status || 'offline';
  const dotSize = Math.round(size * 0.32);
  return (
    <div style={{ position: 'relative', flexShrink: 0, width: size, height: size, ...style }}>
      <div style={{
        width: size, height: size, borderRadius: '50%',
        background: user?.avatar ? 'none' : `hsl(${hue},45%,36%)`,
        backgroundImage: user?.avatar ? `url(${user.avatar})` : 'none',
        backgroundSize: 'cover', backgroundPosition: 'center',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: "'Orbitron', sans-serif", fontSize: size * 0.38, fontWeight: 700,
        color: '#fff', userSelect: 'none',
        border: `1.5px solid rgba(255,255,255,0.07)`,
      }}>
        {!user?.avatar && initials}
      </div>
      {showStatus && (
        <div style={{
          position: 'absolute', bottom: -1, right: -1,
          width: dotSize, height: dotSize, borderRadius: '50%',
          background: STATUS_COLOR[status], border: `2px solid ${C.bg1}`,
        }} />
      )}
    </div>
  );
}

// ─── Clearance Badge ─────────────────────────────────────────────────────────
function CLBadge({ level }) {
  if (!level) return null;
  return (
    <span style={{
      background: CL_COLOR[level] + '22', color: CL_COLOR[level],
      border: `1px solid ${CL_COLOR[level]}55`,
      fontSize: 9, fontFamily: "'Share Tech Mono', monospace",
      padding: '1px 6px', borderRadius: 3, letterSpacing: 1.5, fontWeight: 700,
    }}>
      CL-{level}
    </span>
  );
}

// ─── Icon components ─────────────────────────────────────────────────────────
const Icon = {
  Hash: () => <span style={{ fontFamily: 'monospace', fontSize: 15, color: C.text2 }}>#</span>,
  Vol:  () => <span style={{ fontSize: 13 }}>🔊</span>,
  Mega: () => <span style={{ fontSize: 13 }}>📢</span>,
  DM:   () => <span style={{ fontSize: 13 }}>💬</span>,
  Plus: ({ color = C.green }) => <span style={{ fontSize: 20, color, lineHeight: 1 }}>+</span>,
  Cog:  () => <span style={{ fontSize: 15 }}>⚙</span>,
  Exit: () => <span style={{ fontSize: 14 }}>⏻</span>,
  Mic:  ({ muted }) => <span style={{ fontSize: 14 }}>{muted ? '🎙️' : '🎤'}</span>,
  Deaf: ({ on }) => <span style={{ fontSize: 14 }}>{on ? '🔇' : '🔊'}</span>,
};

// ─── Modal shell ─────────────────────────────────────────────────────────────
function Modal({ title, subtitle, onClose, children, width = 440 }) {
  return (
    <div onClick={e => e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
      <div style={{
        width, background: C.bg2, border: `1px solid ${C.border}`,
        borderRadius: 10, padding: '32px 36px', position: 'relative',
        boxShadow: `0 24px 80px rgba(0,0,0,0.8), 0 0 0 1px ${C.accentDim}`,
      }}>
        {/* Corner accents */}
        {[['top','left'],['top','right'],['bottom','left'],['bottom','right']].map(([v,h]) => (
          <div key={v+h} style={{
            position: 'absolute', [v]: -1, [h]: -1, width: 14, height: 14,
            borderTop:    v === 'top'    ? `2px solid ${C.accent}` : 'none',
            borderBottom: v === 'bottom' ? `2px solid ${C.accent}` : 'none',
            borderLeft:   h === 'left'   ? `2px solid ${C.accent}` : 'none',
            borderRight:  h === 'right'  ? `2px solid ${C.accent}` : 'none',
          }} />
        ))}

        <button onClick={onClose} style={{
          position: 'absolute', top: 14, right: 14, background: 'none',
          border: 'none', color: C.text2, cursor: 'pointer', fontSize: 18, lineHeight: 1,
        }}>✕</button>

        {title && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 16, fontWeight: 700, color: C.accent, letterSpacing: 2 }}>{title}</div>
            {subtitle && <div style={{ color: C.text2, fontSize: 11, letterSpacing: 2, marginTop: 4 }}>{subtitle}</div>}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

// ─── Form Field ──────────────────────────────────────────────────────────────
function Field({ label, value, onChange, type = 'text', placeholder, required, hint }) {
  const [focus, setFocus] = useState(false);
  return (
    <div style={{ marginBottom: 18 }}>
      <label style={{ display: 'block', color: C.accent, fontSize: 10, letterSpacing: 3, marginBottom: 7, opacity: 0.8 }}>{label}</label>
      <input
        type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} required={required}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        style={{
          width: '100%', padding: '10px 14px',
          background: focus ? 'rgba(74,175,255,0.07)' : C.bg3,
          border: `1px solid ${focus ? C.accent : C.border}`,
          borderRadius: 5, color: C.text0, fontFamily: "'Rajdhani', sans-serif",
          fontSize: 14, outline: 'none', transition: 'all 0.18s',
        }}
      />
      {hint && <div style={{ color: C.text2, fontSize: 10, marginTop: 5, letterSpacing: 1 }}>{hint}</div>}
    </div>
  );
}

// ─── Primary Button ──────────────────────────────────────────────────────────
function Btn({ children, onClick, type = 'button', loading, danger, secondary, style: s }) {
  return (
    <button type={type} onClick={onClick} disabled={loading}
      style={{
        width: '100%', padding: '11px', cursor: loading ? 'default' : 'pointer',
        background: loading ? C.bg4 : danger ? 'rgba(224,92,92,0.15)' : secondary ? C.bg3 : `linear-gradient(135deg, #1a4a7a, ${C.accent})`,
        border: `1px solid ${loading ? C.border : danger ? C.red : secondary ? C.border : C.accent}`,
        borderRadius: 5, color: loading ? C.text2 : danger ? C.red : C.text0,
        fontFamily: "'Orbitron', sans-serif", fontSize: 11, fontWeight: 700,
        letterSpacing: 2.5, transition: 'all 0.18s',
        boxShadow: loading || secondary || danger ? 'none' : `0 0 20px ${C.accentGlow}`,
        ...s,
      }}>
      {loading ? 'PROCESSING...' : children}
    </button>
  );
}

// ─── Auth Screen ─────────────────────────────────────────────────────────────
function AuthScreen({ onAuth }) {
  const [mode, setMode]   = useState('login');
  const [form, setForm]   = useState({ username: '', email: '', password: '', displayName: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const set = k => v => setForm(f => ({ ...f, [k]: v }));

  async function submit(e) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const path = mode === 'login' ? '/auth/login' : '/auth/register';
      const body = mode === 'login'
        ? { login: form.email || form.username, password: form.password }
        : form;
      const data = await api(path, { method: 'POST', body });
      localStorage.setItem('sc_token', data.token);
      onAuth(data.user, data.token);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg0, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>

      {/* Radial glow */}
      <div style={{ position: 'absolute', top: '30%', left: '50%', transform: 'translate(-50%,-50%)', width: 700, height: 700, borderRadius: '50%', background: 'radial-gradient(circle, rgba(74,175,255,0.07) 0%, transparent 65%)', pointerEvents: 'none' }} />

      {/* Grid overlay */}
      <div style={{ position: 'absolute', inset: 0, backgroundImage: `linear-gradient(${C.border} 1px, transparent 1px), linear-gradient(90deg, ${C.border} 1px, transparent 1px)`, backgroundSize: '48px 48px', pointerEvents: 'none', opacity: 0.5 }} />

      {/* Animated scan line */}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, height: 1, background: `linear-gradient(90deg, transparent, ${C.accent}44, transparent)`, animation: 'scanY 6s linear infinite' }} />
      </div>

      <style>{`
        @keyframes scanY { 0% { top: -2px; } 100% { top: 100vh; } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse { 0%, 100% { opacity: 0.7; } 50% { opacity: 1; } }
        @keyframes blink { 0%, 100% { opacity: 1; } 45%, 55% { opacity: 0; } }
      `}</style>

      <div style={{ width: 420, position: 'relative', zIndex: 1, animation: 'fadeUp 0.4s ease' }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <div style={{ width: 42, height: 42, borderRadius: 10, background: `linear-gradient(135deg, #1a4a7a, ${C.accent})`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 0 24px ${C.accentGlow}` }}>
              <span style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 16, fontWeight: 900, color: '#fff' }}>SC</span>
            </div>
            <div style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 26, fontWeight: 900, color: C.accent, letterSpacing: 4, textShadow: `0 0 32px ${C.accentGlow}` }}>SATCORP</div>
          </div>
          <div style={{ color: C.text2, fontSize: 10, letterSpacing: 5, marginTop: 4 }}>SECURE COMMUNICATIONS NETWORK</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: C.green, animation: 'pulse 2s ease-in-out infinite' }} />
            <span style={{ color: C.green, fontSize: 10, letterSpacing: 3, fontFamily: "'Share Tech Mono', monospace" }}>SYSTEMS NOMINAL</span>
          </div>
        </div>

        {/* Card */}
        <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 10, padding: '36px 40px', boxShadow: `0 32px 80px rgba(0,0,0,0.7)` }}>
          <div style={{ color: C.text1, fontSize: 11, letterSpacing: 4, marginBottom: 24, fontFamily: "'Share Tech Mono', monospace" }}>
            {mode === 'login' ? '// AUTHENTICATE OPERATIVE' : '// REGISTER NEW OPERATIVE'}
          </div>

          <form onSubmit={submit}>
            {mode === 'register' && (
              <>
                <Field label="OPERATIVE NAME" value={form.displayName} onChange={set('displayName')} placeholder="Display name" />
                <Field label="CALLSIGN (USERNAME)" value={form.username} onChange={set('username')} placeholder="username" required />
                <Field label="ENCRYPTED CHANNEL (EMAIL)" value={form.email} onChange={set('email')} type="email" placeholder="email@domain.com" required />
              </>
            )}
            {mode === 'login' && (
              <Field label="IDENTIFIER" value={form.email} onChange={set('email')} placeholder="username or email" required />
            )}
            <Field label="ACCESS CODE" value={form.password} onChange={set('password')} type="password" placeholder="••••••••" required />

            {error && (
              <div style={{ padding: '10px 14px', background: 'rgba(224,92,92,0.1)', border: `1px solid rgba(224,92,92,0.3)`, borderRadius: 5, color: C.red, fontSize: 12, fontFamily: "'Share Tech Mono', monospace", letterSpacing: 0.5, marginBottom: 16 }}>
                ⚠ {error}
              </div>
            )}

            <Btn type="submit" loading={loading}>{mode === 'login' ? 'AUTHENTICATE' : 'REGISTER OPERATIVE'}</Btn>
          </form>

          <div style={{ textAlign: 'center', marginTop: 20 }}>
            <button onClick={() => { setMode(m => m === 'login' ? 'register' : 'login'); setError(''); }}
              style={{ background: 'none', border: 'none', color: C.accent, cursor: 'pointer', fontSize: 11, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif", opacity: 0.8 }}>
              {mode === 'login' ? 'REQUEST ACCESS →' : '← BACK TO LOGIN'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [user,            setUser]           = useState(null);
  const [token,           setToken]          = useState(null);
  const [socket,          setSocket]         = useState(null);
  const [servers,         setServers]        = useState([]);
  const [activeServer,    setActiveServer]   = useState(null);
  const [channels,        setChannels]       = useState([]);
  const [activeChannel,   setActiveChannel]  = useState(null);
  const [messages,        setMessages]       = useState({});   // channelId → []
  const [dmChannels,      setDmChannels]     = useState([]);
  const [typingUsers,     setTypingUsers]    = useState({});   // channelId → {userId: name}
  const [onlineStatus,    setOnlineStatus]   = useState({});   // userId → status
  const [voiceParticipants, setVoiceParticipants] = useState({}); // channelId → []
  const [panel,           setPanel]          = useState('chat'); // chat | settings | dms
  const [modalOpen,       setModalOpen]      = useState(null);  // 'create' | 'join' | null
  const [sessionLoaded,   setSessionLoaded]  = useState(false);

  // ── Restore session ─────────────────────────────────────────────────────
  useEffect(() => {
    const t = localStorage.getItem('sc_token');
    if (t) {
      api('/auth/me')
        .then(d => { setUser(d.user); setToken(t); })
        .catch(() => localStorage.removeItem('sc_token'))
        .finally(() => setSessionLoaded(true));
    } else { setSessionLoaded(true); }
  }, []);

  function handleAuth(u, t) { setUser(u); setToken(t); }

  // ── Socket setup ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    const s = io(SOCKET_URL, { auth: { token }, transports: ['websocket'] });
    setSocket(s);

    s.on('user_status_change',      ({ userId, status }) => setOnlineStatus(p => ({ ...p, [userId]: status })));
    s.on('user_typing',             ({ userId, username, channelId }) => setTypingUsers(p => ({ ...p, [channelId]: { ...(p[channelId] || {}), [userId]: username } })));
    s.on('user_stop_typing',        ({ userId, channelId }) => setTypingUsers(p => { const c = { ...(p[channelId] || {}) }; delete c[userId]; return { ...p, [channelId]: c }; }));
    s.on('new_message',             ({ message }) => setMessages(p => ({ ...p, [message.channel]: [...(p[message.channel] || []), message] })));
    s.on('message_edited',          ({ messageId, content, editedAt }) => setMessages(p => {
      const out = {};
      for (const [k, msgs] of Object.entries(p)) out[k] = msgs.map(m => m._id === messageId ? { ...m, content, edited: true, editedAt } : m);
      return out;
    }));
    s.on('message_deleted',         ({ messageId }) => setMessages(p => {
      const out = {};
      for (const [k, msgs] of Object.entries(p)) out[k] = msgs.filter(m => m._id !== messageId);
      return out;
    }));
    s.on('reaction_update',         ({ messageId, reactions }) => setMessages(p => {
      const out = {};
      for (const [k, msgs] of Object.entries(p)) out[k] = msgs.map(m => m._id === messageId ? { ...m, reactions } : m);
      return out;
    }));
    s.on('voice_participants_update', ({ channelId, participants }) => setVoiceParticipants(p => ({ ...p, [channelId]: participants })));

    return () => s.disconnect();
  }, [token]);

  // ── Load servers after login ────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    api('/servers').then(d => {
      setServers(d.servers || []);
      if (d.servers?.length) loadServer(d.servers[0]._id);
    }).catch(console.error);
    api('/dms').then(d => setDmChannels(d.channels || [])).catch(console.error);
  }, [user]);

  async function loadServer(serverId) {
    try {
      const d = await api(`/servers/${serverId}`);
      setActiveServer(d.server);
      setChannels(d.channels || []);
      socket?.emit('join_server', serverId);
      const first = d.channels?.find(c => c.type === 'text' || c.type === 'announcement');
      if (first) loadChannel(first);
    } catch (err) { console.error(err); }
  }

  async function loadChannel(ch) {
    setActiveChannel(ch);
    setPanel('chat');
    socket?.emit('join_channel', ch._id);
    if (!messages[ch._id]) {
      try {
        const endpoint = ch.type === 'dm' ? `/dms/${ch._id}/messages` : `/messages/${ch._id}`;
        const d = await api(endpoint);
        setMessages(p => ({ ...p, [ch._id]: d.messages || [] }));
      } catch (err) { console.error(err); }
    }
  }

  function sendMessage(content, replyToId) {
    if (!socket || !activeChannel || !content.trim()) return;
    socket.emit('send_message', { channelId: activeChannel._id, content, replyToId });
  }

  async function logout() {
    try { await api('/auth/logout', { method: 'POST' }); } catch {}
    localStorage.removeItem('sc_token');
    setUser(null); setToken(null); setSocket(null); setServers([]); setActiveServer(null); setChannels([]); setMessages({});
  }

  if (!sessionLoaded) return (
    <div style={{ minHeight: '100vh', background: C.bg0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Orbitron', sans-serif", color: C.accent, letterSpacing: 4, fontSize: 13 }}>
      INITIALIZING SATCORP...
    </div>
  );
  if (!user) return <AuthScreen onAuth={handleAuth} />;

  return (
    <AuthCtx.Provider value={{ user, token, logout }}>
      <style>{`
        @keyframes fadeIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
        @keyframes pulse  { 0%,100% { opacity:0.6; } 50% { opacity:1; } }
        @keyframes scanY  { 0% { top:-2px; } 100% { top:100vh; } }
        .sc-hover:hover { background: rgba(255,255,255,0.04) !important; }
        .sc-ch:hover { background: rgba(74,175,255,0.07) !important; cursor:pointer; }
        .sc-srv:hover { border-radius: 14px !important; }
        .msg-row:hover { background: rgba(255,255,255,0.018) !important; }
        .msg-row:hover .msg-actions { opacity:1 !important; }
        .emoji-btn:hover { background: rgba(74,175,255,0.18) !important; }
      `}</style>

      <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: C.bg0, color: C.text0, fontFamily: "'Rajdhani', sans-serif" }}>

        {/* ── Server Rail ── */}
        <ServerRail
          servers={servers} activeServer={activeServer}
          onSelect={id => loadServer(id)}
          onCreateServer={() => setModalOpen('create')}
          onJoinServer={() => setModalOpen('join')}
          onDMs={() => setPanel('dms')}
          onSettings={() => setPanel('settings')}
          panel={panel}
        />

        {/* ── Channel Sidebar ── */}
        {activeServer && panel !== 'settings' && panel !== 'dms' && (
          <ChannelSidebar
            server={activeServer} channels={channels}
            activeChannel={activeChannel}
            voiceParticipants={voiceParticipants}
            onlineStatus={onlineStatus}
            onSelect={loadChannel}
            socket={socket}
            user={user}
            onLogout={logout}
            onSettings={() => setPanel('settings')}
          />
        )}

        {/* ── DM Sidebar ── */}
        {panel === 'dms' && (
          <DMSidebar
            dmChannels={dmChannels} activeChannel={activeChannel}
            user={user} onSelect={loadChannel}
            onNewDM={async recipientId => {
              const d = await api('/dms/open', { method: 'POST', body: { recipientId } });
              setDmChannels(p => p.find(c => c._id === d.channel._id) ? p : [...p, d.channel]);
              loadChannel(d.channel);
            }}
            onLogout={logout}
          />
        )}

        {/* ── Main Area ── */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {panel === 'settings' ? (
            <SettingsPanel user={user} onClose={() => setPanel('chat')} />
          ) : activeChannel ? (
            <>
              <ChatPanel
                channel={activeChannel}
                messages={messages[activeChannel._id] || []}
                typingUsers={typingUsers[activeChannel._id] || {}}
                onSend={sendMessage}
                socket={socket}
                currentUser={user}
              />
              {/* Member list — server channels only */}
              {activeServer && (
                <MemberList
                  members={activeServer.members || []}
                  roles={activeServer.roles || []}
                  onlineStatus={onlineStatus}
                />
              )}
            </>
          ) : (
            <EmptyState />
          )}
        </div>
      </div>

      {/* ── Modals ── */}
      {modalOpen === 'create' && (
        <CreateServerModal
          onClose={() => setModalOpen(null)}
          onCreated={srv => { setServers(p => [...p, srv]); setModalOpen(null); loadServer(srv._id); }}
        />
      )}
      {modalOpen === 'join' && (
        <JoinServerModal
          onClose={() => setModalOpen(null)}
          onJoined={(srv, chs) => { setServers(p => [...p, srv]); setModalOpen(null); loadServer(srv._id); }}
        />
      )}
    </AuthCtx.Provider>
  );
}

// ─── Server Rail ─────────────────────────────────────────────────────────────
function ServerRail({ servers, activeServer, onSelect, onCreateServer, onJoinServer, onDMs, onSettings, panel }) {
  return (
    <div style={{ width: 66, background: C.bg0, borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '10px 0 14px', gap: 8, overflowY: 'auto', flexShrink: 0 }}>
      {/* Logo */}
      <div onClick={onDMs}
        style={{ width: 44, height: 44, borderRadius: 12, background: `linear-gradient(135deg,#1a4a7a,${C.accent})`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: `0 0 18px ${C.accentGlow}`, fontFamily: "'Orbitron', sans-serif", fontSize: 14, fontWeight: 900, color: '#fff', letterSpacing: 1, flexShrink: 0 }}>
        SC
      </div>

      <div style={{ width: 28, height: 1, background: C.border }} />

      {/* Server icons */}
      {servers.map(srv => {
        const active = activeServer?._id === srv._id;
        return (
          <div key={srv._id} title={srv.name} onClick={() => onSelect(srv._id)} className="sc-srv"
            style={{ width: 44, height: 44, borderRadius: active ? 14 : '50%', background: active ? C.accentDim : 'rgba(255,255,255,0.06)', border: `1px solid ${active ? C.accent : 'transparent'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all 0.15s', boxShadow: active ? `0 0 14px ${C.accentGlow}` : 'none', fontSize: 18, flexShrink: 0, overflow: 'hidden' }}>
            {srv.icon
              ? <img src={srv.icon} style={{ width: 44, height: 44, objectFit: 'cover' }} alt={srv.name} />
              : <span style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 15, fontWeight: 700, color: active ? C.accent : C.text1 }}>{srv.name[0]}</span>
            }
          </div>
        );
      })}

      <div style={{ width: 28, height: 1, background: C.border }} />

      {/* Add */}
      <RailBtn onClick={onCreateServer} title="Create Station" color={C.green}>+</RailBtn>
      {/* Join */}
      <RailBtn onClick={onJoinServer} title="Join Station" color={C.accent}>⊞</RailBtn>

      <div style={{ flex: 1 }} />

      {/* Settings */}
      <RailBtn onClick={onSettings} title="Settings" color={C.text1}>⚙</RailBtn>
    </div>
  );
}

function RailBtn({ onClick, title, color, children }) {
  return (
    <div onClick={onClick} title={title} className="sc-srv"
      style={{ width: 44, height: 44, borderRadius: '50%', background: `${color}14`, border: `1px solid ${color}33`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color, fontSize: 18, transition: 'all 0.15s', flexShrink: 0 }}>
      {children}
    </div>
  );
}

// ─── Channel Sidebar ──────────────────────────────────────────────────────────
function ChannelSidebar({ server, channels, activeChannel, voiceParticipants, onlineStatus, onSelect, socket, user, onLogout, onSettings }) {
  const [expandedCats, setExpandedCats] = useState(new Set(['uncategorized']));

  const toggleCat = id => setExpandedCats(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const channelIcon = ch => ch.type === 'voice' || ch.type === 'stage' ? <Icon.Vol /> : ch.type === 'announcement' ? <Icon.Mega /> : <Icon.Hash />;

  return (
    <div style={{ width: 228, background: C.bg1, borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 }}>
      {/* Server Header */}
      <div style={{ padding: '14px 16px', borderBottom: `1px solid ${C.border}`, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 13, fontWeight: 700, color: C.text0, letterSpacing: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{server.name}</div>
          <div style={{ color: C.accent, fontSize: 9, letterSpacing: 3, opacity: 0.6, marginTop: 2 }}>{server.members?.length || 0} OPERATIVES</div>
        </div>
        <div style={{ color: C.text3, fontSize: 14 }}>▾</div>
      </div>

      {/* Channels */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
        {/* Text channels */}
        <SectionHeader label="TEXT CHANNELS" />
        {channels.filter(c => ['text','announcement'].includes(c.type)).map(ch => (
          <ChannelRow key={ch._id} ch={ch} active={activeChannel?._id === ch._id} icon={channelIcon(ch)} onSelect={() => onSelect(ch)} />
        ))}

        {/* Voice channels */}
        <SectionHeader label="VOICE CHANNELS" style={{ marginTop: 8 }} />
        {channels.filter(c => ['voice','stage'].includes(c.type)).map(ch => (
          <div key={ch._id}>
            <ChannelRow ch={ch} active={activeChannel?._id === ch._id} icon={channelIcon(ch)} onSelect={() => socket?.emit('join_voice', ch._id)} />
            {/* Voice participants */}
            {(voiceParticipants[ch._id] || []).map(p => (
              <div key={p.userId} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 8px 3px 38px', color: C.green, fontSize: 11 }}>
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: C.green, animation: 'pulse 2s ease-in-out infinite' }} />
                {p.username}{p.muted ? ' 🔇' : ''}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* User Panel */}
      <div style={{ padding: '10px 12px', borderTop: `1px solid ${C.border}`, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <Avatar user={{ ...user, status: onlineStatus[user._id] || user.status }} size={32} showStatus />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: C.text0, fontSize: 13, fontWeight: 600, letterSpacing: 0.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.displayName || user.username}</div>
          <div style={{ color: C.text2, fontSize: 10, letterSpacing: 1 }}>#{user.username}</div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <TinyBtn onClick={onSettings} title="Settings">⚙</TinyBtn>
          <TinyBtn onClick={onLogout} title="Disconnect">⏻</TinyBtn>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ label, style: s }) {
  return <div style={{ padding: '10px 16px 4px', color: C.text3, fontSize: 10, letterSpacing: 3, fontWeight: 700, fontFamily: "'Share Tech Mono', monospace", ...s }}>{label}</div>;
}

function ChannelRow({ ch, active, icon, onSelect }) {
  return (
    <div onClick={onSelect} className="sc-ch"
      style={{ padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', background: active ? C.accentDim : 'transparent', borderLeft: `2px solid ${active ? C.accent : 'transparent'}`, marginLeft: 4, borderRadius: '0 5px 5px 0', transition: 'all 0.12s' }}>
      <span style={{ flexShrink: 0, opacity: active ? 1 : 0.5 }}>{icon}</span>
      <span style={{ color: active ? C.text0 : C.text1, fontSize: 13, fontWeight: active ? 600 : 400, letterSpacing: 0.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.name}</span>
    </div>
  );
}

function TinyBtn({ onClick, title, children }) {
  return (
    <button onClick={onClick} title={title} style={{ background: 'none', border: 'none', color: C.text2, cursor: 'pointer', fontSize: 14, padding: '4px 6px', borderRadius: 4, transition: 'color 0.15s', lineHeight: 1 }}
      onMouseEnter={e => e.currentTarget.style.color = C.text0}
      onMouseLeave={e => e.currentTarget.style.color = C.text2}>
      {children}
    </button>
  );
}

// ─── DM Sidebar ──────────────────────────────────────────────────────────────
function DMSidebar({ dmChannels, activeChannel, user, onSelect, onNewDM, onLogout }) {
  const [recipientInput, setRecipientInput] = useState('');

  async function openDM(e) {
    e.preventDefault();
    if (!recipientInput.trim()) return;
    try {
      const found = await api(`/users/search?q=${recipientInput}`).catch(() => null);
      // Simplified: use a prompt for userId in demo
      const id = prompt('Enter recipient user ID:');
      if (id) { await onNewDM(id); setRecipientInput(''); }
    } catch (err) { alert(err.message); }
  }

  return (
    <div style={{ width: 228, background: C.bg1, borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 }}>
      <div style={{ padding: '14px 16px', borderBottom: `1px solid ${C.border}`, background: 'rgba(0,0,0,0.3)', flexShrink: 0 }}>
        <div style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 12, color: C.accent, letterSpacing: 2 }}>DIRECT COMMS</div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {dmChannels.map(ch => {
          const other = ch.participants?.find(p => p._id !== user._id || p !== user._id) || ch.participants?.[0];
          return (
            <div key={ch._id} onClick={() => onSelect(ch)} className="sc-ch"
              style={{ padding: '7px 14px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', background: activeChannel?._id === ch._id ? C.accentDim : 'transparent', transition: 'all 0.12s' }}>
              {other?._id ? <Avatar user={other} size={28} showStatus /> : <div style={{ width: 28, height: 28, borderRadius: '50%', background: C.bg4 }} />}
              <span style={{ color: C.text1, fontSize: 13 }}>{other?.displayName || other?.username || 'DM'}</span>
            </div>
          );
        })}
      </div>
      <div style={{ padding: '10px 12px', borderTop: `1px solid ${C.border}`, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <Avatar user={user} size={32} showStatus />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: C.text0, fontSize: 13, fontWeight: 600 }}>{user.displayName || user.username}</div>
          <div style={{ color: C.text2, fontSize: 10 }}>#{user.username}</div>
        </div>
        <TinyBtn onClick={onLogout} title="Logout">⏻</TinyBtn>
      </div>
    </div>
  );
}

// ─── Member List ──────────────────────────────────────────────────────────────
function MemberList({ members, roles, onlineStatus }) {
  const online  = members.filter(m => ['online','idle','dnd'].includes(onlineStatus[m.user?._id] || m.user?.status));
  const offline = members.filter(m => !['online','idle','dnd'].includes(onlineStatus[m.user?._id] || m.user?.status));

  const MemberRow = ({ m }) => {
    const u = m.user;
    if (!u) return null;
    const status = onlineStatus[u._id] || u.status || 'offline';
    return (
      <div className="sc-hover" style={{ padding: '5px 14px', display: 'flex', alignItems: 'center', gap: 10, borderRadius: 5, margin: '1px 6px', transition: 'background 0.1s' }}>
        <Avatar user={{ ...u, status }} size={28} showStatus />
        <div style={{ minWidth: 0 }}>
          <div style={{ color: C.text0, fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.displayName || u.username}</div>
          {u.clearance > 1 && <CLBadge level={u.clearance} />}
        </div>
      </div>
    );
  };

  return (
    <div style={{ width: 210, background: C.bg1, borderLeft: `1px solid ${C.border}`, overflowY: 'auto', padding: '14px 0', flexShrink: 0 }}>
      {online.length > 0 && (
        <>
          <SectionHeader label={`ONLINE — ${online.length}`} />
          {online.map((m, i) => <MemberRow key={i} m={m} />)}
        </>
      )}
      {offline.length > 0 && (
        <>
          <SectionHeader label={`OFFLINE — ${offline.length}`} style={{ marginTop: 12 }} />
          {offline.map((m, i) => <MemberRow key={i} m={m} />)}
        </>
      )}
    </div>
  );
}

// ─── Chat Panel ───────────────────────────────────────────────────────────────
function ChatPanel({ channel, messages, typingUsers, onSend, socket, currentUser }) {
  const [input,     setInput]    = useState('');
  const [replyTo,   setReplyTo]  = useState(null);
  const [isTyping,  setIsTyping] = useState(false);
  const typingRef = useRef(null);
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => { setInput(''); setReplyTo(null); inputRef.current?.focus(); }, [channel._id]);

  function handleInput(e) {
    setInput(e.target.value);
    if (!isTyping) { setIsTyping(true); socket?.emit('typing_start', channel._id); }
    clearTimeout(typingRef.current);
    typingRef.current = setTimeout(() => { setIsTyping(false); socket?.emit('typing_stop', channel._id); }, 2500);
  }

  function handleSend(e) {
    e.preventDefault();
    if (!input.trim()) return;
    onSend(input, replyTo?._id);
    setInput(''); setReplyTo(null);
    setIsTyping(false); socket?.emit('typing_stop', channel._id);
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(e); }
    if (e.key === 'Escape' && replyTo) setReplyTo(null);
  }

  const typers = Object.values(typingUsers).filter(Boolean);

  const chIcon = channel.type === 'announcement' ? '📢 ' : channel.type === 'voice' ? '🔊 ' : '# ';

  // Group messages into consecutive same-author blocks
  const grouped = messages.reduce((acc, msg, i) => {
    const prev = messages[i - 1];
    const isFirst = !prev || prev.author?._id !== msg.author?._id || (new Date(msg.createdAt) - new Date(prev.createdAt) > 5 * 60 * 1000);
    acc.push({ msg, isFirst });
    return acc;
  }, []);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: C.bg1 }}>
      {/* Channel Header */}
      <div style={{ padding: '0 20px', height: 50, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(0,0,0,0.25)', flexShrink: 0 }}>
        <span style={{ color: C.text2, fontSize: 18 }}>{chIcon[0]}</span>
        <span style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 13, fontWeight: 700, color: C.text0, letterSpacing: 1 }}>{channel.name}</span>
        {channel.topic && (
          <>
            <div style={{ width: 1, height: 20, background: C.border }} />
            <span style={{ color: C.text2, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{channel.topic}</span>
          </>
        )}
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 0 8px' }}>
        {messages.length === 0 && (
          <div style={{ padding: '0 20px 28px' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>#</div>
            <div style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 20, color: C.text0, marginBottom: 6 }}>{channel.name}</div>
            <div style={{ color: C.text2, fontSize: 13 }}>Channel initialized. Begin transmission.</div>
          </div>
        )}
        {grouped.map(({ msg, isFirst }, i) => (
          <MessageRow
            key={msg._id || i}
            message={msg}
            isFirst={isFirst}
            currentUser={currentUser}
            socket={socket}
            onReply={setReplyTo}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Typing indicator */}
      {typers.length > 0 && (
        <div style={{ padding: '0 20px 4px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 3 }}>
            {[0,1,2].map(i => (
              <div key={i} style={{ width: 4, height: 4, borderRadius: '50%', background: C.text2, animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite` }} />
            ))}
          </div>
          <span style={{ color: C.text2, fontSize: 12 }}>
            <strong style={{ color: C.text1 }}>{typers.join(', ')}</strong> {typers.length === 1 ? 'is' : 'are'} transmitting...
          </span>
        </div>
      )}

      {/* Reply indicator */}
      {replyTo && (
        <div style={{ padding: '8px 20px', background: C.bg2, borderTop: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span style={{ color: C.text2, fontSize: 12 }}>↩ Replying to <strong style={{ color: C.accent }}>{replyTo.author?.displayName || replyTo.author?.username}</strong></span>
          <span style={{ color: C.text2, fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.6 }}>{replyTo.content}</span>
          <button onClick={() => setReplyTo(null)} style={{ background: 'none', border: 'none', color: C.text2, cursor: 'pointer', fontSize: 16 }}>✕</button>
        </div>
      )}

      {/* Input */}
      <div style={{ padding: '12px 18px 16px', flexShrink: 0 }}>
        <form onSubmit={handleSend}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 16px', transition: 'border-color 0.18s' }}
            onFocus={e => e.currentTarget.style.borderColor = C.accent}
            onBlur={e => e.currentTarget.style.borderColor = C.border}>
            <span style={{ color: C.accent, opacity: 0.4, fontSize: 18 }}>+</span>
            <input
              ref={inputRef}
              value={input}
              onChange={handleInput}
              onKeyDown={handleKey}
              placeholder={`Transmit to ${chIcon.trim()} ${channel.name}`}
              style={{ flex: 1, background: 'none', border: 'none', color: C.text0, fontSize: 14, outline: 'none', fontFamily: "'Rajdhani', sans-serif", letterSpacing: 0.3 }}
            />
            <button type="submit" disabled={!input.trim()}
              style={{ background: input.trim() ? C.accentDim : 'transparent', border: `1px solid ${input.trim() ? C.accent : 'transparent'}`, borderRadius: 5, color: input.trim() ? C.accent : C.text3, padding: '4px 12px', cursor: 'pointer', fontFamily: "'Orbitron', sans-serif", fontSize: 10, letterSpacing: 2, transition: 'all 0.15s' }}>
              SEND
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Message Row ──────────────────────────────────────────────────────────────
function MessageRow({ message, isFirst, currentUser, socket, onReply }) {
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState(message.content);
  const isOwn = message.author?._id === currentUser?._id;

  function saveEdit() {
    if (editVal.trim() && editVal !== message.content) {
      socket?.emit('edit_message', { messageId: message._id, content: editVal });
    }
    setEditing(false);
  }

  function doDelete() {
    if (confirm('Delete this message?')) socket?.emit('delete_message', { messageId: message._id });
  }

  const author = message.author || {};

  return (
    <div className="msg-row"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ display: 'flex', gap: 14, padding: isFirst ? '14px 20px 2px' : '2px 20px', alignItems: 'flex-start', animation: 'fadeIn 0.18s ease', position: 'relative', transition: 'background 0.1s' }}>

      {/* Avatar or spacer */}
      {isFirst
        ? <Avatar user={author} size={36} style={{ marginTop: 2 }} />
        : <div style={{ width: 36, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {hovered && <span style={{ color: C.text3, fontSize: 10, fontFamily: "'Share Tech Mono', monospace", letterSpacing: 0.5 }}>{timeStr(message.createdAt)}</span>}
          </div>
      }

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Reply reference */}
        {message.replyTo && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, opacity: 0.6 }}>
            <div style={{ width: 24, height: 10, borderTop: `1px solid ${C.text3}`, borderLeft: `1px solid ${C.text3}`, borderRadius: '3px 0 0 0', marginTop: 5, flexShrink: 0 }} />
            <span style={{ color: C.accent, fontSize: 11 }}>{message.replyTo.author?.username}</span>
            <span style={{ color: C.text2, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{message.replyTo.content}</span>
          </div>
        )}

        {/* Author line */}
        {isFirst && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
            <span style={{ color: C.text0, fontSize: 14, fontWeight: 600, letterSpacing: 0.3 }}>{author.displayName || author.username}</span>
            {author.clearance > 1 && <CLBadge level={author.clearance} />}
            <span style={{ color: C.text3, fontSize: 11, fontFamily: "'Share Tech Mono', monospace" }}>{timeStr(message.createdAt)}</span>
            {message.edited && <span style={{ color: C.text3, fontSize: 10, letterSpacing: 1 }}>(edited)</span>}
          </div>
        )}

        {/* Content */}
        {editing ? (
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <input value={editVal} onChange={e => setEditVal(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditing(false); }}
              style={{ flex: 1, background: C.bg3, border: `1px solid ${C.accent}`, borderRadius: 5, color: C.text0, padding: '6px 10px', fontFamily: "'Rajdhani', sans-serif", fontSize: 14, outline: 'none' }} autoFocus />
            <button onClick={saveEdit} style={{ background: C.accentDim, border: `1px solid ${C.accent}`, borderRadius: 4, color: C.accent, padding: '4px 10px', cursor: 'pointer', fontSize: 11, fontFamily: "'Orbitron', sans-serif" }}>SAVE</button>
            <button onClick={() => setEditing(false)} style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 4, color: C.text2, padding: '4px 10px', cursor: 'pointer', fontSize: 11, fontFamily: "'Orbitron', sans-serif" }}>ESC</button>
          </div>
        ) : (
          <div style={{ color: C.text1, fontSize: 14, lineHeight: 1.55, wordBreak: 'break-word', fontFamily: "'Rajdhani', sans-serif", letterSpacing: 0.2 }}>
            {message.content}
          </div>
        )}

        {/* Reactions */}
        {message.reactions?.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 5 }}>
            {message.reactions.map((r, i) => (
              <div key={i} onClick={() => socket?.emit('add_reaction', { messageId: message._id, emoji: r.emoji })}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', background: `${C.accent}14`, border: `1px solid ${C.accent}33`, borderRadius: 12, cursor: 'pointer', fontSize: 13, transition: 'all 0.12s' }}
                onMouseEnter={e => { e.currentTarget.style.background = `${C.accent}25`; }}
                onMouseLeave={e => { e.currentTarget.style.background = `${C.accent}14`; }}>
                <span>{r.emoji}</span>
                <span style={{ color: C.accent, fontSize: 11, fontWeight: 700 }}>{r.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Message action bar */}
      <div className="msg-actions"
        style={{ opacity: 0, position: 'absolute', right: 20, top: isFirst ? 14 : 2, display: 'flex', gap: 2, background: C.bg3, border: `1px solid ${C.border}`, borderRadius: 7, padding: '3px 5px', transition: 'opacity 0.15s' }}>
        {['👍','🔥','⚡','✅'].map(emoji => (
          <button key={emoji} className="emoji-btn" onClick={() => socket?.emit('add_reaction', { messageId: message._id, emoji })}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, padding: '2px 5px', borderRadius: 4, transition: 'background 0.1s' }}>{emoji}</button>
        ))}
        <button onClick={() => onReply(message)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.text2, fontSize: 12, padding: '2px 7px', borderRadius: 4, letterSpacing: 0.5 }}>↩</button>
        {isOwn && (
          <>
            <button onClick={() => setEditing(true)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.text2, fontSize: 12, padding: '2px 7px', borderRadius: 4 }}>✎</button>
            <button onClick={doDelete}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.red, fontSize: 13, padding: '2px 7px', borderRadius: 4 }}>✕</button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Settings Panel ───────────────────────────────────────────────────────────
function SettingsPanel({ user, onClose }) {
  const [activeTab, setActiveTab] = useState('account');
  const tabs = [
    { id: 'account',    label: 'MY ACCOUNT' },
    { id: 'profile',    label: 'PROFILE' },
    { id: 'privacy',    label: 'PRIVACY' },
    { id: 'appearance', label: 'APPEARANCE' },
    { id: 'about',      label: 'ABOUT SATCORP' },
  ];

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      {/* Settings nav */}
      <div style={{ width: 226, background: C.bg2, padding: '20px 8px', borderRight: `1px solid ${C.border}`, overflowY: 'auto' }}>
        <div style={{ color: C.text3, fontSize: 10, letterSpacing: 3, padding: '8px 12px 12px', fontFamily: "'Share Tech Mono', monospace" }}>USER SETTINGS</div>
        {tabs.map(t => (
          <div key={t.id} onClick={() => setActiveTab(t.id)} className="sc-hover"
            style={{ padding: '9px 14px', borderRadius: 5, color: activeTab === t.id ? C.text0 : C.text2, background: activeTab === t.id ? C.accentDim : 'transparent', fontSize: 13, fontWeight: activeTab === t.id ? 600 : 400, cursor: 'pointer', marginBottom: 2, letterSpacing: 0.5, transition: 'all 0.12s' }}>
            {t.label}
          </div>
        ))}
        <div style={{ height: 1, background: C.border, margin: '12px 8px' }} />
        <div onClick={onClose} className="sc-hover"
          style={{ padding: '9px 14px', borderRadius: 5, color: C.red, fontSize: 13, cursor: 'pointer', letterSpacing: 0.5 }}>
          ✕ CLOSE SETTINGS
        </div>
      </div>

      {/* Settings content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '32px 40px', background: C.bg1 }}>
        {activeTab === 'account' && <AccountTab user={user} />}
        {activeTab === 'profile' && <ProfileTab user={user} />}
        {activeTab === 'about' && <AboutTab />}
        {(activeTab === 'privacy' || activeTab === 'appearance') && (
          <div style={{ color: C.text2, fontSize: 14 }}>Settings for <strong style={{ color: C.accent }}>{activeTab}</strong> will be available in a future update.</div>
        )}
      </div>
    </div>
  );
}

function AccountTab({ user }) {
  return (
    <div>
      <div style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 16, fontWeight: 700, color: C.accent, letterSpacing: 2, marginBottom: 28 }}>MY ACCOUNT</div>

      {/* Profile card */}
      <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden', marginBottom: 28 }}>
        {/* Banner */}
        <div style={{ height: 90, background: `linear-gradient(135deg, #1a2a4a 0%, #0d1a2e 100%)`, position: 'relative' }}>
          <div style={{ position: 'absolute', inset: 0, backgroundImage: `repeating-linear-gradient(45deg, ${C.border} 0, ${C.border} 1px, transparent 0, transparent 50%)`, backgroundSize: '18px 18px' }} />
        </div>
        <div style={{ padding: '0 24px 24px', position: 'relative' }}>
          <div style={{ marginTop: -26, marginBottom: 14 }}>
            <Avatar user={user} size={68} showStatus />
          </div>
          <div style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 18, color: C.text0 }}>{user.displayName || user.username}</div>
          <div style={{ color: C.text2, fontSize: 12, marginTop: 4, letterSpacing: 1 }}>#{user.username}</div>
          {user.bio && <div style={{ color: C.text1, fontSize: 13, marginTop: 10, lineHeight: 1.5 }}>{user.bio}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <CLBadge level={user.clearance || 1} />
            <span style={{ background: `${C.accent}14`, color: C.accent, border: `1px solid ${C.accent}33`, fontSize: 9, padding: '1px 8px', borderRadius: 3, letterSpacing: 2, fontFamily: "'Share Tech Mono', monospace" }}>{(user.role || 'operative').toUpperCase()}</span>
            {user.division && <span style={{ background: 'rgba(255,255,255,0.05)', color: C.text1, border: `1px solid ${C.border}`, fontSize: 9, padding: '1px 8px', borderRadius: 3, letterSpacing: 1, fontFamily: "'Share Tech Mono', monospace" }}>{user.division.toUpperCase()}</span>}
          </div>
        </div>
      </div>

      {/* Info grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {[
          ['USERNAME', user.username],
          ['EMAIL', user.email],
          ['CLEARANCE LEVEL', `Level ${user.clearance || 1}`],
          ['DIVISION', user.division || 'General Operations'],
          ['ROLE', (user.role || 'user').toUpperCase()],
          ['MEMBER SINCE', dateStr(user.createdAt)],
        ].map(([k, v]) => (
          <div key={k} style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 7, padding: '14px 16px' }}>
            <div style={{ color: C.accent, fontSize: 9, letterSpacing: 3, marginBottom: 7, fontFamily: "'Share Tech Mono', monospace", opacity: 0.8 }}>{k}</div>
            <div style={{ color: C.text0, fontSize: 14, fontWeight: 500 }}>{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProfileTab({ user }) {
  const [form, setForm] = useState({ displayName: user.displayName || '', bio: user.bio || '', customStatus: user.customStatus || '', division: user.division || '' });
  const [saved, setSaved] = useState(false);

  async function save(e) {
    e.preventDefault();
    await api('/users/me', { method: 'PATCH', body: form });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <div style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 16, fontWeight: 700, color: C.accent, letterSpacing: 2, marginBottom: 28 }}>EDIT PROFILE</div>
      <form onSubmit={save}>
        <Field label="DISPLAY NAME" value={form.displayName} onChange={v => setForm(f => ({...f, displayName: v}))} placeholder="Your display name" />
        <Field label="DIVISION" value={form.division} onChange={v => setForm(f => ({...f, division: v}))} placeholder="e.g. Orbital Engineering" />
        <Field label="CUSTOM STATUS" value={form.customStatus} onChange={v => setForm(f => ({...f, customStatus: v}))} placeholder="What are you working on?" />
        <div style={{ marginBottom: 18 }}>
          <label style={{ display: 'block', color: C.accent, fontSize: 10, letterSpacing: 3, marginBottom: 7, opacity: 0.8 }}>BIO</label>
          <textarea value={form.bio} onChange={e => setForm(f => ({...f, bio: e.target.value}))} rows={3} placeholder="Tell your team about yourself..."
            style={{ width: '100%', padding: '10px 14px', background: C.bg3, border: `1px solid ${C.border}`, borderRadius: 5, color: C.text0, fontFamily: "'Rajdhani', sans-serif", fontSize: 14, outline: 'none', resize: 'vertical' }} />
        </div>
        <Btn type="submit">{saved ? '✓ PROFILE SAVED' : 'SAVE CHANGES'}</Btn>
      </form>
    </div>
  );
}

function AboutTab() {
  return (
    <div>
      <div style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 16, fontWeight: 700, color: C.accent, letterSpacing: 2, marginBottom: 28 }}>ABOUT SATCORP</div>
      {[
        ['PLATFORM', 'SatCorp Communications Network v1.0'],
        ['TECHNOLOGY', 'React 18 · Node.js · Socket.io · MongoDB'],
        ['ENCRYPTION', 'JWT / bcrypt-12 · HTTPS enforced in production'],
        ['REAL-TIME', 'WebSocket via Socket.io · WebRTC P2P voice'],
        ['UPTIME', 'Systems nominal'],
      ].map(([k, v]) => (
        <div key={k} style={{ display: 'flex', gap: 20, padding: '12px 0', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ width: 160, color: C.text2, fontSize: 11, letterSpacing: 2, fontFamily: "'Share Tech Mono', monospace", flexShrink: 0 }}>{k}</div>
          <div style={{ color: C.text1, fontSize: 13 }}>{v}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────
function EmptyState() {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, background: C.bg1 }}>
      <div style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 52, color: C.bg3, letterSpacing: 4 }}>SATCORP</div>
      <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 11, color: C.text3, letterSpacing: 6 }}>SELECT A CHANNEL TO BEGIN</div>
    </div>
  );
}

// ─── Create Server Modal ──────────────────────────────────────────────────────
function CreateServerModal({ onClose, onCreated }) {
  const [name, setName]   = useState('');
  const [desc, setDesc]   = useState('');
  const [pub,  setPub]    = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault(); setLoading(true);
    try {
      const d = await api('/servers', { method: 'POST', body: { name, description: desc, isPublic: pub } });
      onCreated(d.server);
    } catch (err) { alert(err.message); }
    finally { setLoading(false); }
  }

  return (
    <Modal title="ESTABLISH STATION" subtitle="CREATE A NEW COMMUNICATIONS SERVER" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="STATION NAME" value={name} onChange={setName} placeholder="e.g. Alpha Squadron" required />
        <Field label="DESCRIPTION" value={desc} onChange={setDesc} placeholder="What is this station's purpose?" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <input type="checkbox" id="pub" checked={pub} onChange={e => setPub(e.target.checked)} style={{ width: 16, height: 16, accentColor: C.accent }} />
          <label htmlFor="pub" style={{ color: C.text1, fontSize: 13, cursor: 'pointer' }}>Make station publicly discoverable</label>
        </div>
        <Btn type="submit" loading={loading}>ESTABLISH STATION</Btn>
      </form>
    </Modal>
  );
}

// ─── Join Server Modal ────────────────────────────────────────────────────────
function JoinServerModal({ onClose, onJoined }) {
  const [code, setCode]     = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault(); setLoading(true);
    try {
      const d = await api(`/servers/join/${code.trim().toUpperCase()}`, { method: 'POST' });
      onJoined(d.server, d.channels);
    } catch (err) { alert(err.message); }
    finally { setLoading(false); }
  }

  return (
    <Modal title="JOIN STATION" subtitle="ENTER AN INVITE CODE TO CONNECT" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="INVITE CODE" value={code} onChange={setCode} placeholder="e.g. A1B2C3D4" required hint="Ask the station commander for an invite code." />
        <Btn type="submit" loading={loading}>CONNECT TO STATION</Btn>
      </form>
    </Modal>
  );
}
