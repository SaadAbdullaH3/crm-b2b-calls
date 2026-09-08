import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function ForbiddenPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-muted/30 p-4 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Not authorized</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Your role does not have access to this section. If you believe this is a
        mistake, contact an administrator.
      </p>
      <Link href="/" className={buttonVariants({ variant: "outline" })}>
        Back to your dashboard
      </Link>
    </div>
  );
}
