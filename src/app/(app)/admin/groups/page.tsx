import { prisma } from "@/lib/db";
import { GroupsClient } from "./groups-client";

export default async function AdminGroupsPage() {
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: {
      id: true,
      fullName: true,
      email: true,
      role: { select: { name: true, label: true } },
    },
    orderBy: { fullName: "asc" },
  });

  return <GroupsClient allUsers={users} />;
}
