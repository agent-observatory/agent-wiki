"use client";
import Link from "next/link";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useApi } from "@/lib/api";
import { Heading, Loading, Failure, When } from "./common";
import { KnowledgeClaims } from "./knowledge-claims";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
export function WikiPageDetail() {
  const { workspaceId, id } = useParams<{ workspaceId: string; id: string }>(),
    query = useSearchParams(),
    router = useRouter();
  const rev = query.get("revision"),
    root = `/workspaces/${workspaceId}/knowledge`;
  const { data, error } = useApi(
    `/api/workspaces/${workspaceId}/wiki-pages/${id}${rev ? "/revisions/" + rev : ""}`,
  );
  if (error) return <Failure error={error} />;
  if (!data) return <Loading />;
  return (
    <>
      <Link href={root} className="mb-6 block text-muted-foreground">
        ← Knowledge
      </Link>
      <Heading title={data.title} />
      <div className="mb-6 flex items-center gap-3">
        <Badge>Wiki Page</Badge>
        <Badge variant="outline">Claims {data.snapshot.claims.length}</Badge>
        {data.consolidation && (
          <Badge variant={data.consolidation.state === "needs_attention" ? "destructive" : "secondary"}>
            {data.consolidation.state === "needs_attention" ? "확인 필요" : "통합 대기"}
          </Badge>
        )}
        <When value={data.created_at} />
        <Select
          value={String(data.revision)}
          onValueChange={(r) =>
            router.push(`${root}/${id}?page=true&revision=${r}`)
          }
        >
          <SelectTrigger className="w-36" aria-label="페이지 Version">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {data.revisions.map((r: any) => (
              <SelectItem key={r.revision} value={String(r.revision)}>
                Version {r.revision}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {data.hasUnprocessedSources && (
        <p className="mb-4 text-sm text-amber-700 dark:text-amber-400">
          아직 처리하지 않은 원문이 있습니다. 이후 결정은 반영되지 않았을 수
          있습니다.
        </p>
      )}
      {data.revision !== data.currentRevision && (
        <p className="mb-4 text-sm">
          과거 Version입니다.{" "}
          <Link className="underline" href={`${root}/${id}?page=true`}>
            현재 페이지 보기
          </Link>
        </p>
      )}
      <KnowledgeClaims snapshot={data.snapshot} root={root} />
      {(() => {
        const at = data.content.indexOf("## Decision History");
        if (at < 0) return null;
        return (
          <article className="prose-wiki mt-10 max-w-3xl border-t pt-8">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {data.content.slice(at)}
            </ReactMarkdown>
          </article>
        );
      })()}
    </>
  );
}
