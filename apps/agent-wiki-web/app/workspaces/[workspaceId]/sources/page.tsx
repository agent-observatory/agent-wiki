import { Suspense } from "react";
import { SourcesOverview } from "@/components/wiki/sources-overview";
import { Loading } from "@/components/wiki/common";
export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <SourcesOverview />
    </Suspense>
  );
}
