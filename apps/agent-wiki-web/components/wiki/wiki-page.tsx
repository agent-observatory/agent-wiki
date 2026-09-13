"use client";
import Link from "next/link";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useApi } from "@/lib/api";
import { Heading, Loading, Failure, When } from "./common";
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
      {data.revision !== data.currentRevision && (
        <p className="mb-4 text-sm">
          과거 Version입니다.{" "}
          <Link className="underline" href={`${root}/${id}?page=true`}>
            현재 페이지 보기
          </Link>
        </p>
      )}
      <article className="prose-wiki max-w-3xl">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {data.content}
        </ReactMarkdown>
      </article>
    </>
  );
}
