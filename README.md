# ⚡ LeetFlash

Turn your LeetCode solutions into spaced-repetition flashcards using Claude AI.

## Setup (takes ~1 minute)

### 1. Install dependencies
```bash
npm install
```

### 2. Run the dev server
```bash
npm run dev
```

Then open **http://localhost:5173** in your browser.

### 3. Add your API key
- Go to [console.anthropic.com](https://console.anthropic.com) and create an API key
- Paste it into the **API Key** field at the top of the app
- It's saved in localStorage — you only do this once

## Usage

1. Paste your LeetCode solution (any language)
2. Optionally add the problem name and difficulty
3. Click **Generate Flashcards**
4. Flip cards, rate yourself (Again / Good / Easy)
5. Check your summary and focus areas

## Build for production
```bash
npm run build
```

## Tech Stack
- React 18 + Vite
- Claude API (`claude-sonnet-4-20250514`)
- Lucide React icons
- Google Fonts: JetBrains Mono + Syne
- No other dependencies!
