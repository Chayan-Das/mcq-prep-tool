import clientPromise from "../../../lib/mongodb";
import { NextResponse } from "next/server";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// Gemini models (text)
const GEMINI_MODELS = [
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "gemini-4-hydrogen",
  "gemini-3.8-flash",
];

// Groq text models (fallback)
const GROQ_TEXT_MODELS = [
  "qwen/qwen3.8-27b",
  "qwen/qwen3-vl-30b-a3b-instruct",
  "qwen/qwen3-vl-8b-instruct",
];

function normalizeText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[।?!.,;:'"()\-–—]/g, "")
    .replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d)));
}

function buildPrompt(newList: string, existingList: string) {
  return `তুমি একজন বাংলাদেশি চাকরির পরীক্ষার প্রশ্ন বিশেষজ্ঞ।
নিচের নতুন প্রশ্নগুলো এবং ডাটাবেজের পুরনো প্রশ্নগুলো তুলনা করো।

শুধুমাত্র সেই নতুন প্রশ্নগুলোকে ডুপ্লিকেট বলবে যেগুলো:
- একই প্রশ্ন (শুধু শব্দ সাজানো বা সামান্য পরিবর্তন)
- অর্থ একই (semantic same)
- উত্তরও একই হবে এমন

শুধু JSON রিটার্ন করো, অন্য কিছু না:
{
  "duplicateIndices": [0, 2]
}

নতুন প্রশ্নসমূহ:
${newList}

ডাটাবেজের পুরনো প্রশ্ন (নমুনা):
${existingList}
`;
}

function extractJson(content: string): any | null {
  let cleaned = content
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1) return null;

  try {
    return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
  } catch {
    return null;
  }
}

async function tryGemini(
  prompt: string,
  newQuestionsLength: number,
): Promise<number[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("GEMINI_API_KEY missing → skipping Gemini");
    return [];
  }

  for (const model of GEMINI_MODELS) {
    try {
      const url = `${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`;

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 512,
          },
        }),
      });

      if (!response.ok) {
        console.warn(`[AI Dup Gemini] ${model} failed:`, response.status);
        continue;
      }

      const data = await response.json();
      const text =
        data.candidates?.[0]?.content?.parts?.[0]?.text ||
        data.candidates?.[0]?.content?.parts
          ?.map((p: any) => p.text)
          .join("") ||
        "";

      const parsed = extractJson(text);
      if (!parsed) continue;

      const indices = Array.isArray(parsed.duplicateIndices)
        ? parsed.duplicateIndices
            .map((n: unknown) => Number(n))
            .filter(
              (n: number) =>
                Number.isInteger(n) && n >= 0 && n < newQuestionsLength,
            )
        : [];

      console.log(
        `[AI Dup Gemini] ${model} found ${indices.length} semantic duplicates`,
      );
      return indices;
    } catch (err) {
      console.error(`[AI Dup Gemini] ${model} exception:`, err);
    }
  }

  return [];
}

async function tryGroq(
  prompt: string,
  newQuestionsLength: number,
): Promise<number[]> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.warn("GROQ_API_KEY missing → skipping Groq");
    return [];
  }

  for (const model of GROQ_TEXT_MODELS) {
    try {
      const response = await fetch(GROQ_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.1,
          max_tokens: 512,
        }),
      });

      if (!response.ok) {
        console.warn(`[AI Dup Groq] ${model} failed:`, response.status);
        continue;
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || "";
      const parsed = extractJson(content);
      if (!parsed) continue;

      const indices = Array.isArray(parsed.duplicateIndices)
        ? parsed.duplicateIndices
            .map((n: unknown) => Number(n))
            .filter(
              (n: number) =>
                Number.isInteger(n) && n >= 0 && n < newQuestionsLength,
            )
        : [];

      console.log(
        `[AI Dup Groq] ${model} found ${indices.length} semantic duplicates`,
      );
      return indices;
    } catch (err) {
      console.error(`[AI Dup Groq] ${model} exception:`, err);
    }
  }

  return [];
}

async function aiSemanticCheck(
  newQuestions: string[],
  existingQuestions: string[],
): Promise<number[]> {
  if (newQuestions.length === 0 || existingQuestions.length === 0) {
    return [];
  }

  const existingSample = existingQuestions.slice(0, 80);

  const newList = newQuestions.map((q, i) => `[${i}] ${q}`).join("\n");
  const existingList = existingSample.map((q, i) => `[E${i}] ${q}`).join("\n");

  const prompt = buildPrompt(newList, existingList);

  // 1. Gemini primary
  const geminiResult = await tryGemini(prompt, newQuestions.length);
  if (geminiResult.length > 0 || process.env.GEMINI_API_KEY) {
    // Gemini কাজ করেছে বা key আছে → result রিটার্ন (খালি হলেও)
    if (geminiResult.length > 0) return geminiResult;
  }

  // 2. Groq fallback
  console.warn("Gemini failed or empty → falling back to Groq");
  return await tryGroq(prompt, newQuestions.length);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const questions: string[] = body.questions || [];
    const useAI: boolean = body.useAI !== false; // default true

    if (!Array.isArray(questions) || questions.length === 0) {
      return NextResponse.json({ success: true, duplicateIndices: [] });
    }

    const client = await clientPromise;
    const db = client.db("mcq_database");
    const existingDocs = await db
      .collection("questions")
      .find({}, { projection: { question: 1, normalized_question: 1 } })
      .toArray();

    const existingNormalized = existingDocs.map((doc) =>
      doc.normalized_question
        ? String(doc.normalized_question)
        : normalizeText(String(doc.question || "")),
    );
    const existingSet = new Set<string>(existingNormalized);
    const existingRaw = existingDocs.map((doc) => String(doc.question || ""));

    // 1) Exact + normalized check (fast)
    const seenInBatch = new Set<string>();
    const exactDuplicateIndices: number[] = [];
    const nonExactQuestions: string[] = [];
    const nonExactOriginalIndices: number[] = [];

    questions.forEach((q, idx) => {
      const norm = normalizeText(q || "");
      if (existingSet.has(norm) || seenInBatch.has(norm)) {
        exactDuplicateIndices.push(idx);
      } else {
        seenInBatch.add(norm);
        nonExactQuestions.push(q);
        nonExactOriginalIndices.push(idx);
      }
    });

    // 2) AI semantic check
    let semanticDuplicateIndices: number[] = [];
    if (useAI && nonExactQuestions.length > 0 && existingRaw.length > 0) {
      const relativeIndices = await aiSemanticCheck(
        nonExactQuestions,
        existingRaw,
      );
      semanticDuplicateIndices = relativeIndices.map(
        (rel) => nonExactOriginalIndices[rel],
      );
    }

    const allDuplicates = Array.from(
      new Set([...exactDuplicateIndices, ...semanticDuplicateIndices]),
    ).sort((a, b) => a - b);

    return NextResponse.json({
      success: true,
      duplicateIndices: allDuplicates,
      exactCount: exactDuplicateIndices.length,
      semanticCount: semanticDuplicateIndices.length,
    });
  } catch (err) {
    console.error("check-duplicates error:", err);
    return NextResponse.json({ success: false, duplicateIndices: [] });
  }
}
