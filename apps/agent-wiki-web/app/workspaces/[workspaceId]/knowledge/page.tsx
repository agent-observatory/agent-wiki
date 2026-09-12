import { Suspense } from "react";
import { KnowledgeList } from "@/components/wiki/knowledge";
import { Loading } from "@/components/wiki/common";
export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <KnowledgeList />
    </Suspense>
  );
}
