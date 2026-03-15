import { corsHeaders, verifyRequestAuth } from "./auth";
import { DocumentRoom } from "./document-room";

export { DocumentRoom };

type ProjectRole = "owner" | "editor" | "viewer";

interface Env {
  DOCUMENT_ROOM: DurableObjectNamespace;
  DB: D1Database;
  ALLOW_INSECURE_AUTH?: string;
}

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...corsHeaders(),
      ...(init?.headers ?? {}),
    },
  });
}

function textFileKind(path: string) {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "bib") {
    return "bib";
  }
  if (["tex", "sty", "cls"].includes(extension)) {
    return "tex";
  }
  return "text";
}

async function upsertUser(env: Env, user: Awaited<ReturnType<typeof verifyRequestAuth>>) {
  await env.DB.prepare(
    `INSERT INTO users (id, email, name, avatar_url)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(id) DO UPDATE SET
       email = excluded.email,
       name = excluded.name,
       avatar_url = excluded.avatar_url`,
  )
    .bind(user.id, user.email, user.name, user.avatarUrl)
    .run();
}

async function requireProjectRole(env: Env, projectId: string, userId: string) {
  const row = await env.DB.prepare(
    `SELECT role FROM project_members WHERE project_id = ?1 AND user_id = ?2 LIMIT 1`,
  )
    .bind(projectId, userId)
    .first<{ role: ProjectRole }>();

  if (!row) {
    throw json(
      {
        error: "forbidden",
        message: "You are not a member of this project.",
      },
      { status: 403 },
    );
  }

  return row.role;
}

async function ensureDocument(env: Env, projectId: string, path: string) {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO documents (id, project_id, path, kind)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(project_id, path) DO UPDATE SET
       kind = excluded.kind,
       updated_at = datetime('now')`,
  )
    .bind(id, projectId, path, textFileKind(path))
    .run();
}

function projectRoomStub(env: Env, projectId: string, path: string) {
  return env.DOCUMENT_ROOM.get(env.DOCUMENT_ROOM.idFromName(`${projectId}:${path}`));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === "/health") {
        return json({ ok: true });
      }

      const user = await verifyRequestAuth(request, env);
      await upsertUser(env, user);

      if (url.pathname === "/api/projects" && request.method === "GET") {
        const result = await env.DB.prepare(
          `SELECT p.id, p.name, p.root_main_file AS rootMainFile, pm.role, p.created_at AS createdAt, p.updated_at AS updatedAt
           FROM projects p
           INNER JOIN project_members pm ON pm.project_id = p.id
           WHERE pm.user_id = ?1
           ORDER BY p.updated_at DESC`,
        )
          .bind(user.id)
          .all();
        return json({ projects: result.results });
      }

      if (url.pathname === "/api/projects" && request.method === "POST") {
        const body = await request.json<unknown>().catch(() => null);
        const projectId = crypto.randomUUID();
        const name = readTrimmedString(isRecord(body) ? body.name : undefined) || "Untitled Project";
        const rootMainFile =
          readTrimmedString(isRecord(body) ? body.rootMainFile : undefined) || "main.tex";

        await env.DB.prepare(
          `INSERT INTO projects (id, name, owner_user_id, root_main_file)
           VALUES (?1, ?2, ?3, ?4)`,
        )
          .bind(projectId, name, user.id, rootMainFile)
          .run();
        await env.DB.prepare(
          `INSERT INTO project_members (project_id, user_id, role) VALUES (?1, ?2, 'owner')`,
        )
          .bind(projectId, user.id)
          .run();

        return json({ projectId, name, rootMainFile }, { status: 201 });
      }

      const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
      if (projectMatch && request.method === "GET") {
        const projectId = projectMatch[1];
        const role = await requireProjectRole(env, projectId, user.id);
        const project = await env.DB.prepare(
          `SELECT id, name, owner_user_id AS ownerUserId, root_main_file AS rootMainFile,
                  created_at AS createdAt, updated_at AS updatedAt
           FROM projects
           WHERE id = ?1
           LIMIT 1`,
        )
          .bind(projectId)
          .first();
        return json({ project, role });
      }

      const docsMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/documents$/);
      if (docsMatch && request.method === "GET") {
        const projectId = docsMatch[1];
        await requireProjectRole(env, projectId, user.id);
        const result = await env.DB.prepare(
          `SELECT id, project_id AS projectId, path, kind, latest_version AS latestVersion, updated_at AS updatedAt
           FROM documents
           WHERE project_id = ?1
           ORDER BY path ASC`,
        )
          .bind(projectId)
          .all();
        return json({ documents: result.results });
      }

      if (docsMatch && request.method === "POST") {
        const projectId = docsMatch[1];
        await requireProjectRole(env, projectId, user.id);
        const body = await request.json<unknown>().catch(() => null);
        const path = readTrimmedString(isRecord(body) ? body.path : undefined);
        if (!path) {
          return json({ error: "invalid_path" }, { status: 400 });
        }
        await ensureDocument(env, projectId, path);
        return json({ ok: true }, { status: 201 });
      }

      const snapshotMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/documents\/snapshot$/);
      if (snapshotMatch && request.method === "GET") {
        const projectId = snapshotMatch[1];
        await requireProjectRole(env, projectId, user.id);
        const path = url.searchParams.get("path")?.trim();
        if (!path) {
          return json({ error: "missing_path" }, { status: 400 });
        }
        await ensureDocument(env, projectId, path);
        const stub = projectRoomStub(env, projectId, path);
        const snapshotResponse = await stub.fetch("https://viewerleaf.internal/snapshot");
        return new Response(snapshotResponse.body, {
          status: snapshotResponse.status,
          headers: {
            "content-type": "application/octet-stream",
            "cache-control": "no-store",
            ...corsHeaders(),
          },
        });
      }

      const wsMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/ws$/);
      if (wsMatch) {
        const projectId = wsMatch[1];
        const role = await requireProjectRole(env, projectId, user.id);
        const path = url.searchParams.get("path")?.trim();
        if (!path) {
          return json({ error: "missing_path" }, { status: 400 });
        }
        await ensureDocument(env, projectId, path);
        const stub = projectRoomStub(env, projectId, path);
        const forwardedHeaders = new Headers(request.headers);
        forwardedHeaders.set("x-viewerleaf-user-id", user.id);
        forwardedHeaders.set("x-viewerleaf-role", role);
        return stub.fetch(
          new Request(`https://viewerleaf.internal/ws?path=${encodeURIComponent(path)}`, {
            method: request.method,
            headers: forwardedHeaders,
          }),
        );
      }

      const joinMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/join$/);
      if (joinMatch && request.method === "POST") {
        const projectId = joinMatch[1];
        const project = await env.DB.prepare(
          `SELECT id FROM projects WHERE id = ?1 LIMIT 1`,
        )
          .bind(projectId)
          .first();
        if (!project) {
          return json({ error: "not_found", message: "Project not found." }, { status: 404 });
        }
        await env.DB.prepare(
          `INSERT INTO project_members (project_id, user_id, role)
           VALUES (?1, ?2, 'editor')
           ON CONFLICT(project_id, user_id) DO NOTHING`,
        )
          .bind(projectId, user.id)
          .run();
        const row = await env.DB.prepare(
          `SELECT role FROM project_members WHERE project_id = ?1 AND user_id = ?2 LIMIT 1`,
        )
          .bind(projectId, user.id)
          .first<{ role: ProjectRole }>();
        return json({ ok: true, role: row?.role ?? "editor" });
      }

      const membersMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/members$/);
      if (membersMatch && request.method === "GET") {
        const projectId = membersMatch[1];
        await requireProjectRole(env, projectId, user.id);
        const result = await env.DB.prepare(
          `SELECT pm.user_id AS userId, pm.role, u.name, u.email, u.avatar_url AS avatarUrl
           FROM project_members pm INNER JOIN users u ON u.id = pm.user_id
           WHERE pm.project_id = ?1`,
        )
          .bind(projectId)
          .all();
        return json({ members: result.results });
      }

      return json({ error: "not_found" }, { status: 404 });
    } catch (error) {
      if (error instanceof Response) {
        return error;
      }
      console.error("worker request failed", error);
      return json(
        {
          error: "internal_error",
          message: error instanceof Error ? error.message : String(error),
        },
        { status: 500 },
      );
    }
  },
};
