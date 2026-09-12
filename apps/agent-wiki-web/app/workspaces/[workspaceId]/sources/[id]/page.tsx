import { Suspense } from "react";
import { SourceDetail } from "@/components/wiki/sources";
import { Loading } from "@/components/wiki/common";
export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <SourceDetail />
    </Suspense>
  );
}
