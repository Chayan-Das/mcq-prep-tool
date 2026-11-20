import clientPromise from "../../../lib/mongodb";
import { NextResponse } from "next/server";

interface GenerateBody {
  title?: string;
  omr_type?: number; // ২০, ৫০, ১০০
  subject?: string;
  topic?: string;
  exam_taker?: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as GenerateBody;
    const count = Number(body.omr_type);

    if (!Number.isInteger(count) || count < 1 || count > 200) {
      return NextResponse.json(
        { success: false, error: "প্রশ্নের সংখ্যা (omr_type) ১ থেকে ২০০ এর মধ্যে হতে হবে।" },
        { status: 400 }
      );
    }

    const filter: Record<string, string> = {};
    if (body.subject?.trim()) filter.subject = body.subject.trim();
    if (body.topic?.trim()) filter.topic = body.topic.trim();
    if (body.exam_taker?.trim()) filter.exam_taker = body.exam_taker.trim();

    const client = await clientPromise;
    const db = client.db("mcq_database");

    const questions = await db
      .collection("questions")
      .aggregate([{ $match: filter }, { $sample: { size: count } }])
      .toArray();

    if (questions.length === 0) {
      return NextResponse.json(
        { success: false, error: "এই ফিল্টারে কোনো প্রশ্ন পাওয়া যায়নি।" },
        { status: 404 }
      );
    }

    const paper = {
      title: body.title?.trim() || `মডেল টেস্ট - ${new Date().toLocaleDateString("bn-BD")}`,
      question_ids: questions.map((q) => String(q._id)),
      omr_type: count,
      created_at: new Date(),
    };
    const result = await db.collection("papers").insertOne(paper);

    return NextResponse.json(
      {
        success: true,
        paperId: String(result.insertedId),
        paper,
        requested: count,
        found: questions.length,
        questions: questions.map((q) => ({ ...q, _id: String(q._id) })),
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "প্রশ্নপত্র তৈরি করতে সমস্যা হয়েছে।";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
