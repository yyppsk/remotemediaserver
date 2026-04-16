import express from "express";
import { promises as fsPromises, createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import mime from "mime-types";

const app = express();

const envPath = existsSync(path.resolve(process.cwd(), ".env"))
  ? path.resolve(process.cwd(), ".env")
  : path.resolve(process.cwd(), ".env.example");

dotenv.config({ path: envPath });

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8080);
const configuredMediaRoot = path.resolve(
  process.env.MEDIA_ROOT || path.join(process.cwd(), "media"),
);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WEB_DIST = path.resolve(__dirname, "../../web/dist");

let mediaRootRealPath = "";

const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".bmp",
  ".svg",
  ".avif",
]);

function safeDecode(value = "") {
  try {
    return decodeURIComponent(String(value));
  } catch {
    return String(value);
  }
}

function normalizeClientPath(value = "") {
  return safeDecode(value)
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

async function resolveInsideRoot(relativePath = "") {
  const cleaned = normalizeClientPath(relativePath);
  const candidatePath = path.resolve(mediaRootRealPath, cleaned);

  let realCandidate;
  try {
    realCandidate = await fsPromises.realpath(candidatePath);
  } catch {
    const err = new Error("Path not found");
    err.status = 404;
    throw err;
  }

  const relativeToRoot = path.relative(mediaRootRealPath, realCandidate);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    const err = new Error("Access outside MEDIA_ROOT is not allowed");
    err.status = 403;
    throw err;
  }

  return realCandidate;
}

function toPosixRelative(absolutePath) {
  return path
    .relative(mediaRootRealPath, absolutePath)
    .split(path.sep)
    .join("/");
}

function isImageFile(fileName) {
  return IMAGE_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    rootName: path.basename(mediaRootRealPath) || mediaRootRealPath,
  });
});

app.get("/api/files", async (req, res, next) => {
  try {
    const currentPath =
      typeof req.query.path === "string" ? req.query.path : "";
    const absoluteDirectory = await resolveInsideRoot(currentPath);
    const directoryStats = await fsPromises.stat(absoluteDirectory);

    if (!directoryStats.isDirectory()) {
      return res
        .status(400)
        .json({ error: "Requested path is not a directory" });
    }

    const dirents = await fsPromises.readdir(absoluteDirectory, {
      withFileTypes: true,
    });

    const visibleDirents = dirents.filter(
      (dirent) => !dirent.name.startsWith(".") && !dirent.isSymbolicLink(),
    );

    const items = await Promise.all(
      visibleDirents.map(async (dirent) => {
        const absoluteItem = path.join(absoluteDirectory, dirent.name);
        const itemStats = await fsPromises.stat(absoluteItem);
        const isDirectory = itemStats.isDirectory();
        const relativeItem = toPosixRelative(absoluteItem);

        return {
          name: dirent.name,
          path: relativeItem,
          kind: isDirectory ? "directory" : "file",
          size: isDirectory ? 0 : itemStats.size,
          modifiedAt: itemStats.mtime.toISOString(),
          extension: isDirectory
            ? null
            : path.extname(dirent.name).toLowerCase(),
          mimeType: isDirectory
            ? null
            : mime.lookup(dirent.name) || "application/octet-stream",
          isImage: !isDirectory && isImageFile(dirent.name),
        };
      }),
    );

    items.sort((a, b) => {
      if (a.kind !== b.kind) {
        return a.kind === "directory" ? -1 : 1;
      }
      return a.name.localeCompare(b.name, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });

    const normalizedCurrentPath = normalizeClientPath(currentPath);
    const parentPath = normalizedCurrentPath
      ? normalizedCurrentPath.split("/").slice(0, -1).join("/")
      : null;

    res.json({
      rootName: path.basename(mediaRootRealPath) || mediaRootRealPath,
      currentPath: normalizedCurrentPath,
      parentPath,
      items,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/file", async (req, res, next) => {
  try {
    const relativePath =
      typeof req.query.path === "string" ? req.query.path : "";

    if (!relativePath) {
      return res
        .status(400)
        .json({ error: 'Query parameter "path" is required' });
    }

    const absoluteFile = await resolveInsideRoot(relativePath);
    const fileStats = await fsPromises.stat(absoluteFile);

    if (!fileStats.isFile()) {
      return res.status(400).json({ error: "Requested path is not a file" });
    }

    const contentType = mime.lookup(absoluteFile) || "application/octet-stream";

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", fileStats.size);
    res.setHeader(
      "Content-Disposition",
      `inline; filename*=UTF-8''${encodeURIComponent(path.basename(absoluteFile))}`,
    );

    const stream = createReadStream(absoluteFile);
    stream.on("error", next);
    stream.pipe(res);
  } catch (error) {
    next(error);
  }
});

if (existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));

  app.get(/^\/(?!api(?:\/|$)).*/, (req, res, next) => {
    if (path.extname(req.path)) {
      return next();
    }

    return res.sendFile(path.join(WEB_DIST, "index.html"));
  });
}

app.use((req, res) => {
  if (req.path.startsWith("/api")) {
    return res.status(404).json({ error: "Not found" });
  }

  return res.status(404).send("Not found");
});

app.use((error, req, res, _next) => {
  const status = error.status || 500;
  console.error("[server error]", error);

  if (req.path.startsWith("/api")) {
    return res.status(status).json({
      error: error.message || "Internal server error",
    });
  }

  return res.status(status).send(error.message || "Internal server error");
});

async function start() {
  if (!existsSync(configuredMediaRoot)) {
    throw new Error(
      `MEDIA_ROOT does not exist: ${configuredMediaRoot} (loaded from ${envPath})`,
    );
  }

  mediaRootRealPath = await fsPromises.realpath(configuredMediaRoot);

  const stats = await fsPromises.stat(mediaRootRealPath);
  if (!stats.isDirectory()) {
    throw new Error(`MEDIA_ROOT is not a directory: ${mediaRootRealPath}`);
  }

  app.listen(PORT, HOST, () => {
    console.log(`[server] listening on http://${HOST}:${PORT}`);
    console.log(`[server] MEDIA_ROOT -> ${mediaRootRealPath}`);
    if (existsSync(WEB_DIST)) {
      console.log(`[server] serving built frontend from ${WEB_DIST}`);
    }
  });
}

start().catch((error) => {
  console.error("[startup failed]", error);
  process.exit(1);
});
