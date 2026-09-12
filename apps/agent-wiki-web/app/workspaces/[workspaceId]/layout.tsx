import { Shell } from "@/components/wiki/shell";
export default async function Layout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  return <Shell workspaceId={workspaceId}>{children}</Shell>;
}
