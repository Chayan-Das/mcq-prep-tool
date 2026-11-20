import { NextResponse } from "next/server";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

// Groq base64 ছবির সীমা ~4MB, তাই মূল ফাইল ~3MB এর নিচে রাখা হলো
const MAX_FILE_BYTES = 3 * 1024 * 1024;

// .env.local এ GROQ_VISION_MODEL দিলে সেটি সবার আগে চেষ্টা করবে
const DEFAULT_MODELS = [
  "qwen/qwen3.8-27b",
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

function cleanQuestions(
  list: RawQuestion[],
  defaultSubject: string,
  defaultExamTaker: string
) {
  return list
    .filter((q) => typeof q?.question === "string" && q.question.trim() !== "")
    .map((q) => {
      const options = Array.isArray(q.options)
        ? q.options.map((o) => String(o ?? "").trim())
        : [];
      while (options.length < 4) options.push("");
      const idx = Number(q.correct_answer_index);
      return {
        question: String(q.question).trim(),
        options: options.slice(0, 4),
        correct_answer_index: Number.isInteger(idx) && idx >= 0 && idx <= 3 ? idx : 0,
        subject: String(q.subject || defaultSubject || "").trim(),
        topic: String(q.topic || "").trim(),
        sub_topic: String(q.sub_topic || "").trim(),
        exam_taker: String(q.exam_taker || defaultExamTaker || "").trim(),
      };
    });
}

export async function POST(request: Request) {
  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: ".env.local ফাইলে GROQ_API_KEY পাওয়া যায়নি।" },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const defaultSubject = (formData.get("defaultSubject") as string) || "";
    const defaultExamTaker = (formData.get("defaultExamTaker") as string) || "";

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

    const bytes = await file.arrayBuffer();
    const base64Data = Buffer.from(bytes).toString("base64");
    const dataUrl = `data:${file.type || "image/jpeg"};base64,${base64Data}`;

    const prompt = `
তুমি একজন বাংলাদেশি চাকরির পরীক্ষার (BCS, Bank, Primary, NTRCA) প্রশ্ন বিশ্লেষক।
এই ছবিটি থেকে সবগুলো MCQ প্রশ্ন, ৪টি অপশন এবং সঠিক উত্তর বের করো।

শুধুমাত্র একটি ভ্যালিড JSON অবজেক্ট রিটার্ন করো যার ভেতরে "questions" নামে একটি অ্যারে থাকবে:
{
  "questions": [
    {
      "question": "মূল প্রশ্নটি (প্রশ্নের নম্বর বা শেষে থাকা পরীক্ষার সাল বাদ দিয়ে পরিষ্কার প্রশ্ন)",
      "options": ["অপশন ১", "অপশন ২", "অপশন ৩", "অপশন ৪"],
      "correct_answer_index": 0,
      "subject": "বিষয়ের নাম (যেমন: বাংলা, ইংরেজি, গণিত, সাধারণ জ্ঞান, বিজ্ঞান)। না বুঝলে '${defaultSubject}' দাও",
      "topic": "অধ্যায় বা টপিকের নাম (যেমন: ব্যাকরণ, সাহিত্য, সংবিধান)",
      "sub_topic": "সাব-টপিক থাকলে দাও, নাহলে ফাঁকা স্ট্রিং '' দাও",
      "exam_taker": "প্রশ্নের পাশে পরীক্ষার নাম/সাল থাকলে তা দাও (যেমন: '৪৫তম বিসিএস'), নাহলে '${defaultExamTaker}' দাও"
    }
  ]
}
নিয়ম: options অ্যারেতে অবশ্যই ক, খ, গ, ঘ চিহ্ন বাদ দিয়ে ৪টি অপশন থাকবে এবং correct_answer_index হবে 0 থেকে 3 এর মধ্যে। উত্তর ছবিতে দাগানো থাকলে (যেমন: উ. খ) সেটিই সঠিক উত্তর হিসেবে ধরবে। কোনো ব্যাখ্যা লিখবে না।
`;

    const envModel = process.env.GROQ_VISION_MODEL?.trim();
    const candidateModels = [
      ...(envModel ? [envModel] : []),
      ...DEFAULT_MODELS.filter((m) => m !== envModel),
    ];

    let lastError = "কোনো ভিশন মডেল কাজ করেনি।";

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
          console.error(`[Groq Error ${modelName}]:`, rawResponseText);
          try {
            const errJson = JSON.parse(rawResponseText);
            lastError = errJson.error?.message || rawResponseText;
          } catch {
            lastError = rawResponseText;
          }
          continue; // পরের মডেল দিয়ে চেষ্টা করবে
        }

        const data = JSON.parse(rawResponseText);
        let content: string = data.choices?.[0]?.message?.content || "";
        content = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

        const firstBrace = content.indexOf("{");
        const lastBrace = content.lastIndexOf("}");
        if (firstBrace === -1 || lastBrace === -1) {
          lastError = `${modelName}: ভ্যালিড JSON পাওয়া যায়নি।`;
          continue;
        }

        const parsed = JSON.parse(content.slice(firstBrace, lastBrace + 1));
        const questions = cleanQuestions(
          Array.isArray(parsed.questions) ? parsed.questions : [],
          defaultSubject,
          defaultExamTaker
        );

        if (questions.length === 0) {
          lastError = `${modelName}: ছবিতে কোনো প্রশ্ন শনাক্ত হয়নি।`;
          continue;
        }

        return NextResponse.json({ success: true, questions }, { status: 200 });
      } catch (err) {
        // একটি মডেলের JSON/নেটওয়ার্ক সমস্যায় যেন বাকি মডেল চেষ্টা বন্ধ না হয়
        console.error(`[Groq ${modelName}] Exception:`, err);
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    return NextResponse.json({ success: false, error: lastError }, { status: 500 });
  } catch (error: unknown) {
    console.error("OCR Extract Fatal Error:", error);
    const message =
      error instanceof Error
        ? error.message
        : "ছবি থেকে প্রশ্ন বের করতে সমস্যা হয়েছে।";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
