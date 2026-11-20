import clientPromise from "../../../lib/mongodb";
import { NextResponse } from "next/server";

interface IncomingQuestion {
  question: string;
  options: string[];
  correct_answer_index: number;
  subject: string;
  topic?: string;
  sub_topic?: string;
  exam_taker?: string;
}

function normalizeText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[।?!.,;:'"()\-]/g, "");
}

function sanitizeQuestion(item: IncomingQuestion) {
  if (
    !item.question?.trim() ||
    !Array.isArray(item.options) ||
    item.options.length !== 4 ||
    item.options.some((opt) => !opt?.trim()) ||
    typeof item.correct_answer_index !== "number" ||
    item.correct_answer_index < 0 ||
    item.correct_answer_index > 3 ||
    !item.subject?.trim()
  ) {
    throw new Error(
      "প্রতিটি প্রশ্নে মূল প্রশ্ন, ৪টি অপশন, সঠিক উত্তর এবং বিষয় (Subject) থাকা বাধ্যতামূলক।"
    );
  }

  const doc: Record<string, unknown> = {
    question: item.question.trim(),
    normalized_question: normalizeText(item.question),
    options: item.options.map((opt) => opt.trim()),
    correct_answer_index: item.correct_answer_index,
    subject: item.subject.trim(),
    created_at: new Date(),
  };

  if (item.topic && item.topic.trim() !== "") {
    doc.topic = item.topic.trim();
  }
  if (item.sub_topic && item.sub_topic.trim() !== "") {
    doc.sub_topic = item.sub_topic.trim();
  }
  if (item.exam_taker && item.exam_taker.trim() !== "") {
    doc.exam_taker = item.exam_taker.trim();
  }

  return doc;
}

export async function POST(request: Request) {
  try {
    const client = await clientPromise;
    const db = client.db("mcq_database");
    const collection = db.collection("questions");
    const body = await request.json();

    const rawList: IncomingQuestion[] = Array.isArray(body) ? body : [body];

    if (rawList.length === 0) {
      return NextResponse.json(
        { success: false, error: "কোনো প্রশ্ন পাওয়া যায়নি।" },
        { status: 400 }
      );
    }

    const sanitizedList = rawList.map((q) => sanitizeQuestion(q));

    const existingDocs = await collection
      .find({}, { projection: { question: 1, normalized_question: 1 } })
      .toArray();

    const existingSet = new Set<string>(
      existingDocs.map((doc) =>
        doc.normalized_question
          ? String(doc.normalized_question)
          : normalizeText(String(doc.question || ""))
      )
    );

    const uniqueToInsert: Record<string, unknown>[] = [];
    const duplicateQuestions: string[] = [];

    for (const item of sanitizedList) {
      const norm = String(item.normalized_question);
      if (existingSet.has(norm)) {
        duplicateQuestions.push(String(item.question));
      } else {
        existingSet.add(norm);
        uniqueToInsert.push(item);
      }
    }

    let insertedCount = 0;
    if (uniqueToInsert.length > 0) {
      const result = await collection.insertMany(uniqueToInsert);
      insertedCount = result.insertedCount;
    }

    return NextResponse.json(
      {
        success: true,
        insertedCount,
        duplicateCount: duplicateQuestions.length,
        duplicateQuestions,
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "ডাটাবেজে সেভ করতে সমস্যা হয়েছে।";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
