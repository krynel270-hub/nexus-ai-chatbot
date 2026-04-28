const API_KEYS = [
  process.env.GEMINI_KEY_1 || "",
  process.env.GEMINI_KEY_2 || "",
  process.env.GEMINI_KEY_3 || "",
  process.env.GEMINI_KEY_4 || "",
  process.env.GEMINI_KEY_5 || "",
].filter(Boolean);

const MODEL = "gemini-1.5-flash-latest";
let failedKeys = new Set();
let currentKeyIndex = 0;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { messages, userMessage } = req.body;
    if (!userMessage || !messages) return res.status(400).json({ error: "Missing data" });
    if (API_KEYS.length === 0) return res.status(500).json({ error: "No API keys configured" });

    const reply = await callGemini(messages, userMessage);
    return res.status(200).json({
      success: true,
      reply,
      keyIndex: currentKeyIndex + 1,
      availableKeys: API_KEYS.length - failedKeys.size,
    });
  } catch (error) {
    console.error("Error:", error);
    return res.status(500).json({ error: error.message });
  }
}

async function callGemini(messages, userMessage, retryCount = 0) {
  if (retryCount >= API_KEYS.length) throw new Error("Semua API Key limit");

  const key = API_KEYS[currentKeyIndex];
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;

  const body = {
    system_instruction: { parts: [{ text: "Kamu adalah NexusAI, asisten cerdas dan membantu." }] },
    contents: [...messages, { role: "user", parts: [{ text: userMessage }] }],
    generationConfig: { temperature: 0.85, topK: 40, topP: 0.95, maxOutputTokens: 2048 },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
    ],
  };

  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

    if (res.status === 429 || res.status === 503) {
      failedKeys.add(currentKeyIndex);
      rotateKey();
      return callGemini(messages, userMessage, retryCount + 1);
    }

    if (res.status === 400 || res.status === 401 || res.status === 403) {
      failedKeys.add(currentKeyIndex);
      rotateKey();
      return callGemini(messages, userMessage, retryCount + 1);
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Error ${res.status}`);
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Empty response");
    return text;
  } catch (error) {
    failedKeys.add(currentKeyIndex);
    rotateKey();
    return callGemini(messages, userMessage, retryCount + 1);
  }
}

function rotateKey() {
  const original = currentKeyIndex;
  for (let i = 1; i <= API_KEYS.length; i++) {
    const next = (original + i) % API_KEYS.length;
    if (!failedKeys.has(next)) {
      currentKeyIndex = next;
      return;
    }
  }
    }
