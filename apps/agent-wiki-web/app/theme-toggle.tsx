"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Moon, Sun } from "lucide-react";

export default function ThemeToggle() {
  const [theme, setTheme] = useState("dark");
  useEffect(() => {
    setTheme(
      document.documentElement.dataset.theme === "light" ? "light" : "dark",
    );
    const sync = (event: StorageEvent) => {
      if (event.key !== "agent-wiki.theme.v1" && event.key !== null) return;
      const next = event.newValue === "light" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      document.documentElement.classList.toggle("dark", next === "dark");
      setTheme(next);
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  const dark = theme === "dark";
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={dark ? "라이트 테마로 전환" : "다크 테마로 전환"}
      onClick={() => {
        const next = dark ? "light" : "dark";
        document.documentElement.dataset.theme = next;
        document.documentElement.classList.toggle("dark", next === "dark");
        setTheme(next);
        try {
          localStorage.setItem("agent-wiki.theme.v1", next);
        } catch {
          /* Storage can be unavailable in private browsers. */
        }
      }}
    >
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </Button>
  );
}
