import { Suspense } from "react";
import { KnowledgeDetail } from "@/components/wiki/knowledge";
import { Loading } from "@/components/wiki/common";
export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <KnowledgeDetail />
    </Suspense>
  );
}
