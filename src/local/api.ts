import type { Diagnostic } from "../ordo/index.ts";

// The local repo API (server/api.ts), as thin fetch wrappers. Every call names
// its repo: the server keeps no "current repo", so two browser tabs on two
// repos never move each other. A response outside 2xx throws ApiError, except
// where a status is an answer rather than a failure — a diagram that is not
// there (404 on a read), and a write the file refused (412, 422).

/** Each diagram is <repo>/.ordo/<tab>/ordo.yaml (server/diagrams.ts). */
export const DIAGRAM_FILE = "ordo.yaml";

export type Folder = { name: string; git: boolean; ordo: boolean };
export type FolderListing = { path: string; folders: Folder[]; truncated: boolean };
export type DiagramFile = { text: string; etag: string };

/** What a write requires of the file: still this ETag, or not there at all. */
export type Precondition = { ifMatch: string } | { ifNoneMatch: "*" };

export type WriteResult =
  | { ok: true; etag: string }
  | { ok: false; status: 412 }
  | { ok: false; status: 422; diagnostics: Diagnostic[] };

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    const said = (body as { error?: unknown } | null)?.error;
    super(typeof said === "string" ? said : `The server answered ${status}.`);
    this.status = status;
    this.body = body;
  }
}

const query = (params: Record<string, string>) => new URLSearchParams(params).toString();
const diagramUrl = (repo: string, tab: string) => `/api/diagrams/${encodeURIComponent(tab)}?${query({ repo })}`;

async function bodyOf(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function json<T>(res: Response): Promise<T> {
  const body = await bodyOf(res);
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

const etagOf = (res: Response, body?: { etag?: string }) => res.headers.get("ETag") ?? body?.etag ?? "";

export const getWorkspace = async (): Promise<{ label: string }> => json(await fetch("/api/workspace"));

export const listFolders = async (path: string): Promise<FolderListing> =>
  json(await fetch(`/api/folders?${query({ path })}`));

export const listDiagrams = async (repo: string): Promise<{ diagrams: string[] }> =>
  json(await fetch(`/api/diagrams?${query({ repo })}`));

export async function createDiagram(repo: string, name: string): Promise<DiagramFile> {
  const res = await fetch(`/api/diagrams?${query({ repo })}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const body = await json<DiagramFile>(res);
  return { text: body.text, etag: etagOf(res, body) };
}

/** The diagram's text and ETag, or null when it is not there. */
export async function readDiagramFile(repo: string, tab: string): Promise<DiagramFile | null> {
  const res = await fetch(diagramUrl(repo, tab), { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiError(res.status, await bodyOf(res));
  return { text: await res.text(), etag: etagOf(res) };
}

export async function writeDiagramFile(repo: string, tab: string, text: string, pre: Precondition): Promise<WriteResult> {
  const res = await fetch(diagramUrl(repo, tab), {
    method: "PUT",
    headers: {
      "Content-Type": "application/yaml",
      ...("ifMatch" in pre ? { "If-Match": pre.ifMatch } : { "If-None-Match": "*" }),
    },
    body: text,
  });
  if (res.status === 412) return { ok: false, status: 412 };
  if (res.status === 422) {
    const body = (await bodyOf(res)) as { diagnostics?: Diagnostic[] } | null;
    return { ok: false, status: 422, diagnostics: body?.diagnostics ?? [] };
  }
  const body = await json<{ etag?: string }>(res);
  return { ok: true, etag: etagOf(res, body) };
}
