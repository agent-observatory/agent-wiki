"use client";
export default function Error({ reset }: { reset: () => void }) {
  return (
    <div role="alert">
      화면을 불러오지 못했습니다. <button onClick={reset}>다시 시도</button>
    </div>
  );
}
