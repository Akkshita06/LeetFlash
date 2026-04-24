import { useState, useEffect, useCallback, useRef } from "react";
import {
  ChevronLeft, ChevronRight, RotateCcw, Plus, BookOpen, Zap,
  CheckCircle, Layers, Key, Eye, EyeOff, User, LogOut,
  Trophy, Flame, Target, BarChart2, X, Mail, Lock,
  ArrowRight, Star, TrendingUp, Calendar, Hash
} from "lucide-react";

// ─── Constants ────────────────────────────────────────────────────────────────

const COLORS = {
  Pattern:        { bg: "#f59e0b", text: "#0a0a0f" },
  Intuition:      { bg: "#3b82f6", text: "#fff" },
  Complexity:     { bg: "#10b981", text: "#0a0a0f" },
  "Edge Cases":   { bg: "#ef4444", text: "#fff" },
  "Code Trick":   { bg: "#8b5cf6", text: "#fff" },
  "Why It Works": { bg: "#ec4899", text: "#fff" },
};

const DIFFICULTY_COLORS = {
  Easy:   { bg: "#00b8a3", text: "#0a0a0f" },
  Medium: { bg: "#ffc01e", text: "#0a0a0f" },
  Hard:   { bg: "#ff375f", text: "#fff" },
};

const SYSTEM_PROMPT = `You are an expert DSA teacher creating spaced-repetition flashcards from LeetCode solutions. Analyze the given solution and generate 6-8 flashcards that help a student deeply understand and remember it.

Return ONLY a valid JSON array — no markdown, no explanation, no backticks.
Each object must have: id, category, question, answer, difficulty.

Categories to use: Pattern, Intuition, Complexity, Edge Cases, Code Trick, Why It Works.

Focus on:
- WHY this approach works, not just WHAT it does
- The core algorithmic pattern (sliding window, two pointer, DP, etc.)
- Time/space complexity with explanation
- Non-obvious edge cases
- The key insight that unlocks the solution
- Any clever code tricks used`;

// ─── Supabase Client (plug in your project URL + anon key) ───────────────────
// Replace these with your actual Supabase credentials
const SUPABASE_URL  = "https://YOUR_PROJECT.supabase.co";
const SUPABASE_ANON = "YOUR_ANON_KEY";

const supabase = {
  _headers() {
    const token = localStorage.getItem("lf_session_token");
    return {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON,
      "Authorization": `Bearer ${token || SUPABASE_ANON}`,
    };
  },
  async signUp(email, password) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON },
      body: JSON.stringify({ email, password }),
    });
    return r.json();
  },
  async signIn(email, password) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON },
      body: JSON.stringify({ email, password }),
    });
    const data = await r.json();
    if (data.access_token) {
      localStorage.setItem("lf_session_token", data.access_token);
      localStorage.setItem("lf_user", JSON.stringify(data.user));
    }
    return data;
  },
  signOut() {
    localStorage.removeItem("lf_session_token");
    localStorage.removeItem("lf_user");
  },
  getUser() {
    try { return JSON.parse(localStorage.getItem("lf_user")); } catch { return null; }
  },
  async getDecks(userId) {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/decks?user_id=eq.${userId}&order=created_at.desc`,
      { headers: this._headers() }
    );
    return r.json();
  },
  async saveDeck(deck) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/decks`, {
      method: "POST",
      headers: { ...this._headers(), "Prefer": "return=representation" },
      body: JSON.stringify(deck),
    });
    return r.json();
  },
  async updateDeck(id, patch) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/decks?id=eq.${id}`, {
      method: "PATCH",
      headers: { ...this._headers(), "Prefer": "return=representation" },
      body: JSON.stringify(patch),
    });
    return r.json();
  },
  async getProfile(userId) {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${userId}`,
      { headers: this._headers() }
    );
    const rows = await r.json();
    return rows[0] || null;
  },
  async upsertProfile(profile) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
      method: "POST",
      headers: { ...this._headers(), "Prefer": "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(profile),
    });
    return r.json();
  },
};

// Supabase DB schema (run this SQL in your Supabase dashboard):
/*
create table profiles (
  user_id uuid primary key references auth.users(id),
  username text,
  streak int default 0,
  last_active date,
  total_cards_reviewed int default 0,
  total_sessions int default 0,
  created_at timestamptz default now()
);

create table decks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  problem_name text,
  difficulty text,
  cards jsonb,
  ratings jsonb default '{}',
  created_at timestamptz default now()
);

alter table profiles enable row level security;
alter table decks enable row level security;

create policy "Users manage own profile" on profiles for all using (auth.uid() = user_id);
create policy "Users manage own decks" on decks for all using (auth.uid() = user_id);
*/

// ─── Local storage fallback ───────────────────────────────────────────────────

const localDB = {
  getDecks() {
    try { return JSON.parse(localStorage.getItem("lf_decks") || "[]"); } catch { return []; }
  },
  saveDecks(decks) {
    localStorage.setItem("lf_decks", JSON.stringify(decks));
  },
};

// ─── API ──────────────────────────────────────────────────────────────────────

async function callClaude(apiKey, code, problemName, difficulty) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Problem: ${problemName || "Unknown"}\nDifficulty: ${difficulty || "Unknown"}\n\nSolution:\n${code}` }],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `API error ${res.status}`);
  }
  const data = await res.json();
  const text = data.content.map((b) => b.text || "").join("");
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

// ─── Global Styles ────────────────────────────────────────────────────────────

const GLOBAL_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Space+Mono:ital,wght@0,400;0,700;1,400&family=Outfit:wght@300;400;500;600;700;800;900&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:        #050508;
    --bg2:       #0c0c14;
    --bg3:       #12121e;
    --border:    #1c1c2e;
    --border2:   #262640;
    --text:      #e4e4f0;
    --muted:     #5a5a80;
    --accent:    #6366f1;
    --accent2:   #8b5cf6;
    --accent3:   #a78bfa;
    --green:     #22c55e;
    --red:       #ef4444;
    --yellow:    #f59e0b;
    --font-ui:   'Outfit', sans-serif;
    --font-mono: 'Space Mono', monospace;
  }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-ui);
    min-height: 100vh;
    overflow-x: hidden;
  }

  ::selection { background: #6366f140; color: var(--text); }

  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 4px; }

  input, textarea, button { font-family: var(--font-ui); }

  input, textarea {
    font-size: 14px;
    background: var(--bg2);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 10px;
    padding: 10px 14px;
    transition: border 0.2s, box-shadow 0.2s;
    outline: none;
    width: 100%;
  }
  input:focus, textarea:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px #6366f118;
  }
  input::placeholder, textarea::placeholder { color: var(--muted); }

  button { cursor: pointer; border: none; outline: none; }

  /* Card flip */
  .card-scene { perspective: 1400px; }
  .card-inner {
    position: relative; width: 100%; height: 100%;
    transition: transform 0.55s cubic-bezier(0.4,0,0.2,1);
    transform-style: preserve-3d;
  }
  .card-inner.flipped { transform: rotateY(180deg); }
  .card-face {
    position: absolute; inset: 0;
    backface-visibility: hidden;
    -webkit-backface-visibility: hidden;
    border-radius: 20px;
    overflow: hidden;
  }
  .card-back { transform: rotateY(180deg); }

  /* Animations */
  @keyframes slideUp   { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
  @keyframes fadeIn    { from { opacity:0; } to { opacity:1; } }
  @keyframes pulse     { 0%,100%{opacity:1;} 50%{opacity:0.4;} }
  @keyframes shimmer   { 0%{background-position:-200% 0;} 100%{background-position:200% 0;} }
  @keyframes spin      { to { transform: rotate(360deg); } }
  @keyframes glow      { 0%,100%{box-shadow:0 0 20px #6366f130;} 50%{box-shadow:0 0 40px #6366f160;} }
  @keyframes slideRight { from{opacity:0;transform:translateX(32px);} to{opacity:1;transform:translateX(0);} }
  @keyframes slideLeft  { from{opacity:0;transform:translateX(-32px);} to{opacity:1;transform:translateX(0);} }
  @keyframes countUp   { from{transform:translateY(10px);opacity:0;} to{transform:translateY(0);opacity:1;} }

  .anim-up    { animation: slideUp 0.4s ease both; }
  .slide-r    { animation: slideRight 0.3s ease both; }
  .slide-l    { animation: slideLeft  0.3s ease both; }

  .skeleton {
    background: linear-gradient(90deg, var(--bg2) 25%, var(--bg3) 50%, var(--bg2) 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
    border-radius: 10px;
  }

  /* Noise texture overlay */
  .noise::after {
    content:''; position:absolute; inset:0; pointer-events:none; border-radius: inherit;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.025'/%3E%3C/svg%3E");
    border-radius: inherit;
  }

  /* Grid background */
  .grid-bg {
    background-image:
      linear-gradient(var(--border) 1px, transparent 1px),
      linear-gradient(90deg, var(--border) 1px, transparent 1px);
    background-size: 40px 40px;
    background-position: center center;
  }

  /* Glow orbs */
  .orb {
    position: fixed; border-radius: 50%; filter: blur(80px); pointer-events: none; opacity: 0.12;
  }

  /* Modal */
  .modal-overlay {
    position: fixed; inset: 0; background: #00000090; backdrop-filter: blur(8px);
    display: flex; align-items: center; justify-content: center;
    z-index: 200; padding: 20px; animation: fadeIn 0.2s ease;
  }
  .modal {
    background: var(--bg2); border: 1px solid var(--border2);
    border-radius: 20px; padding: 32px; width: 100%; max-width: 400px;
    animation: slideUp 0.3s ease;
  }

  /* Nav */
  .nav {
    position: sticky; top: 0; z-index: 100;
    height: 58px;
    background: #050508e8;
    backdrop-filter: blur(16px);
    border-bottom: 1px solid var(--border);
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 24px;
  }

  /* Btn variants */
  .btn {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 10px 20px; border-radius: 10px;
    font-family: var(--font-ui); font-size: 14px; font-weight: 600;
    transition: all 0.15s;
  }
  .btn-primary {
    background: linear-gradient(135deg, var(--accent), var(--accent2));
    color: #fff;
    box-shadow: 0 4px 16px #6366f128;
  }
  .btn-primary:hover { opacity: 0.9; transform: translateY(-1px); box-shadow: 0 8px 24px #6366f140; }
  .btn-primary:active { transform: translateY(0); }
  .btn-ghost {
    background: transparent; border: 1px solid var(--border);
    color: var(--muted);
  }
  .btn-ghost:hover { border-color: var(--border2); color: var(--text); }
  .btn-danger { background: #ef444418; border: 1px solid #ef444430; color: var(--red); }
  .btn-danger:hover { background: #ef444428; }

  /* Card hover */
  .deck-card {
    background: var(--bg2); border: 1px solid var(--border);
    border-radius: 16px; padding: 20px;
    cursor: pointer; transition: all 0.2s;
    position: relative; overflow: hidden;
  }
  .deck-card:hover { border-color: var(--border2); transform: translateY(-3px); box-shadow: 0 12px 32px #00000050; }
  .deck-card::before {
    content: ''; position: absolute; inset: 0;
    background: linear-gradient(135deg, #6366f108, transparent);
    opacity: 0; transition: opacity 0.2s;
    border-radius: 16px;
  }
  .deck-card:hover::before { opacity: 1; }

  /* Stat card */
  .stat-card {
    background: var(--bg2); border: 1px solid var(--border);
    border-radius: 14px; padding: 20px;
  }

  /* Tab */
  .tab { padding: 8px 20px; border-radius: 8px; font-size: 14px; font-weight: 600; transition: all 0.15s; cursor: pointer; border: none; }
  .tab-active { background: var(--bg3); color: var(--text); border: 1px solid var(--border2); }
  .tab-inactive { background: transparent; color: var(--muted); }
  .tab-inactive:hover { color: var(--text); }

  /* Toast */
  .toast {
    position: fixed; bottom: 24px; right: 24px; z-index: 999;
    background: var(--bg3); border: 1px solid var(--border2);
    border-radius: 12px; padding: 14px 20px;
    font-size: 14px; font-weight: 500;
    display: flex; align-items: center; gap: 10px;
    animation: slideUp 0.3s ease;
    box-shadow: 0 8px 32px #00000080;
  }
`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function CategoryBadge({ category, small }) {
  const c = COLORS[category] || { bg: "#6b7280", text: "#fff" };
  return (
    <span style={{
      background: c.bg + "22", color: c.bg,
      border: `1px solid ${c.bg}44`,
      fontSize: small ? 10 : 11, fontWeight: 700,
      letterSpacing: "0.08em", padding: small ? "2px 8px" : "3px 10px",
      borderRadius: 99, textTransform: "uppercase",
      display: "inline-block", whiteSpace: "nowrap",
      fontFamily: "var(--font-mono)",
    }}>
      {category}
    </span>
  );
}

function ProgressBar({ current, total, color = "var(--accent)" }) {
  const pct = total ? (current / total) * 100 : 0;
  return (
    <div style={{ width: "100%", height: 3, background: "var(--border)", borderRadius: 99 }}>
      <div style={{
        height: "100%", width: `${pct}%`,
        background: `linear-gradient(90deg, ${color}, var(--accent2))`,
        borderRadius: 99, transition: "width 0.5s cubic-bezier(0.4,0,0.2,1)",
      }} />
    </div>
  );
}

function Toast({ message, type = "success", onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t); }, []);
  const colors = { success: "#22c55e", error: "#ef4444", info: "#6366f1" };
  return (
    <div className="toast">
      <div style={{ width: 8, height: 8, borderRadius: "50%", background: colors[type], flexShrink: 0 }} />
      {message}
    </div>
  );
}

function Spinner() {
  return (
    <div style={{
      width: 18, height: 18, border: "2px solid #ffffff30",
      borderTopColor: "#fff", borderRadius: "50%",
      animation: "spin 0.7s linear infinite",
    }} />
  );
}

// ─── Auth Modal ───────────────────────────────────────────────────────────────

function AuthModal({ onClose, onAuth }) {
  const [tab, setTab] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit() {
    if (!email || !password) { setError("Fill in all fields"); return; }
    setLoading(true); setError("");
    try {
      const data = tab === "signin"
        ? await supabase.signIn(email, password)
        : await supabase.signUp(email, password);
      if (data.error) { setError(data.error.message); }
      else {
        if (tab === "signup") {
          setError("Check your email to confirm your account!");
        } else {
          onAuth(data.user);
          onClose();
        }
      }
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}>
          <div style={{ display: "flex", gap: 4 }}>
            {["signin", "signup"].map((t) => (
              <button key={t} className={`tab ${tab === t ? "tab-active" : "tab-inactive"}`}
                onClick={() => { setTab(t); setError(""); }}>
                {t === "signin" ? "Sign In" : "Sign Up"}
              </button>
            ))}
          </div>
          <button className="btn btn-ghost" onClick={onClose} style={{ padding: "6px 10px" }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ position: "relative" }}>
            <Mail size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }} />
            <input type="email" placeholder="you@example.com" value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ paddingLeft: 36 }} />
          </div>
          <div style={{ position: "relative" }}>
            <Lock size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }} />
            <input type={showPass ? "text" : "password"} placeholder="Password" value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              style={{ paddingLeft: 36, paddingRight: 36 }} />
            <button onClick={() => setShowPass((s) => !s)}
              style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", color: "var(--muted)" }}>
              {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>

          {error && (
            <p style={{ fontSize: 13, color: error.includes("Check") ? "var(--green)" : "var(--red)", background: error.includes("Check") ? "#22c55e10" : "#ef444410", padding: "8px 12px", borderRadius: 8 }}>
              {error}
            </p>
          )}

          <button className="btn btn-primary" onClick={handleSubmit} disabled={loading}
            style={{ width: "100%", justifyContent: "center", marginTop: 4, padding: "12px" }}>
            {loading ? <Spinner /> : (tab === "signin" ? "Sign In" : "Create Account")}
            {!loading && <ArrowRight size={15} />}
          </button>
        </div>

        <p style={{ marginTop: 20, fontSize: 12, color: "var(--muted)", textAlign: "center" }}>
          Powered by Supabase · Your data syncs across devices
        </p>
      </div>
    </div>
  );
}

// ─── Profile Panel ────────────────────────────────────────────────────────────

function ProfilePanel({ user, profile, decks, onSignOut, onClose }) {
  const totalCards  = decks.reduce((a, d) => a + (d.cards?.length || 0), 0);
  const totalEasy   = decks.reduce((a, d) => a + Object.values(d.ratings || {}).filter((r) => r === "easy").length, 0);
  const masteryRate = totalCards ? Math.round((totalEasy / totalCards) * 100) : 0;

  const byDiff = { Easy: 0, Medium: 0, Hard: 0 };
  decks.forEach((d) => { if (byDiff[d.difficulty] !== undefined) byDiff[d.difficulty]++; });

  const recentDecks = [...decks].slice(0, 4);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{
              width: 52, height: 52, borderRadius: 14,
              background: "linear-gradient(135deg, var(--accent), var(--accent2))",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 22, fontWeight: 800, color: "#fff",
            }}>
              {user.email?.[0]?.toUpperCase()}
            </div>
            <div>
              <p style={{ fontWeight: 700, fontSize: 16 }}>{profile?.username || user.email?.split("@")[0]}</p>
              <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 2, fontFamily: "var(--font-mono)" }}>{user.email}</p>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-danger btn-ghost" style={{ padding: "6px 12px", fontSize: 13 }} onClick={onSignOut}>
              <LogOut size={14} /> Sign out
            </button>
            <button className="btn btn-ghost" style={{ padding: "6px 10px" }} onClick={onClose}><X size={16} /></button>
          </div>
        </div>

        {/* Stats grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 20 }}>
          {[
            { icon: <BookOpen size={16} />, label: "Decks", val: decks.length, color: "var(--accent3)" },
            { icon: <Target size={16} />, label: "Cards", val: totalCards, color: "var(--yellow)" },
            { icon: <Trophy size={16} />, label: "Mastery", val: masteryRate + "%", color: "var(--green)" },
          ].map(({ icon, label, val, color }) => (
            <div key={label} className="stat-card" style={{ textAlign: "center" }}>
              <div style={{ color, marginBottom: 6 }}>{icon}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color, animation: "countUp 0.4s ease" }}>{val}</div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
            </div>
          ))}
        </div>

        {/* Difficulty breakdown */}
        <div className="stat-card" style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 14, textTransform: "uppercase", letterSpacing: "0.08em" }}>Difficulty Breakdown</p>
          {Object.entries(byDiff).map(([diff, count]) => {
            const dc = DIFFICULTY_COLORS[diff];
            return (
              <div key={diff} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <span style={{ background: dc.bg + "22", color: dc.bg, border: `1px solid ${dc.bg}44`, fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99, width: 60, textAlign: "center", fontFamily: "var(--font-mono)" }}>{diff}</span>
                <div style={{ flex: 1, height: 6, background: "var(--border)", borderRadius: 99, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${decks.length ? (count / decks.length) * 100 : 0}%`, background: dc.bg, borderRadius: 99, transition: "width 0.5s ease" }} />
                </div>
                <span style={{ fontSize: 12, color: "var(--muted)", fontFamily: "var(--font-mono)", width: 20, textAlign: "right" }}>{count}</span>
              </div>
            );
          })}
        </div>

        {/* Recent activity */}
        {recentDecks.length > 0 && (
          <div>
            <p style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.08em" }}>Recent Decks</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {recentDecks.map((d) => {
                const mastered = Object.values(d.ratings || {}).filter((r) => r === "easy").length;
                const dc = DIFFICULTY_COLORS[d.difficulty] || DIFFICULTY_COLORS.Medium;
                return (
                  <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: "var(--bg3)", borderRadius: 10, border: "1px solid var(--border)" }}>
                    <span style={{ background: dc.bg + "22", color: dc.bg, border: `1px solid ${dc.bg}44`, fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 99, fontFamily: "var(--font-mono)" }}>{d.difficulty}</span>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.problem_name || d.problemName}</span>
                    <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--font-mono)", flexShrink: 0 }}>{mastered}/{d.cards?.length} ✓</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Nav ──────────────────────────────────────────────────────────────────────

function Nav({ user, decks, onHome, onAuthOpen, onProfileOpen }) {
  return (
    <nav className="nav">
      <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }} onClick={onHome}>
        <div style={{
          width: 32, height: 32,
          background: "linear-gradient(135deg, var(--accent), var(--accent2))",
          borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 2px 10px #6366f140",
        }}>
          <Zap size={16} color="#fff" />
        </div>
        <span style={{ fontWeight: 800, fontSize: 17, letterSpacing: "-0.02em" }}>
          Leet<span style={{ color: "var(--accent3)" }}>Flash</span>
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {decks.length > 0 && (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)" }}>
            {decks.length} deck{decks.length !== 1 ? "s" : ""}
          </span>
        )}
        <button className="btn btn-ghost" style={{ padding: "6px 12px", fontSize: 13 }} onClick={onHome}>
          <Plus size={14} /> New
        </button>
        {user ? (
          <button onClick={onProfileOpen} style={{
            width: 34, height: 34, borderRadius: 9,
            background: "linear-gradient(135deg, var(--accent), var(--accent2))",
            border: "none", color: "#fff", fontWeight: 800, fontSize: 14,
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer",
          }}>
            {user.email?.[0]?.toUpperCase()}
          </button>
        ) : (
          <button className="btn btn-ghost" style={{ padding: "6px 14px", fontSize: 13 }} onClick={onAuthOpen}>
            <User size={14} /> Sign In
          </button>
        )}
      </div>
    </nav>
  );
}

// ─── API Key Input ────────────────────────────────────────────────────────────

function ApiKeyInput({ apiKey, onSave }) {
  const [val, setVal] = useState(apiKey || "");
  const [show, setShow] = useState(false);
  const [saved, setSaved] = useState(false);

  function save() {
    onSave(val.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div style={{
      background: "var(--bg2)", border: "1px solid var(--border)",
      borderRadius: 14, padding: "14px 18px", marginBottom: 20,
      display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap",
    }}>
      <Key size={15} color="var(--accent)" style={{ flexShrink: 0 }} />
      <span style={{ fontSize: 13, color: "var(--muted)", flex: "1 1 100px" }}>Anthropic API Key</span>
      <div style={{ display: "flex", gap: 8, flex: "2 1 240px" }}>
        <div style={{ position: "relative", flex: 1 }}>
          <input
            type={show ? "text" : "password"} value={val}
            onChange={(e) => setVal(e.target.value)}
            placeholder="sk-ant-..."
            onKeyDown={(e) => e.key === "Enter" && save()}
            style={{ paddingRight: 36, fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--accent3)" }}
          />
          <button onClick={() => setShow((s) => !s)} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", color: "var(--muted)" }}>
            {show ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        </div>
        <button className="btn" onClick={save} style={{
          padding: "8px 16px", fontSize: 13, flexShrink: 0, borderRadius: 9,
          background: saved ? "#22c55e" : "linear-gradient(135deg, var(--accent), var(--accent2))",
          color: "#fff", transition: "background 0.3s",
        }}>
          {saved ? "✓" : "Save"}
        </button>
      </div>
      <p style={{ width: "100%", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--border2)", marginTop: 2 }}>
        Stored in localStorage · never sent anywhere except api.anthropic.com
      </p>
    </div>
  );
}

// ─── Home Screen ──────────────────────────────────────────────────────────────

function HomeScreen({ onGenerate, decks, onLoadDeck, apiKey, onSaveApiKey, user }) {
  const [code, setCode] = useState("");
  const [problemName, setProblemName] = useState("");
  const [difficulty, setDifficulty] = useState("Medium");

  const canGenerate = code.trim() && apiKey;

  return (
    <div style={{ maxWidth: 780, margin: "0 auto", padding: "44px 20px" }}>
      {/* Hero */}
      <div className="anim-up" style={{ textAlign: "center", marginBottom: 52 }}>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          background: "var(--bg2)", border: "1px solid var(--border2)",
          borderRadius: 99, padding: "5px 14px", marginBottom: 22,
          fontSize: 11, color: "var(--muted)", fontWeight: 600, letterSpacing: "0.1em",
          textTransform: "uppercase", fontFamily: "var(--font-mono)",
        }}>
          <Zap size={11} color="var(--accent3)" /> Spaced Repetition · AI-Powered
        </div>
        <h1 style={{
          fontSize: "clamp(36px, 6vw, 56px)", fontWeight: 900, letterSpacing: "-0.04em",
          lineHeight: 1.05, marginBottom: 14,
        }}>
          Stop forgetting<br />
          <span style={{ color: "var(--accent3)" }}>your solutions.</span>
        </h1>
        <p style={{ fontSize: 16, color: "var(--muted)", maxWidth: 440, margin: "0 auto" }}>
          Paste your LeetCode solution. Get AI-generated flashcards that make the concepts stick.
        </p>
      </div>

      {/* API Key */}
      <div className="anim-up" style={{ animationDelay: "0.05s" }}>
        <ApiKeyInput apiKey={apiKey} onSave={onSaveApiKey} />
      </div>

      {/* Input card */}
      <div className="anim-up noise" style={{
        background: "var(--bg2)", border: "1px solid var(--border)",
        borderRadius: 20, padding: 28, marginBottom: 32,
        position: "relative", animationDelay: "0.1s",
      }}>
        {/* Problem name + difficulty */}
        <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <input
            type="text" placeholder="Problem name (e.g. Two Sum)"
            value={problemName} onChange={(e) => setProblemName(e.target.value)}
            style={{ flex: 1, minWidth: 180 }}
          />
          <div style={{ display: "flex", gap: 6 }}>
            {["Easy", "Medium", "Hard"].map((d) => {
              const dc = DIFFICULTY_COLORS[d];
              const active = difficulty === d;
              return (
                <button key={d} onClick={() => setDifficulty(d)} style={{
                  padding: "8px 14px", borderRadius: 9, fontSize: 13, fontWeight: 700,
                  fontFamily: "var(--font-ui)", transition: "all 0.15s", cursor: "pointer",
                  background: active ? dc.bg + "22" : "transparent",
                  color: active ? dc.bg : "var(--muted)",
                  border: `1px solid ${active ? dc.bg + "66" : "var(--border)"}`,
                }}>
                  {d}
                </button>
              );
            })}
          </div>
        </div>

        <textarea
          value={code} onChange={(e) => setCode(e.target.value)}
          placeholder={"// Paste your LeetCode solution here...\n// Any language works!"}
          style={{
            minHeight: 260, fontFamily: "var(--font-mono)", fontSize: 13,
            lineHeight: 1.75, resize: "vertical",
            color: "#a5b4fc",
          }}
        />

        <button
          onClick={() => canGenerate && onGenerate(code, problemName, difficulty)}
          disabled={!canGenerate}
          className={canGenerate ? "btn btn-primary" : "btn"}
          style={{
            marginTop: 14, width: "100%", justifyContent: "center", padding: "14px",
            fontSize: 15, letterSpacing: "-0.01em",
            ...(canGenerate ? {} : { background: "var(--bg3)", color: "var(--muted)", cursor: "not-allowed" }),
          }}>
          <Zap size={16} />
          {!apiKey ? "Enter API key to generate" : "Generate Flashcards"}
        </button>
      </div>

      {/* Saved Decks */}
      {decks.length > 0 && (
        <div className="anim-up" style={{ animationDelay: "0.15s" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18 }}>
            <BookOpen size={14} color="var(--muted)" />
            <h2 style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
              Saved Decks
            </h2>
            <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 12 }}>
            {decks.map((deck) => {
              const mastered = Object.values(deck.ratings || {}).filter((r) => r === "easy").length;
              const total = deck.cards?.length || 0;
              const pct = total ? Math.round((mastered / total) * 100) : 0;
              const dc = DIFFICULTY_COLORS[deck.difficulty] || DIFFICULTY_COLORS.Medium;
              const name = deck.problem_name || deck.problemName || "Untitled";
              return (
                <div key={deck.id} className="deck-card" onClick={() => onLoadDeck(deck)}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                    <span style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.3, flex: 1, marginRight: 8 }}>{name}</span>
                    <span style={{ background: dc.bg + "22", color: dc.bg, border: `1px solid ${dc.bg}44`, fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 99, fontFamily: "var(--font-mono)", flexShrink: 0 }}>
                      {deck.difficulty}
                    </span>
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <ProgressBar current={mastered} total={total} color={dc.bg} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)" }}>
                      {total} cards · {pct}% mastered
                    </span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--border2)" }}>
                      {new Date(deck.created_at || deck.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {decks.length === 0 && (
        <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--muted)" }}>
          <Hash size={32} style={{ marginBottom: 12, opacity: 0.3 }} />
          <p style={{ fontSize: 14 }}>No decks yet — paste a solution to get started</p>
        </div>
      )}
    </div>
  );
}

// ─── Loading Screen ───────────────────────────────────────────────────────────

function LoadingScreen({ problemName }) {
  const msgs = [
    "Analyzing algorithmic patterns…",
    "Crafting spaced-repetition cards…",
    "Identifying edge cases…",
    "Building your flashcard deck…",
  ];
  const [msgIdx, setMsgIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setMsgIdx((i) => (i + 1) % msgs.length), 2200);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: "80px 20px", textAlign: "center" }}>
      <div style={{ marginBottom: 44 }}>
        <div style={{
          width: 64, height: 64, margin: "0 auto 24px",
          background: "linear-gradient(135deg, var(--accent), var(--accent2))",
          borderRadius: 18, display: "flex", alignItems: "center", justifyContent: "center",
          animation: "glow 2s infinite",
        }}>
          <Layers size={28} color="#fff" />
        </div>
        <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8, letterSpacing: "-0.02em" }}>
          {problemName ? `Analyzing "${problemName}"` : "Analyzing your solution"}
        </h2>
        <p style={{ color: "var(--muted)", fontSize: 14, animation: "fadeIn 0.4s ease", key: msgIdx }}>
          {msgs[msgIdx]}
        </p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} style={{ display: "flex", gap: 14, alignItems: "flex-start", animationDelay: `${i * 0.1}s` }}>
            <div className="skeleton" style={{ width: 80, height: 22, flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div className="skeleton" style={{ height: 16, width: "70%", marginBottom: 8 }} />
              <div className="skeleton" style={{ height: 64 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Flashcard ────────────────────────────────────────────────────────────────

function FlashCard({ card, slideDir }) {
  const [flipped, setFlipped] = useState(false);
  const c = COLORS[card.category] || { bg: "#6b7280" };
  useEffect(() => { setFlipped(false); }, [card.id]);

  return (
    <div
      className={`card-scene ${slideDir}`}
      style={{ height: 360, width: "100%", cursor: "pointer" }}
      onClick={() => setFlipped((f) => !f)}
    >
      <div className={`card-inner ${flipped ? "flipped" : ""}`} style={{ width: "100%", height: "100%" }}>
        {/* Front */}
        <div className="card-face noise" style={{
          background: `linear-gradient(145deg, #0e0e1a, #13132a)`,
          border: `1px solid ${c.bg}30`,
          display: "flex", flexDirection: "column",
          padding: 32, justifyContent: "space-between",
          boxShadow: `0 12px 48px ${c.bg}18, inset 0 1px 0 #ffffff08`,
          position: "relative",
        }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${c.bg}, transparent)`, borderRadius: "20px 20px 0 0" }} />
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <CategoryBadge category={card.category} />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                tap to reveal
              </span>
            </div>
            <p style={{ fontSize: 21, fontWeight: 700, lineHeight: 1.55, letterSpacing: "-0.01em" }}>
              {card.question}
            </p>
          </div>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <div style={{ width: 36, height: 2, background: c.bg + "40", borderRadius: 99 }} />
          </div>
        </div>

        {/* Back */}
        <div className="card-face card-back noise" style={{
          background: `linear-gradient(145deg, #0d1520, #111827)`,
          border: `1px solid ${c.bg}50`,
          display: "flex", flexDirection: "column",
          padding: 32, justifyContent: "flex-start",
          boxShadow: `0 12px 48px ${c.bg}28, inset 0 1px 0 #ffffff0a`,
          overflowY: "auto", position: "relative",
        }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${c.bg}, transparent)`, borderRadius: "20px 20px 0 0" }} />
          <CategoryBadge category={card.category} />
          <p style={{
            fontFamily: "var(--font-mono)", fontSize: card.answer.length > 200 ? 12 : 14,
            color: "#cbd5e1", lineHeight: 1.8, marginTop: 20, whiteSpace: "pre-wrap",
          }}>
            {card.answer}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Review Screen ────────────────────────────────────────────────────────────

function ReviewScreen({ deck, onRate, onFinish }) {
  const [index, setIndex] = useState(0);
  const [ratings, setRatings] = useState(deck.ratings || {});
  const [slideDir, setSlideDir] = useState("slide-r");
  const cardKey = useRef(0);

  const card  = deck.cards[index];
  const total = deck.cards.length;
  const ratedCount = Object.keys(ratings).length;

  function go(dir) {
    setSlideDir(dir > 0 ? "slide-r" : "slide-l");
    cardKey.current++;
    setIndex((i) => Math.max(0, Math.min(total - 1, i + dir)));
  }

  function rate(r) {
    const newRatings = { ...ratings, [card.id]: r };
    setRatings(newRatings);
    onRate(newRatings);
    if (index < total - 1) setTimeout(() => go(1), 200);
  }

  const RATING_CONFIG = {
    again: { label: "Again",  emoji: "🔁", color: "#ef4444" },
    good:  { label: "Good",   emoji: "👍", color: "#3b82f6" },
    easy:  { label: "Easy",   emoji: "✅", color: "#22c55e" },
  };

  const name = deck.problem_name || deck.problemName || "Untitled";

  return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: "32px 20px" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-0.02em" }}>{name}</h2>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)" }}>
            {index + 1} / {total} cards · {ratedCount} rated
          </span>
        </div>
        <button className="btn btn-ghost" onClick={onFinish} style={{ fontSize: 13, padding: "6px 14px" }}>
          Finish Early
        </button>
      </div>

      <ProgressBar current={ratedCount} total={total} />
      <div style={{ marginBottom: 24 }} />

      <FlashCard key={cardKey.current} card={card} slideDir={slideDir} />

      {/* Rating */}
      <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
        {Object.entries(RATING_CONFIG).map(([r, conf]) => {
          const rated = ratings[card.id] === r;
          return (
            <button key={r} onClick={() => rate(r)} style={{
              flex: 1, padding: "13px 8px", borderRadius: 12, fontSize: 14,
              fontWeight: 700, fontFamily: "var(--font-ui)", cursor: "pointer",
              background: rated ? conf.color + "22" : "var(--bg2)",
              color: rated ? conf.color : "var(--muted)",
              border: `1px solid ${rated ? conf.color + "55" : "var(--border)"}`,
              transition: "all 0.15s",
            }}>
              {conf.emoji} {conf.label}
            </button>
          );
        })}
      </div>

      {/* Nav */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20, gap: 10 }}>
        <button className="btn btn-ghost" onClick={() => go(-1)} disabled={index === 0}
          style={{ opacity: index === 0 ? 0.3 : 1, cursor: index === 0 ? "not-allowed" : "pointer" }}>
          <ChevronLeft size={16} /> Prev
        </button>

        {ratedCount === total && (
          <button className="btn btn-primary" onClick={onFinish} style={{ flex: 1 }}>
            <CheckCircle size={15} /> See Summary
          </button>
        )}

        <button className="btn btn-ghost" onClick={() => go(1)} disabled={index === total - 1}
          style={{ opacity: index === total - 1 ? 0.3 : 1, cursor: index === total - 1 ? "not-allowed" : "pointer" }}>
          Next <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

// ─── Summary Screen ───────────────────────────────────────────────────────────

function SummaryScreen({ deck, onReview, onNewSolution }) {
  const ratings  = deck.ratings || {};
  const mastered = Object.values(ratings).filter((r) => r === "easy").length;
  const good     = Object.values(ratings).filter((r) => r === "good").length;
  const again    = Object.values(ratings).filter((r) => r === "again").length;
  const total    = deck.cards.length;
  const pct      = total ? Math.round((mastered / total) * 100) : 0;

  const categoryScores = {};
  deck.cards.forEach((c) => {
    if (!categoryScores[c.category]) categoryScores[c.category] = { total: 0, mastered: 0 };
    categoryScores[c.category].total++;
    if (ratings[c.id] === "easy") categoryScores[c.category].mastered++;
  });
  const weakest = Object.entries(categoryScores)
    .sort((a, b) => (a[1].mastered / a[1].total) - (b[1].mastered / b[1].total))[0];

  const emoji = pct === 100 ? "🏆" : pct >= 60 ? "🎯" : "📚";
  const name = deck.problem_name || deck.problemName || "Untitled";

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "60px 20px", textAlign: "center" }}>
      <div className="anim-up" style={{ fontSize: 56, marginBottom: 18 }}>{emoji}</div>
      <h2 className="anim-up" style={{ fontSize: 30, fontWeight: 900, letterSpacing: "-0.03em", marginBottom: 6, animationDelay: "0.05s" }}>
        Session Complete
      </h2>
      <p className="anim-up" style={{ color: "var(--muted)", marginBottom: 36, animationDelay: "0.1s" }}>{name}</p>

      {/* Circular progress */}
      <div className="anim-up" style={{ display: "flex", justifyContent: "center", marginBottom: 32, animationDelay: "0.12s" }}>
        <div style={{ position: "relative", width: 100, height: 100 }}>
          <svg width="100" height="100" style={{ transform: "rotate(-90deg)" }}>
            <circle cx="50" cy="50" r="42" fill="none" stroke="var(--border)" strokeWidth="8" />
            <circle cx="50" cy="50" r="42" fill="none" stroke="var(--accent3)" strokeWidth="8"
              strokeDasharray={`${2 * Math.PI * 42}`}
              strokeDashoffset={`${2 * Math.PI * 42 * (1 - pct / 100)}`}
              strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.8s ease" }}
            />
          </svg>
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
            <span style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-0.02em" }}>{pct}%</span>
            <span style={{ fontSize: 9, color: "var(--muted)", fontFamily: "var(--font-mono)", textTransform: "uppercase" }}>mastered</span>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="anim-up" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 24, animationDelay: "0.15s" }}>
        {[
          { label: "Easy ✅", val: mastered, color: "#22c55e" },
          { label: "Good 👍", val: good, color: "#3b82f6" },
          { label: "Again 🔁", val: again, color: "#ef4444" },
        ].map(({ label, val, color }) => (
          <div key={label} className="stat-card">
            <div style={{ fontSize: 28, fontWeight: 900, color, animation: "countUp 0.5s ease" }}>{val}</div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, fontWeight: 600 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Weakest category */}
      {weakest && weakest[1].mastered < weakest[1].total && (
        <div className="anim-up" style={{
          background: "#ef444410", border: "1px solid #ef444428",
          borderRadius: 14, padding: "14px 18px", marginBottom: 28,
          textAlign: "left", animationDelay: "0.2s",
        }}>
          <div style={{ fontSize: 11, color: "var(--red)", fontWeight: 700, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Needs More Focus
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <CategoryBadge category={weakest[0]} small />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted)" }}>
              {weakest[1].mastered}/{weakest[1].total} mastered
            </span>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="anim-up" style={{ display: "flex", gap: 10, animationDelay: "0.22s" }}>
        <button className="btn btn-ghost" onClick={onReview} style={{ flex: 1, justifyContent: "center", padding: "13px" }}>
          <RotateCcw size={14} /> Review Again
        </button>
        <button className="btn btn-primary" onClick={onNewSolution} style={{ flex: 1, justifyContent: "center", padding: "13px" }}>
          <Plus size={14} /> New Solution
        </button>
      </div>
    </div>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────

export default function LeetFlash() {
  const [view, setView]             = useState("home");
  const [decks, setDecks]           = useState([]);
  const [activeDeck, setActiveDeck] = useState(null);
  const [error, setError]           = useState(null);
  const [apiKey, setApiKey]         = useState("");
  const [user, setUser]             = useState(null);
  const [profile, setProfile]       = useState(null);
  const [showAuth, setShowAuth]     = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [toast, setToast]           = useState(null);
  const [loading, setLoading]       = useState(true);
  const pendingRef = useRef(null);

  const showToast = (message, type = "success") => setToast({ message, type });

  // Bootstrap
  useEffect(() => {
    const savedKey = localStorage.getItem("lf-api-key");
    if (savedKey) setApiKey(savedKey);

    const savedUser = supabase.getUser();
    if (savedUser) {
      setUser(savedUser);
      loadUserData(savedUser);
    } else {
      // Load local decks
      setDecks(localDB.getDecks());
      setLoading(false);
    }
  }, []);

  async function loadUserData(u) {
    setLoading(true);
    try {
      const [serverDecks, prof] = await Promise.all([
        supabase.getDecks(u.id),
        supabase.getProfile(u.id),
      ]);
      if (Array.isArray(serverDecks)) setDecks(serverDecks);
      if (prof) setProfile(prof);
    } catch (e) {
      setDecks(localDB.getDecks());
    }
    setLoading(false);
  }

  function handleSaveApiKey(key) {
    setApiKey(key);
    localStorage.setItem("lf-api-key", key);
    showToast("API key saved");
  }

  function handleAuth(u) {
    setUser(u);
    showToast("Signed in successfully!");
    loadUserData(u);
  }

  function handleSignOut() {
    supabase.signOut();
    setUser(null);
    setProfile(null);
    setDecks(localDB.getDecks());
    setShowProfile(false);
    showToast("Signed out", "info");
  }

  async function persistDecks(updated) {
    setDecks(updated);
    if (!user) {
      localDB.saveDecks(updated);
    }
  }

  async function handleGenerate(code, problemName, difficulty) {
    pendingRef.current = { code, problemName, difficulty };
    setError(null);
    setView("loading");

    try {
      const cards = await callClaude(apiKey, code, problemName, difficulty);
      const newDeck = {
        id: Date.now().toString(),
        user_id: user?.id,
        problem_name: problemName || "Untitled",
        problemName: problemName || "Untitled",
        difficulty,
        created_at: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        cards: cards.map((c, i) => ({ ...c, id: c.id ?? i + 1 })),
        ratings: {},
      };

      if (user) {
        try {
          await supabase.saveDeck({
            user_id: user.id,
            problem_name: newDeck.problem_name,
            difficulty,
            cards: newDeck.cards,
            ratings: {},
          });
          const fresh = await supabase.getDecks(user.id);
          if (Array.isArray(fresh)) setDecks(fresh);
        } catch (e) {
          await persistDecks([newDeck, ...decks]);
        }
      } else {
        await persistDecks([newDeck, ...decks]);
      }

      setActiveDeck(newDeck);
      setView("review");
    } catch (e) {
      setError(e.message);
      setView("error");
    }
  }

  function handleRate(newRatings) {
    if (!activeDeck) return;
    const updated = { ...activeDeck, ratings: newRatings };
    setActiveDeck(updated);
    const newDecks = decks.map((d) => d.id === activeDeck.id ? { ...d, ratings: newRatings } : d);
    persistDecks(newDecks);
    if (user) {
      supabase.updateDeck(activeDeck.id, { ratings: newRatings }).catch(() => {});
    }
  }

  function handleLoadDeck(deck) {
    setActiveDeck({ ...deck, ratings: deck.ratings || {} });
    setView("review");
  }

  return (
    <>
      <style>{GLOBAL_STYLES}</style>

      {/* Background orbs */}
      <div className="orb" style={{ width: 500, height: 500, background: "#6366f1", top: -100, left: -100 }} />
      <div className="orb" style={{ width: 400, height: 400, background: "#8b5cf6", bottom: 0, right: -100 }} />

      <Nav
        user={user} decks={decks}
        onHome={() => setView("home")}
        onAuthOpen={() => setShowAuth(true)}
        onProfileOpen={() => setShowProfile(true)}
      />

      <main style={{ minHeight: "calc(100vh - 58px)" }}>
        {view === "home" && (
          <HomeScreen
            onGenerate={handleGenerate}
            decks={decks}
            onLoadDeck={handleLoadDeck}
            apiKey={apiKey}
            onSaveApiKey={handleSaveApiKey}
            user={user}
          />
        )}

        {view === "loading" && <LoadingScreen problemName={pendingRef.current?.problemName} />}

        {view === "review" && activeDeck && (
          <ReviewScreen
            deck={activeDeck}
            onRate={handleRate}
            onFinish={() => setView("summary")}
          />
        )}

        {view === "summary" && activeDeck && (
          <SummaryScreen
            deck={activeDeck}
            onReview={() => { setActiveDeck({ ...activeDeck, ratings: {} }); setView("review"); }}
            onNewSolution={() => setView("home")}
          />
        )}

        {view === "error" && (
          <div style={{ maxWidth: 480, margin: "80px auto", padding: "0 20px", textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
            <h2 style={{ fontSize: 22, fontWeight: 800, color: "var(--red)", marginBottom: 10 }}>API Error</h2>
            <p style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted)", marginBottom: 28, lineHeight: 1.7 }}>{error}</p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button className="btn btn-primary" onClick={() => handleGenerate(pendingRef.current?.code, pendingRef.current?.problemName, pendingRef.current?.difficulty)}>
                <RotateCcw size={14} /> Retry
              </button>
              <button className="btn btn-ghost" onClick={() => setView("home")}>Go Home</button>
            </div>
          </div>
        )}
      </main>

      {/* Modals */}
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} onAuth={handleAuth} />}
      {showProfile && user && (
        <ProfilePanel
          user={user} profile={profile} decks={decks}
          onSignOut={handleSignOut}
          onClose={() => setShowProfile(false)}
        />
      )}

      {/* Toast */}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  );
}
