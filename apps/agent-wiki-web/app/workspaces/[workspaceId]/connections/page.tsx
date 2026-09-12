import { Suspense } from "react";
import { Connections } from "@/components/wiki/connections";
import { Loading } from "@/components/wiki/common";
export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <Connections />
    </Suspense>
  );
}
