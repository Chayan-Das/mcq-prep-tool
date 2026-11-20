import clientPromise from "../../../lib/mongodb";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db("mcq_database");
    const collection = db.collection("questions");

    const [subjects, topics, subTopics, examTakers] = await Promise.all([
      collection.distinct("subject"),
      collection.distinct("topic"),
      collection.distinct("sub_topic"),
      collection.distinct("exam_taker"),
    ]);

    return NextResponse.json({
      success: true,
      subjects: subjects.filter(Boolean),
      topics: topics.filter(Boolean),
      subTopics: subTopics.filter(Boolean),
      examTakers: examTakers.filter(Boolean),
    });
  } catch (error: unknown) {
    console.error("MongoDB Suggestions Error:", error);
    const message =
      error instanceof Error ? error.message : "সাজেশন লোড করতে সমস্যা হয়েছে।";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
