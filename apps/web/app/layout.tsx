import "@fontsource/noto-sans-kr/400.css";
import "@fontsource/noto-sans-kr/700.css";
import "./style.css";
import { TooltipProvider } from "@/components/ui/tooltip";
export const metadata = {
  title: "Agent Wiki",
  description: "작업과 질답에 근거를 더하는 개인 지식 공간",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" data-theme="dark" className="dark" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try { if (localStorage.getItem('agent-wiki.theme.v1') === 'light') { document.documentElement.dataset.theme = 'light'; document.documentElement.classList.remove('dark'); } } catch {}`,
          }}
        />
      </head>
      <body>
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
