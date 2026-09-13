"use client";

import type { ReactNode } from "react";
import { Library } from "lucide-react";
import { Button } from "@/components/ui/button";
import ThemeToggle from "@/app/theme-toggle";

export function EntryFrame({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="absolute top-6 right-6">
        <ThemeToggle />
      </div>
      <section className="max-w-2xl space-y-6">
        <Library className="size-10" />
        <h1 className="text-3xl font-bold">Agent Wiki</h1>
        <p className="text-muted-foreground leading-7 whitespace-nowrap">
          에이전트의 결정과 근거를 보관하고 다시 활용하는 개인 위키.
        </p>
        {children}
      </section>
    </main>
  );
}

export function GitHubLogin() {
  return (
    <Button asChild>
      <a href="/api/auth/github">GitHub로 로그인</a>
    </Button>
  );
}

export function Login() {
  return <EntryFrame><GitHubLogin /></EntryFrame>;
}
