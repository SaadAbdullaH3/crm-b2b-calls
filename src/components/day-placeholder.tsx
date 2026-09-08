import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Day 1 placeholder. Each section renders one of these so the routing and role
 * gating can be verified end-to-end before any feature work exists.
 */
export function DayPlaceholder({
  title,
  description,
  upcoming,
}: {
  title: string;
  description: string;
  upcoming: { day: number; label: string }[];
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scheduled for this section</CardTitle>
          <CardDescription>
            Day 1 delivered the scaffold, schema, auth and role gating only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {upcoming.map((item) => (
              <li key={item.label} className="flex items-baseline gap-3 text-sm">
                <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">
                  Day {item.day}
                </span>
                <span>{item.label}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
