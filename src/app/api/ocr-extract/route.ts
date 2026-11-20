import { NextResponse } from "next/server";
import clientPromise from "../../../lib/mongodb";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// Groq base64 ছবির সীমা ~4MB, তাই মূল ফাইল ~3MB এর নিচে রাখা হলো
const MAX_FILE_BYTES = 3 * 1024 * 1024;

// Gemini প্রাইমারি মডেল (ভিশন ভালো)
const GEMINI_MODELS = [
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "gemini-4-hydrogen",
  "gemini-3.8-flash",
];

// Groq ফলব্যাক মডেল
const GROQ_MODELS = [
  "qwen/qwen3.8-27b",
  "qwen/qwen3-vl-30b-a3b-instruct",
  "qwen/qwen3-vl-8b-instruct",
];

interface RawQuestion {
  question?: unknown;
  options?: unknown;
  correct_answer_index?: unknown;
  subject?: unknown;
  topic?: unknown;
  sub_topic?: unknown;
  exam_taker?: unknown;
}

interface ExistingTaxonomy {
  subjects: string[];
  topics: string[];
  subTopics: string[];
}

function cleanQuestions(
  list: RawQuestion[],
  defaultSubject: string
) {
  return list
    .filter((q) => typeof q?.question === "string" && q.question.trim() !== "")
    .map((q) => {
      const options = Array.isArray(q.options)
        ? q.options.map((o) => String(o ?? "").trim())
        : [];
      while (options.length < 4) options.push("");
      const idx = Number(q.correct_answer_index);

      // exam_taker: শুধুমাত্র ছবিতে থাকলেই রাখব, ডিফল্ট দিব না
      const examTakerRaw = String(q.exam_taker ?? "").trim();

      return {
        question: String(q.question).trim(),
        options: options.slice(0, 4),
        correct_answer_index:
          Number.isInteger(idx) && idx >= 0 && idx <= 3 ? idx : 0,
        subject: String(q.subject || defaultSubject || "").trim(),
        topic: String(q.topic || "").trim(),
        sub_topic: String(q.sub_topic || "").trim(),
        exam_taker: examTakerRaw, // খালি থাকলে খালিই থাকবে
      };
    });
}

function buildPrompt(
  defaultSubject: string,
  existing: ExistingTaxonomy
) {
  const subjectList =
    existing.subjects.length > 0
      ? existing.subjects.slice(0, 80).join(" | ")
      : "বাংলা | ইংরেজি | গণিত | সাধারণ জ্ঞান | বিজ্ঞান | বাংলাদেশ বিষয়াবলি | আন্তর্জাতিক বিষয়াবলি";

  const topicList =
    existing.topics.length > 0
      ? existing.topics.slice(0, 120).join(" | ")
      : "(এখনো কোনো টপিক নেই — প্রশ্নের বিষয়বস্তু অনুযায়ী নতুন তৈরি করো)";

  const subTopicList =
    existing.subTopics.length > 0
      ? existing.subTopics.slice(0, 100).join(" | ")
      : "(এখনো কোনো সাব-টপিক নেই — প্রয়োজন হলে নতুন তৈরি করো)";

  return `
তুমি একজন অত্যন্ত দক্ষ বাংলাদেশি চাকরির পরীক্ষার (BCS, Bank, Primary, NTRCA) প্রশ্ন বিশ্লেষক এবং শক্তিশালী OCR + ভিশন মডেল।

গুরুত্বপূর্ণ নির্দেশ:
- ছবিটি খুব অস্পষ্ট, ঝাপসা, কম কনট্রাস্ট, ময়লা, হাতের লেখা বা খারাপ কোয়ালিটির হতে পারে।
- তবুও তোমার নিজের বুদ্ধিমত্তা ও কনটেক্সট দিয়ে অক্ষরগুলো অনুমান করে পড়ার চেষ্টা করবে।
- কোনো প্রশ্ন বা অপশন বাদ দিবে না যদি আংশিকভাবেও পড়া যায়।
- অস্পষ্ট জায়গায় আশেপাশের শব্দ, বাক্যের গঠন এবং সাধারণ পরীক্ষার প্রশ্নের ধরন দেখে সবচেয়ে যৌক্তিক পাঠ নির্ণয় করবে।
- "পড়া যাচ্ছে না" বলে বাদ দিবে না — যতটা সম্ভব বের করবে।

===== Subject / Topic / Sub-topic নিয়ম (খুব গুরুত্বপূর্ণ) =====
১. প্রথমে নিচের ডাটাবেজে থাকা existing লিস্ট থেকে মিলিয়ে নাও।
২. প্রশ্নের বিষয়বস্তুর সাথে সবচেয়ে কাছাকাছি existing নাম থাকলে ঠিক সেই নামটিই ব্যবহার করো (নতুন বানাবে না)।
৩. যদি কোনো ভালো মিল না পাওয়া যায়, তখনই প্রশ্নের বিষয়বস্তু অনুযায়ী নতুন subject / topic / sub_topic তৈরি করো।
৪. Subject সবসময় বাধ্যতামূলক। খালি রাখবে না।

ডাটাবেজে থাকা Subjects:
${subjectList}

ডাটাবেজে থাকা Topics:
${topicList}

ডাটাবেজে থাকা Sub-topics:
${subTopicList}

===== Exam Taker নিয়ম =====
- ছবিতে পরীক্ষার নাম/সাল (যেমন: ৪৫তম বিসিএস, ২০২৩ ব্যাংক, প্রাইমারি টেট ইত্যাদি) স্পষ্টভাবে লেখা থাকলে শুধুমাত্র তখনই exam_taker দাও।
- ছবিতে না থাকলে বা সন্দেহ থাকলে exam_taker = "" (খালি স্ট্রিং) রাখো।
- কখনো অনুমান করে বা ডিফল্ট দিয়ে exam_taker ভরাবে না।

শুধুমাত্র একটি ভ্যালিড JSON অবজেক্ট রিটার্ন করো:
{
  "questions": [
    {
      "question": "মূল প্রশ্নটি (প্রশ্নের নম্বর বা সাল বাদ দিয়ে পরিষ্কার প্রশ্ন)",
      "options": ["অপশন ১", "অপশন ২", "অপশন ৩", "অপশন ৪"],
      "correct_answer_index": 0,
      "subject": "বিষয়ের নাম (existing লিস্ট থেকে মিলিয়ে নাও, না মিললে নতুন বানাও)${defaultSubject ? `। না বুঝলে '${defaultSubject}' দাও` : ""}",
      "topic": "অধ্যায় বা টপিকের নাম (existing থেকে মিলিয়ে নাও, না মিললে নতুন)",
      "sub_topic": "সাব-টপিক থাকলে দাও (existing থেকে মিলিয়ে), নাহলে ''",
      "exam_taker": "ছবিতে স্পষ্টভাবে থাকলেই দাও, নাহলে ''"
    }
  ]
}

কঠোর নিয়ম:
- options অ্যারেতে ক, খ, গ, ঘ চিহ্ন বাদ দিয়ে ঠিক ৪টি অপশন থাকবে
- correct_answer_index 0 থেকে 3 এর মধ্যে হবে
- ছবিতে উত্তর দাগানো/টিক দেওয়া থাকলে সেটাই সঠিক উত্তর ধরবে
- অস্পষ্ট হলেও অনুমান করে পূর্ণ প্রশ্ন ও অপশন লিখবে, ফাঁকা রাখবে না
- কোনো ব্যাখ্যা, মন্তব্য বা অতিরিক্ত টেক্সট লিখবে না — শুধু JSON
`;
}

function extractJsonContent(text: string): string {
  // remove thinking tags if any
  let content = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  // remove markdown code fences
  content = content.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const firstBrace = content.indexOf("{");
  const lastBrace = content.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1) return "";
  return content.slice(firstBrace, lastBrace + 1);
}

async function fetchExistingTaxonomy(): Promise<ExistingTaxonomy> {
  try {
    const client = await clientPromise;
    const db = client.db("mcq_database");
    const collection = db.collection("questions");

    const [subjects, topics, subTopics] = await Promise.all([
      collection.distinct("subject"),
      collection.distinct("topic"),
      collection.distinct("sub_topic"),
    ]);

    return {
      subjects: (subjects || []).filter(Boolean).map(String),
      topics: (topics || []).filter(Boolean).map(String),
      subTopics: (subTopics || []).filter(Boolean).map(String),
    };
  } catch (err) {
    console.error("Failed to fetch existing taxonomy:", err);
    return { subjects: [], topics: [], subTopics: [] };
  }
}

async function tryGemini(
  base64Data: string,
  mimeType: string,
  prompt: string,
  defaultSubject: string
): Promise<{ questions: ReturnType<typeof cleanQuestions> } | { error: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { error: "GEMINI_API_KEY পাওয়া যায়নি (.env.local এ যোগ করুন)" };
  }

  let lastError = "Gemini কোনো মডেল কাজ করেনি";

  for (const model of GEMINI_MODELS) {
    try {
      const url = `${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`;

      const body = {
        contents: [
          {
            parts: [
              {
                inline_data: {
                  mime_type: mimeType || "image/jpeg",
                  data: base64Data,
                },
              },
              { text: prompt },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 8192,
        },
      };

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const raw = await response.text();
      console.log(`[Gemini ${model}] Status:`, response.status);

      if (!response.ok) {
        try {
          const errJson = JSON.parse(raw);
          lastError = errJson.error?.message || raw;
        } catch {
          lastError = raw;
        }
        // rate limit or quota → next model or fallback
        if (
          response.status === 429 ||
          response.status === 403 ||
          lastError.toLowerCase().includes("quota") ||
          lastError.toLowerCase().includes("rate")
        ) {
          console.warn(`[Gemini ${model}] Limit/Quota, trying next...`);
        }
        continue;
      }

      const data = JSON.parse(raw);
      const text =
        data.candidates?.[0]?.content?.parts?.[0]?.text ||
        data.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ||
        "";

      const jsonStr = extractJsonContent(text);
      if (!jsonStr) {
        lastError = `${model}: ভ্যালিড JSON পাওয়া যায়নি`;
        continue;
      }

      const parsed = JSON.parse(jsonStr);
      const questions = cleanQuestions(
        Array.isArray(parsed.questions) ? parsed.questions : [],
        defaultSubject
      );

      if (questions.length === 0) {
        lastError = `${model}: ছবিতে কোনো প্রশ্ন শনাক্ত হয়নি`;
        continue;
      }

      console.log(`[Gemini ${model}] Success — ${questions.length} questions`);
      return { questions };
    } catch (err) {
      console.error(`[Gemini ${model}] Exception:`, err);
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  return { error: lastError };
}

async function tryGroq(
  dataUrl: string,
  prompt: string,
  defaultSubject: string
): Promise<{ questions: ReturnType<typeof cleanQuestions> } | { error: string }> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return { error: "GROQ_API_KEY পাওয়া যায়নি" };
  }

  const envModel = process.env.GROQ_VISION_MODEL?.trim();
  const candidateModels = [
    ...(envModel ? [envModel] : []),
    ...GROQ_MODELS.filter((m) => m !== envModel),
  ];

  let lastError = "Groq কোনো মডেল কাজ করেনি";

  for (const modelName of candidateModels) {
    try {
      const response = await fetch(GROQ_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: modelName,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                { type: "image_url", image_url: { url: dataUrl } },
              ],
            },
          ],
          temperature: 0.1,
          max_tokens: 4096,
        }),
      });

      const rawResponseText = await response.text();
      console.log(`[Groq ${modelName}] Status:`, response.status);

      if (!response.ok) {
        try {
          const errJson = JSON.parse(rawResponseText);
          lastError = errJson.error?.message || rawResponseText;
        } catch {
          lastError = rawResponseText;
        }
        continue;
      }

      const data = JSON.parse(rawResponseText);
      let content: string = data.choices?.[0]?.message?.content || "";
      content = extractJsonContent(content);

      if (!content) {
        lastError = `${modelName}: ভ্যালিড JSON পাওয়া যায়নি`;
        continue;
      }

      const parsed = JSON.parse(content);
      const questions = cleanQuestions(
        Array.isArray(parsed.questions) ? parsed.questions : [],
        defaultSubject
      );

      if (questions.length === 0) {
        lastError = `${modelName}: ছবিতে কোনো প্রশ্ন শনাক্ত হয়নি`;
        continue;
      }

      console.log(`[Groq ${modelName}] Success — ${questions.length} questions`);
      return { questions };
    } catch (err) {
      console.error(`[Groq ${modelName}] Exception:`, err);
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  return { error: lastError };
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const defaultSubject = (formData.get("defaultSubject") as string) || "";

    if (!file) {
      return NextResponse.json(
        { success: false, error: "কোনো ছবি পাওয়া যায়নি।" },
        { status: 400 }
      );
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        {
          success: false,
          error: "ছবির সাইজ ৩MB এর বেশি। ছবিটি ছোট (কমপ্রেস) করে আবার দিন।",
        },
        { status: 400 }
      );
    }

    // ১. প্রথমে ডাটাবেজ থেকে existing subject/topic/sub_topic আনো
    const existing = await fetchExistingTaxonomy();
    console.log(
      `Existing taxonomy loaded — subjects: ${existing.subjects.length}, topics: ${existing.topics.length}, subTopics: ${existing.subTopics.length}`
    );

    const bytes = await file.arrayBuffer();
    const base64Data = Buffer.from(bytes).toString("base64");
    const mimeType = file.type || "image/jpeg";
    const dataUrl = `data:${mimeType};base64,${base64Data}`;

    const prompt = buildPrompt(defaultSubject, existing);

    // ২. প্রথমে Gemini চেষ্টা
    console.log("Trying Gemini (primary)...");
    const geminiResult = await tryGemini(
      base64Data,
      mimeType,
      prompt,
      defaultSubject
    );

    if ("questions" in geminiResult) {
      return NextResponse.json(
        { success: true, questions: geminiResult.questions, provider: "gemini" },
        { status: 200 }
      );
    }

    console.warn("Gemini failed → falling back to Groq. Reason:", geminiResult.error);

    // ৩. Gemini ব্যর্থ হলে Groq ফলব্যাক
    const groqResult = await tryGroq(dataUrl, prompt, defaultSubject);

    if ("questions" in groqResult) {
      return NextResponse.json(
        { success: true, questions: groqResult.questions, provider: "groq" },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: `Gemini ও Groq দুটোই ব্যর্থ। Gemini: ${geminiResult.error} | Groq: ${groqResult.error}`,
      },
      { status: 500 }
    );
  } catch (error: unknown) {
    console.error("OCR Extract Fatal Error:", error);
    const message =
      error instanceof Error
        ? error.message
        : "ছবি থেকে প্রশ্ন বের করতে সমস্যা হয়েছে।";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}