"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleLogout() {
    setPending(true);
    await fetch("/api/auth/logout", { method: "POST" });
    // Full navigation so the server re-reads the (now missing) session cookie.
    router.push("/login");
    router.refresh();
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="w-full"
      onClick={handleLogout}
      disabled={pending}
    >
      {pending ? "Signing out..." : "Sign out"}
    </Button>
  );
}
