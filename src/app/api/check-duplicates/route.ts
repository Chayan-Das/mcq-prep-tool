import clientPromise from "../../../lib/mongodb";
import { NextResponse } from "next/server";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// Gemini models (text) — আগের model fallback তালিকা অপরিবর্তিত রাখা হয়েছে।
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

const MAX_AI_EXISTING_QUESTIONS = 80;

type MatchType = "exact" | "semantic";

type MatchPair = {
  newIndex: number;
  existingIndex: number;
};

type ExistingQuestion = {
  question: string;
  options: string[];
  correct_answer_index: number;
  subject?: string;
  topic?: string;
  sub_topic?: string;
  exam_taker?: string;
  matchType: MatchType;
};

type DuplicateMatch = {
  index: number;
  existing: ExistingQuestion;
};

/**
 * প্রশ্ন normalize করে exact/near-exact duplicate খুঁজে বের করে।
 * বাংলা ও ইংরেজি ডিজিট, punctuation এবং অতিরিক্ত whitespace সামলায়।
 */
function normalizeText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[।?!.,;:'"()\-–—]/g, "")
    .replace(/[০-৯]/g, (digit) =>
      String("০১২৩৪৫৬৭৮৯".indexOf(digit)),
    );
}

/** AI-কে নতুন প্রশ্নের সঙ্গে database প্রশ্নের index মিলিয়ে দিতে বলা হয়। */
function buildPrompt(newList: string, existingList: string): string {
  return `তুমি একজন বাংলাদেশি চাকরির পরীক্ষার প্রশ্ন বিশেষজ্ঞ।
নিচের নতুন প্রশ্নগুলো এবং ডাটাবেজের পুরনো প্রশ্নগুলো মনোযোগ দিয়ে তুলনা করো।

শুধুমাত্র সেই নতুন প্রশ্নগুলোকে ডুপ্লিকেট বলবে যেগুলো:
- একই প্রশ্ন, শুধু শব্দের সাজানো বা সামান্য ভাষাগত পার্থক্য আছে; অথবা
- প্রশ্নের অর্থ একই (semantic same); এবং
- প্রশ্ন দুটির সঠিক উত্তর একই হবে।

শুধু একই বিষয় বা একই topic হলেই ডুপ্লিকেট বলবে না।
নিশ্চিত মিল না পেলে ডুপ্লিকেট বলবে না।

প্রতিটি ডুপ্লিকেটের ক্ষেত্রে নতুন প্রশ্নের index (newIndex) এবং যে পুরনো প্রশ্নটির সঙ্গে মিলেছে তার E-index (existingIndex) দেবে।
একটি নতুন প্রশ্নের জন্য সবচেয়ে কাছের একটি পুরনো প্রশ্ন নির্বাচন করবে।
শুধু valid JSON রিটার্ন করবে, অন্য কোনো লেখা নয়:
{
  "matches": [
    { "newIndex": 0, "existingIndex": 2 }
  ]
}

নতুন প্রশ্নসমূহ:
${newList}

ডাটাবেজের পুরনো প্রশ্নসমূহ:
${existingList}
`;
}

/** AI response-এর JSON অংশ বের করে। */
function extractJson(content: string): any | null {
  const cleaned = content
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1) {
    return null;
  }

  try {
    return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
  } catch {
    return null;
  }
}

/** AI-এর দেওয়া index valid range-এর মধ্যে আছে কি না যাচাই করে। */
function parseMatches(
  parsed: any,
  newQuestionsLength: number,
  existingQuestionsLength: number,
): MatchPair[] {
  if (!Array.isArray(parsed?.matches)) {
    return [];
  }

  const validMatches = parsed.matches
    .map((match: any) => ({
      newIndex: Number(match?.newIndex),
      existingIndex: Number(match?.existingIndex),
    }))
    .filter(
      (match: MatchPair) =>
        Number.isInteger(match.newIndex) &&
        match.newIndex >= 0 &&
        match.newIndex < newQuestionsLength &&
        Number.isInteger(match.existingIndex) &&
        match.existingIndex >= 0 &&
        match.existingIndex < existingQuestionsLength,
    );

  // একই নতুন প্রশ্নের একাধিক match এলে প্রথম valid match রাখা হয়।
  const uniqueByNewIndex = new Map<number, MatchPair>();
  for (const match of validMatches) {
    if (!uniqueByNewIndex.has(match.newIndex)) {
      uniqueByNewIndex.set(match.newIndex, match);
    }
  }

  return Array.from(uniqueByNewIndex.values());
}

/** Gemini primary provider. null মানে Gemini-তে valid response পাওয়া যায়নি। */
async function tryGemini(
  prompt: string,
  newQuestionsLength: number,
  existingQuestionsLength: number,
): Promise<MatchPair[] | null> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.warn("GEMINI_API_KEY missing → skipping Gemini");
    return null;
  }

  for (const model of GEMINI_MODELS) {
    try {
      const url = `${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 1024,
          },
        }),
      });

      if (!response.ok) {
        console.warn(
          `[AI Dup Gemini] ${model} failed:`,
          response.status,
        );
        continue;
      }

      const data = await response.json();
      const responseText =
        data.candidates?.[0]?.content?.parts
          ?.map((part: any) => part.text || "")
          .join("") || "";

      const parsed = extractJson(responseText);
      if (!parsed) {
        continue;
      }

      const matches = parseMatches(
        parsed,
        newQuestionsLength,
        existingQuestionsLength,
      );

      console.log(
        `[AI Dup Gemini] ${model} found ${matches.length} semantic matches`,
      );

      // Valid JSON-এ empty matches থাকলেও Gemini সফলভাবে উত্তর দিয়েছে।
      return matches;
    } catch (error) {
      console.error(`[AI Dup Gemini] ${model} exception:`, error);
    }
  }

  return null;
}

/** Gemini ব্যর্থ/অনুপলব্ধ হলে Groq fallback চলে। */
async function tryGroq(
  prompt: string,
  newQuestionsLength: number,
  existingQuestionsLength: number,
): Promise<MatchPair[]> {
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
          max_tokens: 1024,
        }),
      });

      if (!response.ok) {
        console.warn(
          `[AI Dup Groq] ${model} failed:`,
          response.status,
        );
        continue;
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || "";
      const parsed = extractJson(content);

      if (!parsed) {
        continue;
      }

      const matches = parseMatches(
        parsed,
        newQuestionsLength,
        existingQuestionsLength,
      );

      console.log(
        `[AI Dup Groq] ${model} found ${matches.length} semantic matches`,
      );

      return matches;
    } catch (error) {
      console.error(`[AI Dup Groq] ${model} exception:`, error);
    }
  }

  return [];
}

/** Gemini primary → Groq fallback semantic duplicate check. */
async function aiSemanticCheck(
  newQuestions: string[],
  existingQuestions: string[],
): Promise<MatchPair[]> {
  if (newQuestions.length === 0 || existingQuestions.length === 0) {
    return [];
  }

  // আগের implementation-এর মতো AI prompt-এ সর্বোচ্চ ৮০টি পুরনো প্রশ্ন যায়।
  const existingSample = existingQuestions.slice(
    0,
    MAX_AI_EXISTING_QUESTIONS,
  );

  const newList = newQuestions
    .map((question, index) => `[${index}] ${question}`)
    .join("\n");

  const existingList = existingSample
    .map((question, index) => `[E${index}] ${question}`)
    .join("\n");

  const prompt = buildPrompt(newList, existingList);

  // 1) Gemini primary
  const geminiResult = await tryGemini(
    prompt,
    newQuestions.length,
    existingSample.length,
  );

  if (geminiResult !== null) {
    return geminiResult;
  }

  // 2) Gemini unavailable/failed হলে Groq fallback
  console.warn("Gemini failed or unavailable → falling back to Groq");

  return await tryGroq(
    prompt,
    newQuestions.length,
    existingSample.length,
  );
}

/** Database document থেকে UI-তে দেখানোর জন্য নিরাপদ match object বানায়। */
function toExistingQuestion(
  doc: any,
  matchType: MatchType,
): ExistingQuestion {
  return {
    question: String(doc.question || ""),
    options: Array.isArray(doc.options)
      ? doc.options.map((option: unknown) => String(option ?? ""))
      : [],
    correct_answer_index: Number.isInteger(Number(doc.correct_answer_index))
      ? Number(doc.correct_answer_index)
      : -1,
    subject: doc.subject ? String(doc.subject) : undefined,
    topic: doc.topic ? String(doc.topic) : undefined,
    sub_topic: doc.sub_topic ? String(doc.sub_topic) : undefined,
    exam_taker: doc.exam_taker ? String(doc.exam_taker) : undefined,
    matchType,
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const questions: string[] = body.questions || [];
    const useAI: boolean = body.useAI !== false; // default true

    if (!Array.isArray(questions) || questions.length === 0) {
      return NextResponse.json({
        success: true,
        duplicateIndices: [],
        duplicateMatches: [],
        exactCount: 0,
        semanticCount: 0,
        batchDuplicateIndices: [],
      });
    }

    // Empty/non-string input বাদ দিয়ে original index অক্ষুণ্ণ রাখা।
    const validQuestions = questions.map((question) =>
      typeof question === "string" ? question : String(question ?? ""),
    );

    const client = await clientPromise;
    const db = client.db("mcq_database");

    // পুরোনো প্রশ্নের সঙ্গে comparison এবং review UI-তে দেখানোর জন্য প্রয়োজনীয় field।
    const existingDocs = await db
      .collection("questions")
      .find(
        {},
        {
          projection: {
            question: 1,
            normalized_question: 1,
            options: 1,
            correct_answer_index: 1,
            subject: 1,
            topic: 1,
            sub_topic: 1,
            exam_taker: 1,
          },
        },
      )
      .toArray();

    // normalized question → database document index
    const existingByNormalized = new Map<string, number>();
    const existingRaw = existingDocs.map((doc) =>
      String(doc.question || ""),
    );

    existingDocs.forEach((doc, index) => {
      const normalized = doc.normalized_question
        ? String(doc.normalized_question)
        : normalizeText(String(doc.question || ""));

      if (normalized && !existingByNormalized.has(normalized)) {
        existingByNormalized.set(normalized, index);
      }
    });

    const duplicateMatches = new Map<number, ExistingQuestion>();
    const seenInBatch = new Map<string, number>();
    const exactDuplicateIndices: number[] = [];
    const batchDuplicateIndices: number[] = [];
    const nonExactQuestions: string[] = [];
    const nonExactOriginalIndices: number[] = [];

    // 1) Exact/normalized database duplicate + same-upload batch duplicate check
    validQuestions.forEach((question, index) => {
      const normalized = normalizeText(question || "");

      if (!normalized) {
        return;
      }

      const existingIndex = existingByNormalized.get(normalized);

      if (existingIndex !== undefined) {
        const existingDoc = existingDocs[existingIndex];

        duplicateMatches.set(
          index,
          toExistingQuestion(existingDoc, "exact"),
        );
        exactDuplicateIndices.push(index);
        return;
      }

      // একই batch-এ আগে আসা প্রশ্নের সঙ্গে মিল; database duplicate নয়।
      if (seenInBatch.has(normalized)) {
        batchDuplicateIndices.push(index);
        return;
      }

      seenInBatch.set(normalized, index);
      nonExactQuestions.push(question);
      nonExactOriginalIndices.push(index);
    });

    // 2) AI semantic check — কেবল exact match নয় এমন প্রশ্নের জন্য।
    let semanticDuplicateIndices: number[] = [];

    if (useAI && nonExactQuestions.length > 0 && existingRaw.length > 0) {
      const semanticMatches = await aiSemanticCheck(
        nonExactQuestions,
        existingRaw,
      );

      semanticMatches.forEach(({ newIndex, existingIndex }) => {
        const originalQuestionIndex = nonExactOriginalIndices[newIndex];
        const existingDoc = existingDocs[existingIndex];

        if (
          originalQuestionIndex === undefined ||
          !existingDoc ||
          duplicateMatches.has(originalQuestionIndex)
        ) {
          return;
        }

        duplicateMatches.set(
          originalQuestionIndex,
          toExistingQuestion(existingDoc, "semantic"),
        );
        semanticDuplicateIndices.push(originalQuestionIndex);
      });
    }

    // 3) UI-তে ব্যবহারের জন্য আগের response field duplicateIndices বজায় রাখা।
    const duplicateMatchesArray: DuplicateMatch[] = Array.from(
      duplicateMatches.entries(),
    )
      .map(([index, existing]) => ({ index, existing }))
      .sort((a, b) => a.index - b.index);

    const duplicateIndices = duplicateMatchesArray.map(
      (match) => match.index,
    );

    return NextResponse.json({
      success: true,
      duplicateIndices,
      duplicateMatches: duplicateMatchesArray,
      exactCount: exactDuplicateIndices.length,
      semanticCount: semanticDuplicateIndices.length,
      // একই আপলোড batch-এর duplicate আলাদা field-এ ফেরত যায়,
      // যাতে এগুলোকে ভুল করে database-এ আগে থেকে থাকা প্রশ্ন বলা না হয়।
      batchDuplicateIndices,
    });
  } catch (error) {
    console.error("check-duplicates error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "ডুপ্লিকেট যাচাই করার সময় সার্ভারে সমস্যা হয়েছে।",
        duplicateIndices: [],
        duplicateMatches: [],
        exactCount: 0,
        semanticCount: 0,
        batchDuplicateIndices: [],
      },
      { status: 500 },
    );
  }
}
