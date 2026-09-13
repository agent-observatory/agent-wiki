"use client";
import { layerLabel } from "@/lib/layers";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  BookOpen,
  FileText,
  History,
  KeyRound,
  Library,
  Menu,
  LogOut,
  Cpu,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { api, useApi } from "@/lib/api";
import { Failure, Loading } from "./common";
import ThemeToggle from "@/app/theme-toggle";
import { Login } from "./entry";
export function Shell({
  workspaceId,
  children,
}: {
  workspaceId: string;
  children: React.ReactNode;
}) {
  const { data: me, error: authError } = useApi("/api/me");
  const { data: spaces, error } = useApi(me ? "/api/workspaces" : null);
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  if (authError && "status" in authError && authError.status === 401)
    return <Login />;
  if (authError || error)
    return (
      <main className="p-8">
        <Failure error={authError ?? error} />
      </main>
    );
  if (!spaces)
    return (
      <main className="p-8">
        <Loading />
      </main>
    );
  if (!spaces.items.some((x: any) => x.id === workspaceId))
    return (
      <main className="p-8">
        <p>접근할 수 없는 Workspace입니다.</p>
        <Link href="/workspaces">위키로 돌아가기</Link>
      </main>
    );
  const root = "/workspaces/" + workspaceId;
  const items = [
    ["knowledge", layerLabel("L3"), BookOpen],
    ["automation", layerLabel("L2"), Cpu],
    ["sources", layerLabel("L1"), FileText],
    ["activity", "반영 이력", History],
    ["connections", "에이전트 연결", KeyRound],
  ] as const;
  const nav = (
    <div className="flex h-full flex-col gap-6">
      <Link
        href={root + "/knowledge"}
        className="flex items-center gap-2 font-bold text-lg"
      >
        <Library className="size-5" />
        Agent Wiki
      </Link>
      <Select
        value={workspaceId}
        onValueChange={(id) => {
          setOpen(false);
          router.push("/workspaces/" + id + "/knowledge");
        }}
      >
        <SelectTrigger className="w-full" aria-label="Workspace">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {spaces.items.map((s: any) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <nav className="flex flex-col gap-1">
        {items.map(([path, label, Icon]) => (
          <Button
            key={path}
            asChild
            variant={
              pathname.startsWith(root + "/" + path) ? "secondary" : "ghost"
            }
            className="justify-start"
          >
            <Link
              href={root + "/" + path}
              onClick={() => setOpen(false)}
              aria-current={
                pathname.startsWith(root + "/" + path) ? "page" : undefined
              }
            >
              <Icon />
              {label}
            </Link>
          </Button>
        ))}
      </nav>
      <div className="mt-auto flex flex-col gap-3 text-xs text-muted-foreground">
        <span>{me.user.login} · 개인 위키</span>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            aria-label="로그아웃"
            onClick={async () => {
              await api("/api/auth/logout", { method: "POST", body: "{}" });
              location.href = "/";
            }}
          >
            <LogOut />
          </Button>
        </div>
      </div>
    </div>
  );
  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 hidden w-60 border-r bg-muted/20 p-6 md:block">
        {nav}
      </aside>
      <header className="flex items-center justify-between border-b px-5 py-3 md:hidden">
        <Link href={root + "/knowledge"} className="font-bold">
          Agent Wiki
        </Link>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="메뉴 열기">
              <Menu />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="p-6">
            <SheetTitle className="sr-only">메뉴</SheetTitle>
            {nav}
          </SheetContent>
        </Sheet>
      </header>
      <main className="min-w-0 px-5 py-8 md:ml-60 md:px-10 lg:px-14">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
