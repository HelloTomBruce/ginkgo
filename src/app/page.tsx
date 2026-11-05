"use client";

import dynamic from "next/dynamic";
import { Suspense } from "react";

const ChatDashboard = dynamic(() => import("@/components/ChatDashboard"), {
  ssr: false,
});

export default function Page() {
  return (
    <Suspense fallback={<div className="h-screen bg-surface-sunken" />}>
      <ChatDashboard />
    </Suspense>
  );
}
