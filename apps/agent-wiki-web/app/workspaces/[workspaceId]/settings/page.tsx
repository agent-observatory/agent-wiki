import { Suspense } from "react";
import { Settings } from "@/components/wiki/settings";
import { Loading } from "@/components/wiki/common";
export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <Settings />
    </Suspense>
  );
}
