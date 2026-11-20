import Image from "next/image";
import Link from "next/link";

const menuCards = [
  {
    id: 1,
    title: "প্রশ্ন স্ক্যান ও যুক্ত করুন",
    subtitle: "বইয়ের পাতার ছবি থেকে AI দিয়ে ব্যাচ MCQ যুক্ত করুন",
    href: "/admin",
    icon: "📸",
  },
  {
    id: 2,
    title: "প্রশ্নপত্র তৈরি করুন",
    subtitle: "টপিক ভিত্তিক বা সিলেক্ট করে প্রশ্নপত্র বানান",
    href: "/create-paper",
    icon: "🛠️",
  },
  {
    id: 3,
    title: "মডেল টেস্ট",
    subtitle: "অনলাইনে OMR শিটে পরীক্ষা দিন বা প্রিন্ট করুন",
    href: "/exam",
    icon: "📝",
  },
  {
    id: 4,
    title: "সংরক্ষিত প্রশ্নপত্র",
    subtitle: "আগে তৈরি করা সব প্রশ্নপত্রের তালিকা দেখুন",
    href: "/saved-papers",
    icon: "📚",
  },
];

export default function HomePage() {
  return (
    <div className="w-full flex flex-col">
      <div className="w-full overflow-hidden">
        <Image
          src="/banner.svg"
          alt="জব মডেল টেস্ট ব্যানার"
          width={1000}
          height={500}
          priority
          className="w-full h-auto object-cover"
        />
      </div>

      <div className="p-4 sm:p-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 md:gap-4">
          {menuCards.map((card) => (
            <Link
              key={card.id}
              href={card.href}
              className="group flex flex-col justify-between bg-white border border-gray-200/90 rounded-2xl p-4 sm:p-5 shadow-xs hover:border-[#15362C] hover:shadow-md transition-all duration-200 active:scale-[0.98]"
            >
              <div>
                <div className="w-11 h-11 rounded-xl bg-[#15362C]/10 flex items-center justify-center text-2xl mb-3 group-hover:bg-[#15362C] group-hover:text-white transition-colors">
                  {card.icon}
                </div>
                <h2 className="font-bold text-base sm:text-lg text-[#15362C] mb-1">
                  {card.title}
                </h2>
                <p className="text-xs sm:text-sm text-gray-500 leading-relaxed">
                  {card.subtitle}
                </p>
              </div>

              <div className="mt-4 flex items-center text-xs font-semibold text-[#15362C] opacity-80 group-hover:opacity-100 justify-end">
                <span>প্রবেশ করুন</span>
                <span className="ml-1 group-hover:translate-x-1 transition-transform">
                  →
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
