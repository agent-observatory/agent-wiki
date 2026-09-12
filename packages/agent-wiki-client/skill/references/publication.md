# Publication contract

For a separately assigned curation task or an explicit manual-recording request, save this JSON as a temporary local transport/retry file and send it with `agent-wiki publish file.json --project NAME`. Replace placeholders with actual IDs and the stored text returned by `source add`. The CLI never generates knowledge.

```json
{
  "idempotencyKey": "persist-a-unique-key-here",
  "producer": {"type": "agent", "client": "your-client", "skillVersion": "1"},
  "reason": "Why this knowledge changed",
  "inputs": [],
  "changes": [{
    "clientRef": "decision",
    "articleId": null,
    "baseRevision": null,
    "title": "A project decision",
    "content": "Use a single VM initially.",
    "kind": "memory",
    "folder": "Decisions",
    "tags": ["my-project"],
    "aliases": [],
    "claims": [{
      "anchor": "vm-choice",
      "text": "Use a single VM initially.",
      "type": "user_decision",
      "evidence": [{
        "sourceId": "REPLACE-WITH-SOURCE-UUID",
        "revision": 1,
        "lines": [1, 1],
        "quote": "REPLACE WITH EXACT STORED LINE"
      }]
    }],
    "links": [],
    "supersedes": []
  }]
}
```

For edits, set articleId and its current baseRevision. `inputs` can contain `{articleId, revision}` for knowledge read during refinement. `links` accepts existing article UUIDs or clientRef values within this batch. `supersedes` accepts existing article UUIDs. To select a project start Article, add `startContext: {tag: "my-project", articleRef: "decision"}`; that article must include the tag. Do not publish a Memory as the start document unless it actually contains the useful project overview.

Limits: 10 changes and 100KB total content per batch; 100 claims per change; 20 source references per claim. Sources are UTF-8 text of at most 100KB. Sources are immutable, revision 1. Claims must appear exactly in the content. Quote must equal all the lines in its inclusive range, joined with LF. An ungrounded entry must be `unconfirmed` or `author_statement`; an empty claims array becomes an author statement. Agent submissions cannot set human review fields.

A publication is atomic. Errors: `REVISION_CONFLICT` means fetch current revisions and reconcile; `EVIDENCE_MISMATCH` means fetch the stored source and fix the selected lines; `IDEMPOTENCY_CONFLICT` means the key was already used for different input. Never replace the key merely to bypass a revision conflict. A lost response is checked with `agent-wiki publication status KEY` before retrying the unchanged batch.
