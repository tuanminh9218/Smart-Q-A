import express from "express";
import path from "path";
import multer from "multer";
import { GoogleGenAI, Type } from "@google/genai";
import * as mammoth from "mammoth";
import { createServer as createViteServer } from "vite";
import stringSimilarity from "string-similarity";
import { jsonrepair } from 'jsonrepair';
import { PDFParse } from "pdf-parse";

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Configure multer to use memory storage
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { 
    fileSize: 50 * 1024 * 1024, // 50MB limit
    fieldSize: 100 * 1024 * 1024 // 100MB limit for fields like knowledgeBase
  }
});

import fs from 'fs';

// Initialize Custom API Keys
let customApiKeys: string[] = [];
const KEYS_FILE = path.join(process.cwd(), 'api-keys.json');

try {
  if (fs.existsSync(KEYS_FILE)) {
    customApiKeys = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf-8'));
  }
} catch (e) {
  console.log("No custom keys found");
}

function saveKeys() {
  try {
    fs.writeFileSync(KEYS_FILE, JSON.stringify(customApiKeys));
  } catch(e) {
    console.error("Failed to save keys to disk:", e);
  }
}

// Global rotation state
let currentKeyIndex = 0;
let currentModelIndex = 0;

const MODELS_TO_TRY = [
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-3.1-pro-preview",
  "gemini-3-flash",
  "gemini-3.1-flash-lite"
];

// Helper for model fallback on 429 errors
async function generateWithFallback(parts: any[], config: any = {}) {
  const allKeys = customApiKeys.length > 0 ? customApiKeys : [process.env.GEMINI_API_KEY || ""];
  
  // Safety bounds
  if (currentKeyIndex >= allKeys.length) currentKeyIndex = 0;
  if (currentModelIndex >= MODELS_TO_TRY.length) currentModelIndex = 0;

  let attempts = 0;
  const maxAttempts = allKeys.length * MODELS_TO_TRY.length;
  let lastError = null;
  let backoffDelay = 2000;

  while (attempts < maxAttempts) {
    const activeKey = allKeys[currentKeyIndex];
    const activeModel = MODELS_TO_TRY[currentModelIndex];
    if (!activeKey) {
      // Move to next key if this one is empty
      currentKeyIndex = (currentKeyIndex + 1) % allKeys.length;
      attempts++;
      continue;
    }

    const dynamicAi = new GoogleGenAI({
      apiKey: activeKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
    });

    try {
      // Bắt buộc đợi từ 1.5s đến 2s để giả lập người dùng thật
      const baseDelay = Math.floor(Math.random() * 500) + 1500;
      await new Promise(resolve => setTimeout(resolve, baseDelay));

      console.log(`Attempting Gemini request with model: ${activeModel} and key ending in: ${activeKey.slice(-5)}`);
      const response = await dynamicAi.models.generateContent({
        model: activeModel,
        contents: { parts },
        config: config
      });
      return { response, usedKey: activeKey, usedModel: activeModel };
    } catch (error: any) {
      lastError = error;
      const isQuotaError = error.status === 429 || 
                          (error.message && (error.message.includes("429") || error.message.includes("Too Many Requests") || error.message.includes("Resource has been exhausted")));
      
      if (isQuotaError) {
        console.warn(`Quota exceeded for model ${activeModel} with key ${activeKey.slice(-5)}.`);
        console.log(`Applying exponential backoff: waiting ${backoffDelay}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
        backoffDelay *= 2; // Tăng thời gian chờ (exponential backoff)

        currentModelIndex++;
        if (currentModelIndex >= MODELS_TO_TRY.length) {
          currentModelIndex = 0;
          currentKeyIndex = (currentKeyIndex + 1) % allKeys.length;
        }
        attempts++;
        continue;
      }
      // If it's not a quota error, throw it immediately
      throw error;
    }
  }
  throw new Error("Tất cả các API Key và Model đều đã hết Quota (Lỗi 429). Vui lòng thêm API Key mới.");
}

// Admin API Routes for Keys
app.get('/api/admin/keys', (req, res) => {
  res.json({ keys: customApiKeys.map(k => '*'.repeat(k.length - 5) + k.slice(-5)) });
});

app.post('/api/admin/keys/add', express.json(), (req, res) => {
  const { key } = req.body;
  if (!key) return res.status(400).json({error: "No key provided"});
  if (!customApiKeys.includes(key)) {
    customApiKeys.push(key);
    saveKeys();
  }
  res.json({ success: true, keys: customApiKeys.map(k => '*'.repeat(k.length - 5) + k.slice(-5)) });
});

app.delete('/api/admin/keys/:suffix', (req, res) => {
  const suffix = req.params.suffix;
  customApiKeys = customApiKeys.filter(k => k.slice(-5) !== suffix);
  saveKeys();
  res.json({ success: true, keys: customApiKeys.map(k => '*'.repeat(k.length - 5) + k.slice(-5)) });
});

// API Routes

// 1. Extract Q&A pairs from a document or image
app.post("/api/extract", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    const mimeType = file.mimetype;
    let parts: any[] = [];
    
    // 1. Dùng pdf-parse nếu là PDF (để lấy text trực tiếp sẽ nhanh và chính xác hơn cho file nhiều chữ)
    if (mimeType === "application/pdf" || file.originalname.endsWith('.pdf')) {
      try {
        const parser = new PDFParse({ data: file.buffer });
        const data = await parser.getText();
        if (data.text.trim().length < 100) {
          throw new Error("Text content too short, likely a scanned PDF.");
        }
        parts.push({ text: `Nội dung tài liệu PDF:\n${data.text}` });
      } catch (e) {
        console.warn("pdf-parse failed, falling back to Gemini multimodal:", e);
        // Fallback to Gemini's native PDF support
        parts.push({
          inlineData: {
            mimeType: mimeType,
            data: file.buffer.toString("base64"),
          }
        });
      }
    } else if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || file.originalname.endsWith('.docx')) {
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      parts.push({ text: `Document content:\n${result.value}` });
    } else if (mimeType === "text/plain") {
      parts.push({ text: `Document content:\n${file.buffer.toString("utf8")}` });
    } else {
      // For images
      parts.push({
        inlineData: {
          mimeType: mimeType,
          data: file.buffer.toString("base64"),
        }
      });
    }

    const basePrompt = `Trích xuất tất cả các cặp câu hỏi và câu trả lời từ tài liệu được cung cấp (đặc biệt là từ file PDF hoặc hình ảnh).
    Quy tắc định dạng quan trọng:
    - Đối với các câu hỏi trắc nghiệm có các đáp án dạng (A, B, C, D), HÃY CHÚ Ý ĐẶC BIỆT ĐẾN MÀU SẮC.
    - Đáp án đúng chính là đáp án CÓ MÀU SẮC KHÁC BIỆT so với các đáp án còn lại (ví dụ chữ màu đỏ, màu xanh, hoặc được tô sáng).
    - CHỈ trích xuất nội dung của Câu hỏi và CÂU TRẢ LỜI ĐÚNG cho mỗi mục. Tuyệt đối không bao gồm các phương án sai.
    - Trong câu trả lời đúng, phải giữ lại định dạng chữ cái của phương án (ví dụ: A, B, C, D) (Ví dụ: "A. Nội dung đáp án...").
    - Giữ nguyên văn phong tiếng Việt.
    `;
    
    const lastQuestion = req.body.lastQuestion || "";
    let currentPrompt = basePrompt;
    
    if (lastQuestion) {
      currentPrompt += `\n\nLƯU Ý QUAN TRỌNG: Hãy tiếp tục trích xuất tối đa 80 câu hỏi tiếp theo. BẮT ĐẦU từ câu hỏi ngay sau câu hỏi này: "${lastQuestion}". Nếu đã trích xuất hết toàn bộ tài liệu và không còn câu hỏi nào, hãy trả về mảng rỗng [].`;
    } else {
      currentPrompt += `\n\nHãy trích xuất tối đa 80 câu hỏi đầu tiên. Nếu tài liệu không có nội dung, hãy trả về mảng rỗng [].`;
    }

    const currentParts = [...parts, { text: currentPrompt }];

    const fallbackResult = await generateWithFallback(currentParts, {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            question: {
              type: Type.STRING,
              description: "The extracted question."
            },
            answer: {
              type: Type.STRING,
              description: "The correct extracted answer."
            }
          },
        }
      }
    });
    
    const response = fallbackResult.response;

    const textRes = response.text || "[]";
    let qaPairs = [];
    try {
      qaPairs = JSON.parse(jsonrepair(textRes));
    } catch (e: any) {
      console.warn("Could not repair JSON:", e);
      throw new Error(`Đã trích xuất một phần tài liệu nhưng có đoạn văn bản không đọc được lỗi xảy ra.`);
    }

    const sourceDetail = file?.originalname || "Không rõ nguồn";
    const enhancedQaPairs = qaPairs.map((p: any) => ({ ...p, sourceDetail }));

    res.json({ success: true, data: enhancedQaPairs, usedKey: fallbackResult.usedKey, usedModel: fallbackResult.usedModel });
  } catch (error: any) {
    console.error("Extraction error:", error);
    if (error.status === 503 || error?.status === 'UNAVAILABLE' || (error.message && error.message.includes('503'))) {
      return res.status(503).json({ error: "Hệ thống AI hiện đang quá tải (High demand). Vui lòng thử lại sau giây lát." });
    }
    res.status(500).json({ error: "Failed to extract text. Note that large PDFs > 20MB might not process well. Detailed error: " + error.message });
  }
});

// 2. Query within Knowledge Base
app.post("/api/query", upload.single("image"), async (req, res) => {
  try {
    const { queryText, knowledgeBase } = req.body;
    let kb: any[] = [];
    try {
      kb = JSON.parse(knowledgeBase || "[]");
    } catch(e) {}

    const file = req.file;
    let extractedQuestions: string[] = [];
    
    let usedKey;
    let usedModel;

    // Step 1: If there's an image, extract text using Gemini
    if (file) {
      const parts = [
        {
          inlineData: {
            mimeType: file.mimetype,
            data: file.buffer.toString("base64")
          }
        },
        { text: "Hình ảnh này có thể chứa một hoặc nhiều câu hỏi. Trích xuất tất cả các câu hỏi một cách chính xác." }
      ];

      const fallbackResult = await generateWithFallback(parts, {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.STRING
          }
        }
      });
      usedKey = fallbackResult.usedKey;
      usedModel = fallbackResult.usedModel;
      const extractResponse = fallbackResult.response;
      try {
        extractedQuestions = JSON.parse(jsonrepair(extractResponse.text || "[]"));
      } catch (e) {
        extractedQuestions = [];
      }
    } else if (queryText) {
      extractedQuestions = [queryText];
    }

    if (!extractedQuestions || extractedQuestions.length === 0) {
      return res.status(400).json({ error: "Yêu cầu cung cấp chữ hoặc ảnh." });
    }

    // Step 2: Use string-similarity to find the best match in KB
    const results = extractedQuestions.map((extractedText: string) => {
      let result = {
        foundInKb: false,
        answer: "",
        extractedQuestion: extractedText,
        matchedQuestionFromKb: "",
        sourceDetail: ""
      };

      if (kb.length > 0) {
        const questions = kb.map(item => item.question || "");
        const match = stringSimilarity.findBestMatch(extractedText, questions);
        const bestMatch = match.bestMatch;

        // Threshold for acceptable match
        if (bestMatch.rating >= 0.8) {
          const matchedItem = kb[match.bestMatchIndex];
          result.foundInKb = true;
          
          let answerText = matchedItem.answer || "";
          // Validate answer format if possible
          if (!answerText.match(/^[A-D]\s*-/)) {
             // Enforce formatting if it just starts with a letter
             const letterMatch = answerText.match(/^([A-D])[\.\:]?\s*(.*)/i);
             if (letterMatch) {
               answerText = `${letterMatch[1].toUpperCase()} - ${letterMatch[2]}`;
             }
          }
          
          result.answer = answerText;
          result.matchedQuestionFromKb = matchedItem.question;
          result.sourceDetail = matchedItem.sourceDetail || "";
        }
      }
      return result;
    });

    res.json({ 
      results,
      usedKey,
      usedModel
    });
  } catch (error: any) {
    console.error("Query error:", error);
    if (error.status === 503 || error?.status === 'UNAVAILABLE' || (error.message && error.message.includes('503'))) {
      return res.status(503).json({ error: "Hệ thống AI hiện đang quá tải (High demand). Vui lòng thử lại sau giây lát." });
    }
    res.status(500).json({ error: error.message || "Failed to process query." });
  }
});

// 3. Ask AI fallback
app.post("/api/ask-ai", upload.single("image"), async (req, res) => {
  try {
    const { queryText } = req.body;
    const file = req.file;

    let parts: any[] = [];
    
    if (file) {
       parts.push({
         inlineData: {
           mimeType: file.mimetype,
           data: file.buffer.toString("base64")
         }
       });
       parts.push({ text: "Hãy trả lời câu hỏi hiển thị trong ảnh này một cách chính xác nhất." });
    }
    if (queryText) {
       parts.push({ text: `Câu hỏi: ${queryText}` });
       if (!file) parts.push({ text: "Hãy phân tích và trả lời câu hỏi này một cách chính xác nhất bằng tiếng Việt."});
    }

    const fallbackResult = await generateWithFallback(parts);

    res.json({ answer: fallbackResult.response.text, usedKey: fallbackResult.usedKey, usedModel: fallbackResult.usedModel });
  } catch(error: any) {
    console.error("AI Answer error:", error);
    if (error.status === 503 || error?.status === 'UNAVAILABLE' || (error.message && error.message.includes('503'))) {
      return res.status(503).json({ error: "Hệ thống AI hiện đang quá tải (High demand). Vui lòng thử lại sau giây lát." });
    }
    res.status(500).json({ error: error.message || "Failed to answer with AI." });
  }
});


// Vite Middleware integration for development and production serving
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    // Development mode
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Production mode
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Error handling middleware
  app.use((err: any, req: any, res: any, next: any) => {
    console.error("Global error:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
