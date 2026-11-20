import clientPromise from "../../../lib/mongodb";
import { NextResponse } from "next/server";

function normalizeText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[।?!.,;:'"()\-]/g, "");
}

export async function POST(request: Request) {
  try {
    const { questions } = (await request.json()) as { questions: string[] };
    if (!Array.isArray(questions) || questions.length === 0) {
      return NextResponse.json({ success: true, duplicateIndices: [] });
    }

    const client = await clientPromise;
    const db = client.db("mcq_database");
    const existingDocs = await db
      .collection("questions")
      .find({}, { projection: { question: 1, normalized_question: 1 } })
      .toArray();

    const existingSet = new Set<string>(
      existingDocs.map((doc) =>
        doc.normalized_question
          ? String(doc.normalized_question)
          : normalizeText(String(doc.question || ""))
      )
    );

    const seenInBatch = new Set<string>();
    const duplicateIndices: number[] = [];

    questions.forEach((q, idx) => {
      const norm = normalizeText(q || "");
      if (existingSet.has(norm) || seenInBatch.has(norm)) {
        duplicateIndices.push(idx);
      } else {
        seenInBatch.add(norm);
      }
    });

    return NextResponse.json({ success: true, duplicateIndices });
  } catch {
    return NextResponse.json({ success: false, duplicateIndices: [] });
  }
}
