"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

export default function Navbar() {
  const pathname = usePathname();

  // হোমপেজ ("/") হলে নেভবার হাইড থাকবে
  if (pathname === "/") {
    return null;
  }

  const navLinks = [
    { name: "পরীক্ষা দিন", href: "/exam" },
    { name: "প্রশ্নপত্র তৈরি", href: "/create-paper" },
    { name: "প্রশ্ন ব্যাংক", href: "/admin" },
  ];

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

        <nav className="flex items-center gap-1 sm:gap-3">
          {navLinks.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-[#15362C] text-white"
                    : "text-gray-700 hover:bg-gray-100 hover:text-[#15362C]"
                }`}
              >
                {link.name}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
