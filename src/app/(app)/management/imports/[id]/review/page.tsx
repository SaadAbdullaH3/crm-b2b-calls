import { ReviewClient } from "./review-client";

export default async function ImportReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ReviewClient importId={id} />;
}
