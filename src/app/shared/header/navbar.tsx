"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();

  // হোমপেজ ("/") হলে নেভবার হাইড থাকবে
  if (pathname === "/") {
    return null;
  }

  return (
    <header className="sticky top-0 z-50 w-full bg-white border-b border-gray-200 print:hidden">
      <div className="w-full px-3 sm:px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <Image
            src="/logo.jpg"
            alt="Job Model Test Logo"
            width={40}
            height={40}
            className="object-contain rounded-full"
          />
          <span className="font-bold text-lg text-[#15362C] hidden sm:block">
            Job Model Test
          </span>
        </Link>

        <button
          type="button"
          onClick={() => router.back()}
          className="p-1.5 rounded-full hover:bg-gray-100 active:bg-gray-200 transition-colors"
          aria-label="Back"
        >
          <Image
            src="/leftCircle.svg"
            alt="back"
            width={26}
            height={26}
            className="object-contain rounded-full"
          />
        </button>
      </div>
    </header>
  );
}