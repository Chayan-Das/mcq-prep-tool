
"use client";

import { useState, useEffect, useRef } from "react";

interface ExtractedQuestion {
  question: string;
  options: string[];
  correct_answer_index: number;
  subject: string;
  topic?: string;
  sub_topic?: string;
  exam_taker?: string;
  isDuplicate?: boolean;
  duplicateMatch?: {
    question: string;
    options: string[];
    correct_answer_index: number;
    subject?: string;
    topic?: string;
    sub_topic?: string;
    exam_taker?: string;
    matchType: "exact" | "semantic";
  };
}

interface SuggestionsData {
  subjects: string[];
  topics: string[];
  subTopics: string[];
  examTakers: string[];
}

export default function AdminPage() {
  const [suggestions, setSuggestions] = useState<SuggestionsData>({
    subjects: [],
    topics: [],
    subTopics: [],
    examTakers: [],
  });

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const [extractedList, setExtractedList] = useState<ExtractedQuestion[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [status, setStatus] = useState<{
    message: string;
    type: "success" | "error" | "info" | "";
  }>({ message: "", type: "" });

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  const optionLabels = ["ক", "খ", "গ", "ঘ"];

  // ==========================================
  // IMAGE ENHANCEMENT
  // Grayscale + Contrast + Unsharp Mask
  // ==========================================

  const enhanceImage = (file: File): Promise<File> => {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);

      img.onload = () => {
        const canvas = document.createElement("canvas");

        const maxSide = 2000;
        let w = img.width;
        let h = img.height;

        if (w > maxSide || h > maxSide) {
          const ratio = Math.min(maxSide / w, maxSide / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }

        canvas.width = w;
        canvas.height = h;

        const ctx = canvas.getContext("2d");

        if (!ctx) {
          URL.revokeObjectURL(url);
          resolve(file);
          return;
        }

        ctx.drawImage(img, 0, 0, w, h);

        const imageData = ctx.getImageData(0, 0, w, h);
        const data = imageData.data;
        const len = data.length;

        // 1. Grayscale + Contrast
        const contrast = 1.35;
        const brightness = 12;

        for (let i = 0; i < len; i += 4) {
          let gray =
            0.299 * data[i] +
            0.587 * data[i + 1] +
            0.114 * data[i + 2];

          gray = (gray - 128) * contrast + 128 + brightness;
          gray = Math.max(0, Math.min(255, gray));

          data[i] = data[i + 1] = data[i + 2] = gray;
        }

        // 2. Light Unsharp Mask
        const sharpData = new Uint8ClampedArray(data);
        const amount = 0.6;

        for (let y = 1; y < h - 1; y++) {
          for (let x = 1; x < w - 1; x++) {
            const idx = (y * w + x) * 4;

            const center = data[idx];

            const neighbors =
              data[((y - 1) * w + x) * 4] +
              data[((y + 1) * w + x) * 4] +
              data[(y * w + (x - 1)) * 4] +
              data[(y * w + (x + 1)) * 4];

            const blurred = neighbors / 4;

            let val = center + amount * (center - blurred);

            val = Math.max(0, Math.min(255, val));

            sharpData[idx] =
              sharpData[idx + 1] =
              sharpData[idx + 2] = val;
          }
        }

        for (let i = 0; i < len; i++) {
          data[i] = sharpData[i];
        }

        ctx.putImageData(imageData, 0, 0);

        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(url);

            if (blob) {
              resolve(
                new File(
                  [blob],
                  file.name.replace(/\.\w+$/, "") + "_enhanced.jpg",
                  { type: "image/jpeg" }
                )
              );
            } else {
              resolve(file);
            }
          },
          "image/jpeg",
          0.92
        );
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(file);
      };

      img.src = url;
    });
  };

  // ==========================================
  // FILE SELECT HANDLER
  // ==========================================

  const handleFileSelect = (selectedFile: File | null) => {
    if (!selectedFile) return;

    if (!selectedFile.type.startsWith("image/")) {
      setStatus({
        message: "অনুগ্রহ করে শুধুমাত্র ছবি (JPG, PNG, WEBP) সিলেক্ট করুন।",
        type: "error",
      });
      return;
    }

    setFile(selectedFile);
    setPreviewUrl(URL.createObjectURL(selectedFile));

    setStatus({ message: "", type: "" });
  };

  // ==========================================
  // NEW FEATURE: CLIPBOARD IMAGE PASTE
  // Ctrl + V
  // ==========================================

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;

      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];

        if (item.type.startsWith("image/")) {
          const pastedFile = item.getAsFile();

          if (pastedFile) {
            event.preventDefault();

            const extension = item.type.split("/")[1] || "png";

            const imageFile = new File(
              [pastedFile],
              `clipboard-image-${Date.now()}.${extension}`,
              { type: item.type }
            );

            handleFileSelect(imageFile);

            setStatus({
              message: "কপি করা ছবি সফলভাবে যুক্ত হয়েছে!",
              type: "success",
            });

            return;
          }
        }
      }
    };

    document.addEventListener("paste", handlePaste);

    return () => {
      document.removeEventListener("paste", handlePaste);
    };
  }, [handleFileSelect]);

  // ==========================================
  // FETCH SUGGESTIONS
  // ==========================================

  const fetchSuggestions = async () => {
    try {
      const res = await fetch("/api/suggestions");
      const data = await res.json();

      if (data.success) {
        setSuggestions({
          subjects: data.subjects || [],
          topics: data.topics || [],
          subTopics: data.subTopics || [],
          examTakers: data.examTakers || [],
        });
      }
    } catch {
      // silent error
    }
  };

  useEffect(() => {
    fetchSuggestions();
  }, []);

  // ==========================================
  // AI OCR EXTRACTION
  // ==========================================

  const handleAiExtract = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!file) return;

    setAiLoading(true);

    setStatus({
      message: "ছবি পরিষ্কার করে AI স্ক্যান করছে... (অস্পষ্ট ছবি হলেও চেষ্টা চলছে)",
      type: "info",
    });

    try {
      const enhancedFile = await enhanceImage(file);

      const formData = new FormData();
      formData.append("file", enhancedFile);

      const res = await fetch("/api/ocr-extract", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (data.success && Array.isArray(data.questions)) {
        const rawQuestions: ExtractedQuestion[] = data.questions;

        // Duplicate checking
        const dupRes = await fetch("/api/check-duplicates", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            questions: rawQuestions.map((q) => q.question),
          }),
        });

        const dupData = await dupRes.json();

        const dupSet = new Set<number>(
          dupData.duplicateIndices || []
        );

        const matchByIndex = new Map<number, ExtractedQuestion["duplicateMatch"]>(
          (dupData.duplicateMatches || []).map((match: { index: number; existing: ExtractedQuestion["duplicateMatch"] }) => [match.index, match.existing])
        );

        const markedQuestions = rawQuestions.map((q, idx) => ({
          ...q,
          isDuplicate: dupSet.has(idx),
          duplicateMatch: matchByIndex.get(idx),
        }));

        setExtractedList(markedQuestions);

        const dupCount = dupSet.size;

        setStatus({
          message:
            dupCount > 0
              ? `মোট ${markedQuestions.length}টি প্রশ্ন পাওয়া গেছে (এর মধ্যে ${dupCount}টি ডাটাবেজে আগে থেকেই আছে)। সেভ করার আগে নিচে যাচাই ও এডিট করুন।`
              : `চমৎকার! মোট ${markedQuestions.length}টি নতুন প্রশ্ন শনাক্ত হয়েছে। সেভ করার আগে নিচে যাচাই করে নিন।`,
          type: "success",
        });
      } else {
        setStatus({
          message: data.error || "ছবি থেকে প্রশ্ন বের করা সম্ভব হয়নি।",
          type: "error",
        });
      }
    } catch {
      setStatus({
        message: "AI স্ক্যানিংয়ের সময় সার্ভারে সমস্যা হয়েছে।",
        type: "error",
      });
    } finally {
      setAiLoading(false);
    }
  };

  // ==========================================
  // UPDATE QUESTION
  // ==========================================

  const updateBatchItem = (
    index: number,
    field: keyof ExtractedQuestion,
    value: string | number | boolean
  ) => {
    const updated = [...extractedList];

    updated[index] = {
      ...updated[index],
      [field]: value,
    };

    setExtractedList(updated);
  };

  // ==========================================
  // UPDATE OPTION
  // ==========================================

  const updateOptionText = (
    qIndex: number,
    optIndex: number,
    value: string
  ) => {
    const updated = [...extractedList];

    const newOptions = [...updated[qIndex].options];

    newOptions[optIndex] = value;

    updated[qIndex] = {
      ...updated[qIndex],
      options: newOptions,
    };

    setExtractedList(updated);
  };

  // ==========================================
  // REMOVE QUESTION
  // ==========================================

  const removeBatchItem = (index: number) => {
    setExtractedList(
      extractedList.filter((_, i) => i !== index)
    );
  };

  // ==========================================
  // REMOVE ALL DUPLICATES
  // ==========================================

  const removeAllDuplicates = () => {
    setExtractedList(
      extractedList.filter((item) => !item.isDuplicate)
    );
  };

  // ==========================================
  // SAVE QUESTIONS TO DATABASE
  // ==========================================

  const handleSaveBatch = async () => {
    if (extractedList.length === 0) return;

    const missingSubject = extractedList.some(
      (q) => !q.subject?.trim()
    );

    if (missingSubject) {
      setStatus({
        message: "দয়া করে প্রতিটি প্রশ্নের 'বিষয় (Subject)' ঘরটি পূরণ করুন।",
        type: "error",
      });

      return;
    }

    setSaving(true);

    setStatus({
      message: "ডুপ্লিকেট যাচাই করে ডাটাবেজে সেভ হচ্ছে...",
      type: "info",
    });

    try {
      const res = await fetch("/api/add-question", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(extractedList),
      });

      const data = await res.json();

      if (data.success) {
        const msg =
          data.duplicateCount > 0
            ? `${data.insertedCount}টি নতুন প্রশ্ন সেভ হয়েছে এবং ${data.duplicateCount}টি ডুপ্লিকেট প্রশ্ন বাদ দেওয়া হয়েছে।`
            : `অভিনন্দন! সবগুলো (${data.insertedCount}টি) নতুন প্রশ্ন সফলভাবে ডাটাবেজে যুক্ত হয়েছে!`;

        setStatus({
          message: msg,
          type: "success",
        });

        setExtractedList([]);
        setFile(null);
        setPreviewUrl(null);

        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }

        if (cameraInputRef.current) {
          cameraInputRef.current.value = "";
        }

        fetchSuggestions();
      } else {
        setStatus({
          message: "সেভ হয়নি: " + data.error,
          type: "error",
        });
      }
    } catch {
      setStatus({
        message: "ডাটাবেজে সংযোগ দেওয়া যাচ্ছে না।",
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const duplicateCount = extractedList.filter(
    (q) => q.isDuplicate
  ).length;

  // ==========================================
  // UI
  // ==========================================

  return (
    <div className="p-4 sm:p-6 space-y-6">

      {/* DATALISTS */}

      <datalist id="subject-list">
        {suggestions.subjects.map((item, idx) => (
          <option key={idx} value={item} />
        ))}
      </datalist>

      <datalist id="topic-list">
        {suggestions.topics.map((item, idx) => (
          <option key={idx} value={item} />
        ))}
      </datalist>

      <datalist id="subtopic-list">
        {suggestions.subTopics.map((item, idx) => (
          <option key={idx} value={item} />
        ))}
      </datalist>

      <datalist id="examtaker-list">
        {suggestions.examTakers.map((item, idx) => (
          <option key={idx} value={item} />
        ))}
      </datalist>

      {/* HEADER */}

      <div className="bg-gradient-to-r from-[#15362C] to-[#235445] text-white rounded-2xl p-5 shadow-sm">
        <div className="flex items-center gap-3">

          <div className="w-11 h-11 rounded-xl bg-white/15 backdrop-blur-xs flex items-center justify-center text-2xl">
            ✨
          </div>

          <div>
            <h1 className="text-lg sm:text-xl font-bold">
              স্মার্ট AI প্রশ্ন স্ক্যানার
            </h1>

            <p className="text-xs sm:text-sm text-emerald-100/90">
              বইয়ের পাতার ছবি আপলোড করুন, যাচাই করুন এবং ডুপ্লিকেট ছাড়াই ডাটাবেজে যোগ করুন
            </p>
          </div>

        </div>
      </div>

      {/* STATUS */}

      {status.message && (
        <div
          className={`p-3.5 rounded-xl text-xs sm:text-sm font-medium border flex items-start gap-2.5 ${
            status.type === "success"
              ? "bg-emerald-50 text-emerald-900 border-emerald-200"
              : status.type === "error"
              ? "bg-red-50 text-red-800 border-red-200"
              : "bg-gray-50 text-gray-800 border-gray-200"
          }`}
        >
          <span className="text-base leading-none mt-0.5">
            {status.type === "success"
              ? "✅"
              : status.type === "error"
              ? "⚠️"
              : "⏳"}
          </span>

          <span>{status.message}</span>
        </div>
      )}

      {/* IMAGE UPLOAD FORM */}

      <form
        onSubmit={handleAiExtract}
        className="bg-white border border-gray-200/90 rounded-2xl p-4 sm:p-5 shadow-2xs space-y-4"
      >

        {/* DROP ZONE */}

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);

            const dropped = e.dataTransfer.files?.[0] || null;

            handleFileSelect(dropped);
          }}
          className={`border-2 border-dashed rounded-2xl p-5 text-center transition-all ${
            isDragging
              ? "border-[#15362C] bg-[#15362C]/5 scale-[1.01]"
              : "border-gray-300 hover:border-[#15362C] bg-gray-50/70"
          }`}
        >

          {/* GALLERY INPUT */}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={(e) =>
              handleFileSelect(e.target.files?.[0] || null)
            }
            className="hidden"
          />

          {/* CAMERA INPUT */}

          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) =>
              handleFileSelect(e.target.files?.[0] || null)
            }
            className="hidden"
          />

          {/* IMAGE PREVIEW */}

          {previewUrl ? (
            <div className="space-y-3">

              <div className="relative max-h-56 overflow-hidden rounded-xl border border-gray-200 mx-auto w-fit bg-white">

                {/* eslint-disable-next-line @next/next/no-img-element */}

                <img
                  src={previewUrl}
                  alt="আপলোডকৃত প্রশ্নপত্র"
                  className="max-h-56 w-auto object-contain"
                />

              </div>

              <p className="text-xs font-semibold text-[#15362C]">
                📄 {file?.name}
              </p>

              <div className="flex flex-wrap justify-center gap-2 pt-1">

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white border border-gray-300 text-gray-700 hover:border-[#15362C] hover:text-[#15362C] transition"
                >
                  📁 গ্যালারি থেকে বদলান
                </button>

                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[#15362C] text-white hover:bg-[#1e4a3d] transition"
                >
                  📷 ক্যামেরা দিয়ে নতুন তুলুন
                </button>

              </div>

            </div>
          ) : (

            /* EMPTY UPLOAD STATE */

            <div className="py-4 space-y-3">

              <div className="w-12 h-12 mx-auto rounded-full bg-[#15362C]/10 text-[#15362C] flex items-center justify-center text-2xl">
                📸
              </div>

              <p className="text-sm font-semibold text-gray-800">
                প্রশ্নপত্রের ছবি আপলোড করুন
              </p>

              <p className="text-xs text-gray-400">
                অস্পষ্ট ছবি হলেও AI চেষ্টা করবে • JPG, PNG, WEBP
              </p>

              {/* NEW CLIPBOARD INSTRUCTION */}

              <p className="text-xs font-medium text-[#15362C]">
                📋 ছবি Copy করে এখানে Ctrl + V চাপলেও Paste করতে পারবেন
              </p>

              <div className="flex flex-wrap justify-center gap-2 pt-1">

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2 text-sm font-medium rounded-xl bg-white border border-gray-300 text-gray-700 hover:border-[#15362C] hover:text-[#15362C] transition"
                >
                  📁 গ্যালারি থেকে বাছাই
                </button>

                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="px-4 py-2 text-sm font-medium rounded-xl bg-[#15362C] text-white hover:bg-[#1e4a3d] transition"
                >
                  📷 ক্যামেরা দিয়ে তুলুন
                </button>

              </div>

            </div>
          )}

        </div>

        {/* AI SCAN BUTTON */}

        <button
          type="submit"
          disabled={aiLoading || !file}
          className="w-full py-3 bg-[#15362C] text-white font-semibold text-sm rounded-xl hover:bg-[#1e4a3d] transition active:scale-[0.99] disabled:opacity-50 flex items-center justify-center gap-2 shadow-xs"
        >

          {aiLoading ? (
            <>
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />

              <span>AI প্রশ্নগুলো স্ক্যান করছে...</span>
            </>
          ) : (
            <span>⚡ ছবি স্ক্যান করে ব্যাচ তৈরি করুন</span>
          )}

        </button>

      </form>

      {/* ======================================
          REVIEW QUESTIONS
      ====================================== */}

      {extractedList.length > 0 && (

        <div className="space-y-4">

          {/* REVIEW HEADER */}

          <div className="sticky top-16 z-10 bg-white/95 backdrop-blur-xs border border-gray-200 rounded-2xl p-3.5 shadow-sm flex flex-wrap items-center justify-between gap-3">

            <div>
              <h2 className="font-bold text-sm sm:text-base text-[#15362C]">
                রিভিউ লিস্ট ({extractedList.length}টি প্রশ্ন)
              </h2>

              <p className="text-[11px] text-gray-500">
                ডাটাবেজে একবার সেভ হলে ডিলিট করা যাবে না—তাই নিচে ভালোভাবে যাচাই করে নিন
              </p>
            </div>

            <div className="flex items-center gap-2">

              {duplicateCount > 0 && (
                <button
                  type="button"
                  onClick={removeAllDuplicates}
                  className="px-3 py-2 bg-amber-100 text-amber-900 hover:bg-amber-200 text-xs font-semibold rounded-xl transition"
                >
                  ডুপ্লিকেট বাদ দিন ({duplicateCount})
                </button>
              )}

              <button
                type="button"
                onClick={handleSaveBatch}
                disabled={saving}
                className="px-4 py-2 bg-[#15362C] text-white hover:bg-[#1e4a3d] text-xs sm:text-sm font-semibold rounded-xl transition shadow-xs disabled:opacity-60"
              >
                {saving
                  ? "সেভ হচ্ছে..."
                  : `ডাটাবেজে সেভ করুন (${extractedList.length})`}
              </button>

            </div>

          </div>

          {/* QUESTION LIST */}

          <div className="space-y-4">

            {extractedList.map((item, idx) => (

              <div
                key={idx}
                className={`rounded-2xl p-4 border transition-all space-y-3 ${
                  item.isDuplicate
                    ? "bg-amber-50/60 border-amber-300"
                    : "bg-white border-gray-200/90 shadow-2xs"
                }`}
              >

                {/* QUESTION HEADER */}

                <div className="flex items-center justify-between gap-2">

                  <div className="flex items-center gap-2">

                    <span className="px-2.5 py-0.5 rounded-lg bg-[#15362C] text-white text-xs font-bold">
                      প্রশ্ন #{idx + 1}
                    </span>

                    {item.isDuplicate && (
                      <span className="px-2.5 py-0.5 rounded-lg bg-amber-200 text-amber-900 text-[11px] font-bold">
                        ⚠️ ডাটাবেজে আগে থেকেই আছে (ডুপ্লিকেট)
                      </span>
                    )}

                  </div>

                  <button
                    type="button"
                    onClick={() => removeBatchItem(idx)}
                    className="px-2.5 py-1 text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition"
                  >
                    🗑️ ডিলিট করুন
                  </button>

                </div>

                {item.isDuplicate && item.duplicateMatch && (
                  <div className="rounded-xl border border-amber-300 bg-white p-3 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-bold text-amber-900">📚 ডাটাবেজে আগে থেকে থাকা মিল পাওয়া প্রশ্ন</p>
                      <span className="text-[10px] font-semibold rounded-md bg-amber-100 text-amber-800 px-2 py-1">
                        {item.duplicateMatch.matchType === "exact" ? "হুবহু / Normalized Match" : "AI Semantic Match"}
                      </span>
                    </div>
                    <p className="text-sm font-semibold text-gray-800">{item.duplicateMatch.question}</p>
                    {item.duplicateMatch.options?.length > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {item.duplicateMatch.options.map((option, optionIndex) => (
                          <div key={optionIndex} className={`text-xs rounded-lg px-2.5 py-2 border ${optionIndex === item.duplicateMatch?.correct_answer_index ? "bg-emerald-50 border-emerald-300 text-emerald-800 font-semibold" : "bg-gray-50 border-gray-200 text-gray-700"}`}>
                            {optionLabels[optionIndex] || optionIndex + 1}. {option} {optionIndex === item.duplicateMatch?.correct_answer_index ? "✓ সঠিক উত্তর" : ""}
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-gray-500">
                      {item.duplicateMatch.subject && <span>বিষয়: {item.duplicateMatch.subject}</span>}
                      {item.duplicateMatch.topic && <span>টপিক: {item.duplicateMatch.topic}</span>}
                      {item.duplicateMatch.exam_taker && <span>পরীক্ষা: {item.duplicateMatch.exam_taker}</span>}
                    </div>
                  </div>
                )}

                {/* QUESTION TEXT */}

                <div>

                  <label className="block text-[11px] font-semibold text-gray-500 mb-1">
                    মূল প্রশ্ন (এডিট করা যাবে)
                  </label>

                  <textarea
                    rows={2}
                    value={item.question}
                    onChange={(e) => {
                      updateBatchItem(idx, "question", e.target.value);

                      if (item.isDuplicate) {
                        updateBatchItem(idx, "isDuplicate", false);
                      }
                    }}
                    className="w-full px-3 py-2 text-sm font-medium text-gray-800 bg-gray-50/70 border border-gray-200 rounded-xl focus:bg-white focus:border-[#15362C] outline-none"
                  />

                </div>

                {/* OPTIONS */}

                <div className="space-y-1.5">

                  <label className="block text-[11px] font-semibold text-gray-500">
                    অপশনসমূহ (সঠিক উত্তরের বৃত্তে ক্লিক করে পরিবর্তন করতে পারবেন)
                  </label>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">

                    {item.options.map((opt, optIdx) => {

                      const isCorrect =
                        optIdx === item.correct_answer_index;

                      return (

                        <div
                          key={optIdx}
                          className={`flex items-center gap-2 p-1.5 rounded-xl border transition ${
                            isCorrect
                              ? "bg-emerald-50/80 border-[#15362C]"
                              : "bg-white border-gray-200"
                          }`}
                        >

                          <button
                            type="button"
                            onClick={() =>
                              updateBatchItem(
                                idx,
                                "correct_answer_index",
                                optIdx
                              )
                            }
                            title="সঠিক উত্তর হিসেবে সিলেক্ট করুন"
                            className={`w-7 h-7 shrink-0 rounded-full text-xs font-bold transition ${
                              isCorrect
                                ? "bg-[#15362C] text-white"
                                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                            }`}
                          >
                            {optionLabels[optIdx]}
                          </button>

                          <input
                            type="text"
                            value={opt}
                            onChange={(e) =>
                              updateOptionText(
                                idx,
                                optIdx,
                                e.target.value
                              )
                            }
                            className="w-full text-xs sm:text-sm bg-transparent outline-none text-gray-800 font-medium"
                          />

                        </div>

                      );
                    })}

                  </div>

                </div>

                {/* SUBJECT / TOPIC / SUBTOPIC / EXAM */}

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-gray-100">

                  <div>

                    <label className="block text-[10px] font-semibold text-gray-500 mb-0.5">
                      বিষয় (Subject) *
                    </label>

                    <input
                      type="text"
                      list="subject-list"
                      value={item.subject || ""}
                      onChange={(e) =>
                        updateBatchItem(idx, "subject", e.target.value)
                      }
                      placeholder="বিষয়"
                      className="w-full px-2.5 py-1.5 text-xs bg-gray-50/70 border border-gray-200 rounded-lg focus:bg-white focus:border-[#15362C] outline-none"
                    />

                  </div>

                  <div>

                    <label className="block text-[10px] font-semibold text-gray-500 mb-0.5">
                      টপিক (Topic)
                    </label>

                    <input
                      type="text"
                      list="topic-list"
                      value={item.topic || ""}
                      onChange={(e) =>
                        updateBatchItem(idx, "topic", e.target.value)
                      }
                      placeholder="টপিক"
                      className="w-full px-2.5 py-1.5 text-xs bg-gray-50/70 border border-gray-200 rounded-lg focus:bg-white focus:border-[#15362C] outline-none"
                    />

                  </div>

                  <div>

                    <label className="block text-[10px] font-semibold text-gray-500 mb-0.5">
                      সাব-টপিক
                    </label>

                    <input
                      type="text"
                      list="subtopic-list"
                      value={item.sub_topic || ""}
                      onChange={(e) =>
                        updateBatchItem(idx, "sub_topic", e.target.value)
                      }
                      placeholder="সাব-টপিক"
                      className="w-full px-2.5 py-1.5 text-xs bg-gray-50/70 border border-gray-200 rounded-lg focus:bg-white focus:border-[#15362C] outline-none"
                    />

                  </div>

                  <div>

                    <label className="block text-[10px] font-semibold text-gray-500 mb-0.5">
                      পরীক্ষার নাম
                    </label>

                    <input
                      type="text"
                      list="examtaker-list"
                      value={item.exam_taker || ""}
                      onChange={(e) =>
                        updateBatchItem(idx, "exam_taker", e.target.value)
                      }
                      placeholder="পরীক্ষার নাম"
                      className="w-full px-2.5 py-1.5 text-xs bg-gray-50/70 border border-gray-200 rounded-lg focus:bg-white focus:border-[#15362C] outline-none"
                    />

                  </div>

                </div>

              </div>

            ))}

          </div>

        </div>

      )}

    </div>
  );
}
