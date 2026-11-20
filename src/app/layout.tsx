import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Noto_Sans_Bengali } from "next/font/google";
import "./globals.css";
import Navbar from "./shared/header/navbar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const notoBengali = Noto_Sans_Bengali({
  variable: "--font-bengali",
  subsets: ["bengali", "latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Job Model Test",
  description: "BCS & Bank Job Preparation Tool",
};

// মোবাইল অ্যাপ (PWA) ভিউপোর্ট এবং থিম কালার সেটআপ
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1, // ফোনে বাটনে বারবার ট্যাপ করলে যেন অনাকাঙ্ক্ষিত জুম না হয়
  themeColor: "#15362C", // অ্যান্ড্রয়েড স্ট্যাটাস বারের কালার আপনার প্রাইমারি কালারের সাথে মিলবে
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="bn"
      className={`${geistSans.variable} ${geistMono.variable} ${notoBengali.variable} antialiased`}
    >
      {/* bg-[#F8FAFC] সরানো হয়েছে যাতে globals.css এর ব্যাকগ্রাউন্ড ইমেজ দেখা যায় */}
      <body className="min-h-dvh flex flex-col items-center text-[#1E293B]">
        {/* মোবাইলে ফুল-উইডথ এবং বড় স্ক্রিনে max-w-3xl সেন্টারড কন্টেইনার */}
        <div className="w-full max-w-3xl min-h-dvh flex flex-col bg-white sm:shadow-sm sm:border-x border-gray-200/80">
          <Navbar />
          <main className="flex-1 w-full px-0 sm:py-3 sm:px-3 py-0 shadow-2xl">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
