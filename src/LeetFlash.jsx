import { useState, useEffect, useCallback, useRef } from "react";
import { ChevronLeft, ChevronRight, RotateCcw, Plus, BookOpen, Zap, CheckCircle, Layers, Key, Eye, EyeOff } from "lucide-react";

// ─── Constants ────────────────────────────────────────────────────────────────

const COLORS = {
  Pattern:       { bg: "#f59e0b", text: "#fff" },
  Intuition:     { bg: "#3b82f6", text: "#fff" },
  Complexity:    { bg: "#10b981", text: "#fff" },
  "Edge Cases":  { bg: "#ef4444", text: "#fff" },
  "Code Trick":  { bg: "#8b5cf6", text: "#fff" },
  "Why It Works":{ bg: "#ec4899", text: "#fff" },
};

const DIFFICULTY_COLORS = {
  Easy:   { bg: "#00b8a3", text: "#fff" },
  Medium: { bg: "#ffc01e", text: "#1a1a1a" },
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

// ─── Styles ───────────────────────────────────────────────────────────────────

const GLOBAL_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Syne:wght@400;600;700;800&display=swap');

  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0a0a0f; color: #e2e8f0; font-family: 'Syne', sans-serif; min-height: 100vh; }

  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: #111118; }
  ::-webkit-scrollbar-thumb { background: #2a2a3a; border-radius: 3px; }

  textarea, input[type="text"], input[type="password"] {
    font-family: 'JetBrains Mono', monospace !important;
  }

  .card-scene { perspective: 1200px; }
  .card-inner {
    position: relative; width: 100%; height: 100%;
    transition: transform 0.6s ease;
    transform-style: preserve-3d;
  }
  .card-inner.flipped { transform: rotateY(180deg); }
  .card-face {
    position: absolute; width: 100%; height: 100%;
    backface-visibility: hidden;
    -webkit-backface-visibility: hidden;
    border-radius: 20px;
  }
  .card-back { transform: rotateY(180deg); }

  @keyframes slideInRight { from { opacity: 0; transform: translateX(40px); } to { opacity: 1; transform: translateX(0); } }
  @keyframes slideInLeft  { from { opacity: 0; transform: translateX(-40px); } to { opacity: 1; transform: translateX(0); } }
  @keyframes bounce       { 0%,100% { transform: scale(1); } 50% { transform: scale(1.12); } }
  @keyframes pulse        { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
  @keyframes shimmer      { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }

  .slide-right { animation: slideInRight 0.35s ease; }
  .slide-left  { animation: slideInLeft  0.35s ease; }
  .btn-bounce:active { animation: bounce 0.3s ease; }

  .skeleton {
    background: linear-gradient(90deg, #1a1a2e 25%, #252540 50%, #1a1a2e 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
    border-radius: 12px;
  }

  .noise-card {
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.03'/%3E%3C/svg%3E");
  }

  textarea:focus, input:focus {
    border-color: #6366f1 !important;
    box-shadow: 0 0 0 3px rgba(99,102,241,0.15) !important;
    outline: none;
  }

  button { cursor: pointer; }
`;

// ─── Storage (localStorage fallback for local dev) ───────────────────────────

const storage = {
  async get(key) {
    if (window.storage) return window.storage.get(key);
    const val = localStorage.getItem(key);
    return val ? { value: val } : null;
  },
  async set(key, value) {
    if (window.storage) return window.storage.set(key, value);
    localStorage.setItem(key, value);
  },
};

// ─── API (Groq) ───────────────────────────────────────────────────────────────

async function callGroq(apiKey, code, problemName, difficulty) {
  const userContent = `Problem: ${problemName || "Unknown"}
Difficulty: ${difficulty || "Unknown"}

Solution:
${code}`;

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      max_tokens: 2000,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `API error ${res.status}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "";
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function CategoryBadge({ category, small }) {
  const c = COLORS[category] || { bg: "#6b7280", text: "#fff" };
  return (
    <span style={{
      background: c.bg, color: c.text,
      fontFamily: "'Syne', sans-serif",
      fontSize: small ? "10px" : "12px",
      fontWeight: 700, letterSpacing: "0.06em",
      padding: small ? "2px 8px" : "4px 12px",
      borderRadius: 99, textTransform: "uppercase",
      display: "inline-block", whiteSpace: "nowrap",
    }}>
      {category}
    </span>
  );
}

function ProgressBar({ current, total }) {
  const pct = total ? Math.round((current / total) * 100) : 0;
  return (
    <div style={{ width: "100%", height: 4, background: "#1e1e30", borderRadius: 99 }}>
      <div style={{
        height: "100%", width: `${pct}%`,
        background: "linear-gradient(90deg, #6366f1, #8b5cf6)",
        borderRadius: 99, transition: "width 0.4s ease",
      }} />
    </div>
  );
}

// ─── API Key Banner ───────────────────────────────────────────────────────────

function ApiKeyBanner({ apiKey, onSave }) {
  const [val, setVal] = useState(apiKey || "");
  const [show, setShow] = useState(false);
  const [saved, setSaved] = useState(false);

  function handleSave() {
    onSave(val.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div style={{
      background: "#0f0f1c", border: "1px solid #1e1e30",
      borderRadius: 14, padding: "16px 20px", marginBottom: 24,
      display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap",
    }}>
      <Key size={16} color="#6366f1" style={{ flexShrink: 0 }} />
      <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 13, color: "#64748b", flex: "1 1 120px" }}>
        Groq API Key
      </span>
      <div style={{ display: "flex", gap: 8, flex: "2 1 260px", alignItems: "center" }}>
        <div style={{ position: "relative", flex: 1 }}>
          <input
            type={show ? "text" : "password"}
            value={val}
            onChange={(e) => setVal(e.target.value)}
            placeholder="gsk_..."
            style={{
              width: "100%", background: "#0a0a0f", border: "1px solid #1e1e30",
              borderRadius: 8, color: "#a5b4fc", padding: "8px 36px 8px 12px",
              fontSize: 13, transition: "border 0.2s",
            }}
          />
          <button
            onClick={() => setShow((s) => !s)}
            style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#4a4a6a", padding: 2 }}>
            {show ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        <button
          onClick={handleSave}
          style={{
            background: saved ? "#10b981" : "linear-gradient(135deg, #6366f1, #8b5cf6)",
            border: "none", borderRadius: 8, padding: "8px 16px",
            color: "#fff", fontSize: 13, fontWeight: 700,
            fontFamily: "'Syne', sans-serif", transition: "background 0.3s", flexShrink: 0,
          }}>
          {saved ? "Saved ✓" : "Save"}
        </button>
      </div>
      <p style={{ width: "100%", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#3a3a5a", marginTop: 4 }}>
        Key is stored in localStorage and never sent anywhere except the Groq API. Get yours free at console.groq.com
      </p>
    </div>
  );
}

// ─── Home Screen ──────────────────────────────────────────────────────────────

function HomeScreen({ onGenerate, decks, onLoadDeck, apiKey, onSaveApiKey }) {
  const [code, setCode] = useState("");
  const [problemName, setProblemName] = useState("");
  const [difficulty, setDifficulty] = useState("Medium");

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "40px 20px" }}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 48 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 16 }}>
          <div style={{
            width: 44, height: 44,
            background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
            borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Zap size={22} color="#fff" />
          </div>
          <h1 style={{
            fontFamily: "'Syne', sans-serif", fontSize: 34, fontWeight: 800,
            background: "linear-gradient(90deg, #a5b4fc, #c084fc)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          }}>
            LeetFlash
          </h1>
        </div>
        <p style={{ color: "#94a3b8", fontSize: 15, fontFamily: "'Syne', sans-serif" }}>
          Turn your LeetCode solutions into spaced-repetition flashcards
        </p>
      </div>

      {/* API Key */}
      <ApiKeyBanner apiKey={apiKey} onSave={onSaveApiKey} />

      {/* Input Card */}
      <div style={{
        background: "#111118", border: "1px solid #1e1e30",
        borderRadius: 20, padding: 32, marginBottom: 32,
      }}>
        <div style={{ display: "flex", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
          <input
            type="text"
            placeholder="Problem name (optional)"
            value={problemName}
            onChange={(e) => setProblemName(e.target.value)}
            style={{
              flex: 1, minWidth: 200, background: "#0d0d1a", border: "1px solid #1e1e30",
              borderRadius: 10, color: "#e2e8f0", padding: "10px 14px", fontSize: 14,
              fontFamily: "'Syne', sans-serif !important", transition: "border 0.2s",
            }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            {["Easy", "Medium", "Hard"].map((d) => {
              const dc = DIFFICULTY_COLORS[d];
              const active = difficulty === d;
              return (
                <button
                  key={d}
                  onClick={() => setDifficulty(d)}
                  style={{
                    background: active ? dc.bg : "transparent",
                    color: active ? dc.text : "#64748b",
                    border: `1px solid ${active ? dc.bg : "#1e1e30"}`,
                    borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 700,
                    fontFamily: "'Syne', sans-serif", transition: "all 0.2s",
                  }}>
                  {d}
                </button>
              );
            })}
          </div>
        </div>

        <textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={"// Paste your LeetCode solution here...\n// Any language works!"}
          style={{
            width: "100%", minHeight: 280, background: "#0d0d1a",
            border: "1px solid #1e1e30", borderRadius: 12,
            color: "#a5b4fc", padding: 20, fontSize: 13, lineHeight: 1.7,
            resize: "vertical", transition: "border 0.2s, box-shadow 0.2s",
          }}
        />

        <button
          onClick={() => code.trim() && onGenerate(code, problemName, difficulty)}
          disabled={!code.trim() || !apiKey}
          style={{
            marginTop: 16, width: "100%", padding: "14px 24px",
            background: (code.trim() && apiKey) ? "linear-gradient(135deg, #6366f1, #8b5cf6)" : "#1e1e30",
            color: (code.trim() && apiKey) ? "#fff" : "#4a4a6a",
            border: "none", borderRadius: 12, fontSize: 15, fontWeight: 700,
            fontFamily: "'Syne', sans-serif", transition: "opacity 0.2s",
            letterSpacing: "0.02em",
          }}>
          <Zap size={16} style={{ display: "inline", marginRight: 8, verticalAlign: "middle" }} />
          {!apiKey ? "Enter Groq API key above to generate" : "Generate Flashcards"}
        </button>
      </div>

      {/* Saved Decks */}
      {decks.length > 0 && (
        <div>
          <h2 style={{
            fontFamily: "'Syne', sans-serif", fontSize: 16, fontWeight: 700,
            color: "#64748b", marginBottom: 16, letterSpacing: "0.08em", textTransform: "uppercase",
          }}>
            <BookOpen size={14} style={{ display: "inline", marginRight: 8, verticalAlign: "middle" }} />
            Saved Decks
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
            {decks.map((deck) => {
              const mastered = Object.values(deck.ratings || {}).filter((r) => r === "easy").length;
              const dc = DIFFICULTY_COLORS[deck.difficulty] || DIFFICULTY_COLORS.Medium;
              return (
                <button
                  key={deck.id}
                  onClick={() => onLoadDeck(deck)}
                  style={{
                    background: "#111118", border: "1px solid #1e1e30",
                    borderRadius: 14, padding: "16px 18px", cursor: "pointer",
                    textAlign: "left", transition: "border-color 0.2s, transform 0.15s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#3730a3"; e.currentTarget.style.transform = "translateY(-2px)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#1e1e30"; e.currentTarget.style.transform = "translateY(0)"; }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                    <span style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, color: "#e2e8f0" }}>
                      {deck.problemName || "Untitled"}
                    </span>
                    <span style={{ background: dc.bg, color: dc.text, fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99 }}>
                      {deck.difficulty}
                    </span>
                  </div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "#64748b" }}>
                    {deck.cards.length} cards · {mastered} mastered
                  </div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#3a3a5a", marginTop: 4 }}>
                    {new Date(deck.createdAt).toLocaleDateString()}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Loading Screen ───────────────────────────────────────────────────────────

function LoadingScreen({ problemName }) {
  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "80px 20px", textAlign: "center" }}>
      <div style={{ marginBottom: 40 }}>
        <div style={{
          width: 56, height: 56, margin: "0 auto 20px",
          background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
          borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center",
          animation: "pulse 1.5s infinite",
        }}>
          <Layers size={26} color="#fff" />
        </div>
        <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: 20, fontWeight: 700, color: "#a5b4fc", marginBottom: 8 }}>
          Analyzing{problemName ? ` "${problemName}"` : " your solution"}...
        </h2>
        <p style={{ color: "#64748b", fontSize: 14 }}>Groq + Llama is crafting flashcards to lock in the concepts</p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {[1, 2, 3].map((i) => (
          <div key={i} style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
            <div className="skeleton" style={{ width: 90, height: 24, flexShrink: 0 }} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="skeleton" style={{ height: 20, width: "65%" }} />
              <div className="skeleton" style={{ height: 80 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Flash Card ───────────────────────────────────────────────────────────────

function FlashCard({ card, slideDir }) {
  const [flipped, setFlipped] = useState(false);
  const c = COLORS[card.category] || { bg: "#6b7280" };

  useEffect(() => { setFlipped(false); }, [card.id]);

  return (
    <div
      className={`card-scene ${slideDir}`}
      style={{ height: 380, width: "100%", cursor: "pointer" }}
      onClick={() => setFlipped((f) => !f)}
    >
      <div className={`card-inner ${flipped ? "flipped" : ""}`} style={{ width: "100%", height: "100%" }}>
        {/* Front */}
        <div
          className="card-face noise-card"
          style={{
            background: "linear-gradient(145deg, #13131f, #1a1a2e)",
            border: `1px solid ${c.bg}40`,
            display: "flex", flexDirection: "column",
            padding: 32, justifyContent: "space-between",
            boxShadow: `0 8px 40px ${c.bg}20, inset 0 1px 0 #ffffff08`,
          }}>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <CategoryBadge category={card.category} />
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#4a4a6a", textTransform: "uppercase" }}>
                click to reveal
              </span>
            </div>
            <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 22, fontWeight: 700, color: "#e2e8f0", lineHeight: 1.5 }}>
              {card.question}
            </p>
          </div>
          <div style={{ display: "flex", justifyContent: "center", opacity: 0.2 }}>
            <div style={{ width: 40, height: 2, background: c.bg, borderRadius: 99 }} />
          </div>
        </div>

        {/* Back */}
        <div
          className="card-face card-back noise-card"
          style={{
            background: "linear-gradient(145deg, #0f1929, #111827)",
            border: `1px solid ${c.bg}60`,
            display: "flex", flexDirection: "column",
            padding: 32, justifyContent: "flex-start",
            boxShadow: `0 8px 40px ${c.bg}30, inset 0 1px 0 #ffffff0a`,
            overflowY: "auto",
          }}>
          <CategoryBadge category={card.category} />
          <p style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: card.answer.length > 200 ? 13 : 15,
            color: "#cbd5e1", lineHeight: 1.75,
            marginTop: 20, whiteSpace: "pre-wrap",
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
  const [slideDir, setSlideDir] = useState("slide-right");
  const cardKey = useRef(0);

  const card = deck.cards[index];
  const total = deck.cards.length;
  const ratedCount = Object.keys(ratings).length;

  function go(dir) {
    setSlideDir(dir > 0 ? "slide-right" : "slide-left");
    cardKey.current += 1;
    setIndex((i) => Math.max(0, Math.min(total - 1, i + dir)));
  }

  function rate(r) {
    const newRatings = { ...ratings, [card.id]: r };
    setRatings(newRatings);
    onRate(newRatings);
    if (index < total - 1) {
      setTimeout(() => go(1), 220);
    }
  }

  const RATING_CONFIG = {
    again: { label: "Again 🔁", bg: "#ef4444" },
    good:  { label: "Good 👍",  bg: "#3b82f6" },
    easy:  { label: "Easy ✅",  bg: "#10b981" },
  };

  return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: "32px 20px" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}>
        <div>
          <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: 18, fontWeight: 700, color: "#e2e8f0" }}>
            {deck.problemName || "Untitled"}
          </h2>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "#64748b" }}>
            {index + 1} / {total} · {ratedCount} rated
          </span>
        </div>
        <button
          onClick={onFinish}
          style={{
            background: "none", border: "1px solid #1e1e30", borderRadius: 8,
            padding: "6px 14px", color: "#64748b", fontFamily: "'Syne', sans-serif", fontSize: 13,
          }}>
          Finish Early
        </button>
      </div>

      <ProgressBar current={ratedCount} total={total} />
      <div style={{ marginBottom: 28 }} />

      {/* Card */}
      <FlashCard key={cardKey.current} card={card} slideDir={slideDir} />

      {/* Rating buttons */}
      <div style={{ marginTop: 16, display: "flex", gap: 10, justifyContent: "center" }}>
        {Object.entries(RATING_CONFIG).map(([r, conf]) => {
          const rated = ratings[card.id] === r;
          return (
            <button
              key={r}
              className="btn-bounce"
              onClick={() => rate(r)}
              style={{
                flex: 1, maxWidth: 160, padding: "12px 8px",
                background: rated ? conf.bg : "#111118",
                border: `1px solid ${rated ? conf.bg : "#1e1e30"}`,
                borderRadius: 10, color: rated ? "#fff" : "#94a3b8",
                fontSize: 14, fontWeight: 600, fontFamily: "'Syne', sans-serif",
                transition: "all 0.15s",
              }}>
              {conf.label}
            </button>
          );
        })}
      </div>

      {/* Navigation */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 24, gap: 12 }}>
        <button
          onClick={() => go(-1)}
          disabled={index === 0}
          style={{
            background: "none", border: "1px solid #1e1e30", borderRadius: 10,
            padding: "10px 20px", color: index === 0 ? "#2a2a3a" : "#94a3b8",
            display: "flex", alignItems: "center", gap: 6,
            fontFamily: "'Syne', sans-serif", fontSize: 14,
            cursor: index === 0 ? "not-allowed" : "pointer",
          }}>
          <ChevronLeft size={16} /> Prev
        </button>

        {ratedCount === total && (
          <button
            onClick={onFinish}
            style={{
              flex: 1, background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
              border: "none", borderRadius: 10, padding: "10px 20px",
              color: "#fff", fontFamily: "'Syne', sans-serif", fontSize: 14, fontWeight: 700,
            }}>
            <CheckCircle size={15} style={{ display: "inline", marginRight: 6, verticalAlign: "middle" }} />
            See Summary
          </button>
        )}

        <button
          onClick={() => go(1)}
          disabled={index === total - 1}
          style={{
            background: "none", border: "1px solid #1e1e30", borderRadius: 10,
            padding: "10px 20px", color: index === total - 1 ? "#2a2a3a" : "#94a3b8",
            display: "flex", alignItems: "center", gap: 6,
            fontFamily: "'Syne', sans-serif", fontSize: 14,
            cursor: index === total - 1 ? "not-allowed" : "pointer",
          }}>
          Next <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

// ─── Summary Screen ───────────────────────────────────────────────────────────

function SummaryScreen({ deck, onReview, onNewSolution }) {
  const ratings = deck.ratings || {};
  const mastered = Object.values(ratings).filter((r) => r === "easy").length;
  const good     = Object.values(ratings).filter((r) => r === "good").length;
  const again    = Object.values(ratings).filter((r) => r === "again").length;
  const total    = deck.cards.length;

  const categoryScores = {};
  deck.cards.forEach((c) => {
    if (!categoryScores[c.category]) categoryScores[c.category] = { total: 0, mastered: 0 };
    categoryScores[c.category].total++;
    if (ratings[c.id] === "easy") categoryScores[c.category].mastered++;
  });
  const weakest = Object.entries(categoryScores)
    .sort((a, b) => (a[1].mastered / a[1].total) - (b[1].mastered / b[1].total))[0];

  const emoji = mastered === total ? "🏆" : mastered > total / 2 ? "🎯" : "📚";

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: "60px 20px", textAlign: "center" }}>
      <div style={{ fontSize: 52, marginBottom: 16 }}>{emoji}</div>
      <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: 28, fontWeight: 800, color: "#e2e8f0", marginBottom: 8 }}>
        Session Complete
      </h2>
      <p style={{ color: "#64748b", marginBottom: 40, fontFamily: "'Syne', sans-serif" }}>
        {deck.problemName || "Untitled"}
      </p>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 32 }}>
        {[
          { label: "Mastered", val: mastered, color: "#10b981" },
          { label: "Good",     val: good,     color: "#3b82f6" },
          { label: "Again",    val: again,    color: "#ef4444" },
        ].map(({ label, val, color }) => (
          <div key={label} style={{ background: "#111118", border: "1px solid #1e1e30", borderRadius: 14, padding: "20px 16px" }}>
            <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 32, fontWeight: 800, color }}>{val}</div>
            <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 12, color: "#64748b", marginTop: 4 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Weakest category */}
      {weakest && weakest[1].mastered < weakest[1].total && (
        <div style={{
          background: "#1a0f0f", border: "1px solid #ef444430",
          borderRadius: 14, padding: "16px 20px", marginBottom: 32, textAlign: "left",
        }}>
          <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 12, color: "#ef4444", fontWeight: 700, marginBottom: 6, textTransform: "uppercase" }}>
            Needs Focus
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <CategoryBadge category={weakest[0]} small />
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: "#94a3b8" }}>
              {weakest[1].mastered}/{weakest[1].total} mastered in this category
            </span>
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 12 }}>
        <button
          onClick={onReview}
          style={{
            flex: 1, padding: "14px 20px", background: "#111118",
            border: "1px solid #1e1e30", borderRadius: 12, color: "#a5b4fc",
            fontFamily: "'Syne', sans-serif", fontSize: 14, fontWeight: 700,
          }}>
          <RotateCcw size={15} style={{ display: "inline", marginRight: 6, verticalAlign: "middle" }} />
          Review Again
        </button>
        <button
          onClick={onNewSolution}
          style={{
            flex: 1, padding: "14px 20px",
            background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
            border: "none", borderRadius: 12, color: "#fff",
            fontFamily: "'Syne', sans-serif", fontSize: 14, fontWeight: 700,
          }}>
          <Plus size={15} style={{ display: "inline", marginRight: 6, verticalAlign: "middle" }} />
          Add Solution
        </button>
      </div>
    </div>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────

export default function LeetFlash() {
  const [view, setView] = useState("home");
  const [decks, setDecks] = useState([]);
  const [activeDeck, setActiveDeck] = useState(null);
  const [error, setError] = useState(null);
  const [apiKey, setApiKey] = useState("");
  const pendingRef = useRef(null);

  // Load saved data on mount
  useEffect(() => {
    const savedKey = localStorage.getItem("leetflash-groq-key");
    if (savedKey) setApiKey(savedKey);

    (async () => {
      try {
        const result = await storage.get("leetflash-decks");
        if (result) setDecks(JSON.parse(result.value));
      } catch (e) { /* no decks yet */ }
    })();
  }, []);

  function handleSaveApiKey(key) {
    setApiKey(key);
    localStorage.setItem("leetflash-groq-key", key);
  }

  async function persistDecks(updated) {
    setDecks(updated);
    try {
      await storage.set("leetflash-decks", JSON.stringify(updated));
    } catch (e) { console.error("Storage error:", e); }
  }

  async function handleGenerate(code, problemName, difficulty) {
    pendingRef.current = { code, problemName, difficulty };
    setError(null);
    setView("loading");

    try {
      const cards = await callGroq(apiKey, code, problemName, difficulty);
      const newDeck = {
        id: Date.now(),
        problemName: problemName || "Untitled",
        difficulty,
        createdAt: new Date().toISOString(),
        cards: cards.map((c, i) => ({ ...c, id: c.id ?? i + 1 })),
        ratings: {},
      };
      const updated = [newDeck, ...decks];
      await persistDecks(updated);
      setActiveDeck(newDeck);
      setView("review");
    } catch (e) {
      setError(e.message);
      setView("error");
    }
  }

  function handleRate(newRatings) {
    if (!activeDeck) return;
    const updatedDeck = { ...activeDeck, ratings: newRatings };
    setActiveDeck(updatedDeck);
    const updated = decks.map((d) => d.id === activeDeck.id ? updatedDeck : d);
    persistDecks(updated);
  }

  function handleLoadDeck(deck) {
    setActiveDeck({ ...deck, ratings: {} });
    setView("review");
  }

  return (
    <>
      <style>{GLOBAL_STYLES}</style>

      {/* Sticky Nav */}
      <div style={{
        borderBottom: "1px solid #111118", padding: "0 20px", height: 56,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        backdropFilter: "blur(10px)", position: "sticky", top: 0, zIndex: 100,
        background: "#0a0a0fcc",
      }}>
        <div
          style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}
          onClick={() => setView("home")}>
          <div style={{
            width: 30, height: 30,
            background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
            borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Zap size={14} color="#fff" />
          </div>
          <span style={{
            fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 16,
            background: "linear-gradient(90deg, #a5b4fc, #c084fc)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          }}>
            LeetFlash
          </span>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {decks.length > 0 && (
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "#4a4a6a" }}>
              {decks.length} deck{decks.length !== 1 ? "s" : ""}
            </span>
          )}
          <button
            onClick={() => setView("home")}
            style={{
              background: "none", border: "1px solid #1e1e30", borderRadius: 8,
              padding: "6px 14px", color: "#94a3b8",
              fontFamily: "'Syne', sans-serif", fontSize: 13,
              display: "flex", alignItems: "center", gap: 6,
            }}>
            <Plus size={14} /> New
          </button>
        </div>
      </div>

      {/* Screens */}
      <div style={{ minHeight: "calc(100vh - 56px)", background: "#0a0a0f" }}>
        {view === "home" && (
          <HomeScreen
            onGenerate={handleGenerate}
            decks={decks}
            onLoadDeck={handleLoadDeck}
            apiKey={apiKey}
            onSaveApiKey={handleSaveApiKey}
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
          <div style={{ maxWidth: 500, margin: "80px auto", padding: "0 20px", textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
            <h2 style={{ fontFamily: "'Syne', sans-serif", color: "#ef4444", marginBottom: 12 }}>
              API Error
            </h2>
            <p style={{
              color: "#64748b", fontFamily: "'JetBrains Mono', monospace",
              fontSize: 13, marginBottom: 28, lineHeight: 1.6,
            }}>
              {error}
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <button
                onClick={() => handleGenerate(
                  pendingRef.current?.code,
                  pendingRef.current?.problemName,
                  pendingRef.current?.difficulty,
                )}
                style={{
                  background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                  border: "none", borderRadius: 10, padding: "12px 28px",
                  color: "#fff", fontFamily: "'Syne', sans-serif",
                  fontSize: 14, fontWeight: 700,
                }}>
                <RotateCcw size={14} style={{ display: "inline", marginRight: 6, verticalAlign: "middle" }} />
                Retry
              </button>
              <button
                onClick={() => setView("home")}
                style={{
                  background: "none", border: "1px solid #1e1e30", borderRadius: 10,
                  padding: "12px 28px", color: "#94a3b8",
                  fontFamily: "'Syne', sans-serif", fontSize: 14,
                }}>
                Go Home
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
