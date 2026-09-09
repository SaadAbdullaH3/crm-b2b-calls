import { MapperClient } from "./mapper-client";

// Next 16: dynamic route params are async in server components.
export default async function ImportMappingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <MapperClient importId={id} />;
}
