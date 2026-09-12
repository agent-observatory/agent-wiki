import { Suspense } from "react";
import { Activity } from "@/components/wiki/connections";
import { Loading } from "@/components/wiki/common";
export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <Activity />
    </Suspense>
  );
}
