import { Suspense } from "react";
import { SourceList } from "@/components/wiki/sources";
import { Loading } from "@/components/wiki/common";
export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <SourceList />
    </Suspense>
  );
}
