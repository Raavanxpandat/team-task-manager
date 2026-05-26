const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const PUBLIC_DIR = path.join(__dirname, "public");

const STATUSES = ["todo", "in-progress", "done"];
const ROLES = ["Admin", "Member"];

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function now() {
  return new Date().toISOString();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(hashPassword(password, salt).split(":")[1]));
}

function initialDb() {
  const adminId = id("usr");
  const memberId = id("usr");
  const projectId = id("prj");
  const taskId = id("tsk");
  return {
    users: [
      {
        id: adminId,
        name: "Admin User",
        email: "admin@example.com",
        passwordHash: hashPassword("admin123"),
        role: "Admin",
        createdAt: now()
      },
      {
        id: memberId,
        name: "Member User",
        email: "member@example.com",
        passwordHash: hashPassword("member123"),
        role: "Member",
        createdAt: now()
      }
    ],
    sessions: [],
    projects: [
      {
        id: projectId,
        name: "Website Relaunch",
        description: "Coordinate launch tasks, owners, and progress.",
        ownerId: adminId,
        memberIds: [adminId, memberId],
        createdAt: now()
      }
    ],
    tasks: [
      {
        id: taskId,
        projectId,
        title: "Prepare launch checklist",
        description: "Confirm copy, QA, deployment, and rollback steps.",
        assigneeId: memberId,
        status: "in-progress",
        dueDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
        createdBy: adminId,
        createdAt: now(),
        updatedAt: now()
      }
    ]
  };
}

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) writeDb(initialDb());
}

function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function writeDb(db) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

function sendError(res, status, message, details) {
  send(res, status, { error: message, details });
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function tokenFrom(req) {
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  return "";
}

function currentUser(req, db) {
  const token = tokenFrom(req);
  const session = db.sessions.find(item => item.token === token);
  if (!session) return null;
  return db.users.find(user => user.id === session.userId) || null;
}

function requireAuth(req, res, db) {
  const user = currentUser(req, db);
  if (!user) sendError(res, 401, "Authentication required");
  return user;
}

function requireAdmin(user, res) {
  if (user.role !== "Admin") {
    sendError(res, 403, "Admin role required");
    return false;
  }
  return true;
}

function validateRequired(body, fields) {
  return fields.filter(field => !String(body[field] || "").trim());
}

function canAccessProject(user, project) {
  return user.role === "Admin" || project.memberIds.includes(user.id);
}

function taskView(task, db) {
  const assignee = db.users.find(user => user.id === task.assigneeId);
  const project = db.projects.find(item => item.id === task.projectId);
  return {
    ...task,
    assigneeName: assignee ? assignee.name : "Unassigned",
    projectName: project ? project.name : "Unknown project",
    overdue: task.status !== "done" && task.dueDate < new Date().toISOString().slice(0, 10)
  };
}

function routeKey(method, pathname) {
  return `${method} ${pathname}`;
}

async function handleApi(req, res, pathname) {
  const db = readDb();
  const key = routeKey(req.method, pathname);

  if (key === "POST /api/auth/signup") {
    const body = await readBody(req);
    const missing = validateRequired(body, ["name", "email", "password"]);
    if (missing.length) return sendError(res, 400, "Missing required fields", missing);
    if (String(body.password).length < 6) return sendError(res, 400, "Password must be at least 6 characters");
    const email = String(body.email).trim().toLowerCase();
    if (db.users.some(user => user.email === email)) return sendError(res, 409, "Email already exists");
    const user = {
      id: id("usr"),
      name: String(body.name).trim(),
      email,
      passwordHash: hashPassword(String(body.password)),
      role: ROLES.includes(body.role) ? body.role : "Member",
      createdAt: now()
    };
    db.users.push(user);
    const token = id("ses");
    db.sessions.push({ token, userId: user.id, createdAt: now() });
    writeDb(db);
    return send(res, 201, { token, user: publicUser(user) });
  }

  if (key === "POST /api/auth/login") {
    const body = await readBody(req);
    const missing = validateRequired(body, ["email", "password"]);
    if (missing.length) return sendError(res, 400, "Missing required fields", missing);
    const user = db.users.find(item => item.email === String(body.email).trim().toLowerCase());
    if (!user || !verifyPassword(String(body.password), user.passwordHash)) {
      return sendError(res, 401, "Invalid email or password");
    }
    const token = id("ses");
    db.sessions.push({ token, userId: user.id, createdAt: now() });
    writeDb(db);
    return send(res, 200, { token, user: publicUser(user) });
  }

  if (key === "POST /api/auth/logout") {
    const token = tokenFrom(req);
    const next = { ...db, sessions: db.sessions.filter(session => session.token !== token) };
    writeDb(next);
    return send(res, 200, { ok: true });
  }

  const user = requireAuth(req, res, db);
  if (!user) return;

  if (key === "GET /api/me") return send(res, 200, { user: publicUser(user) });

  if (key === "GET /api/users") {
    const users = user.role === "Admin" ? db.users : db.users.filter(item => item.id === user.id);
    return send(res, 200, { users: users.map(publicUser) });
  }

  if (key === "GET /api/projects") {
    const projects = db.projects.filter(project => canAccessProject(user, project));
    return send(res, 200, { projects });
  }

  if (key === "POST /api/projects") {
    if (!requireAdmin(user, res)) return;
    const body = await readBody(req);
    const missing = validateRequired(body, ["name"]);
    if (missing.length) return sendError(res, 400, "Missing required fields", missing);
    const memberIds = Array.isArray(body.memberIds) ? body.memberIds.filter(Boolean) : [];
    const validMemberIds = [...new Set([user.id, ...memberIds])].filter(idValue => db.users.some(item => item.id === idValue));
    const project = {
      id: id("prj"),
      name: String(body.name).trim(),
      description: String(body.description || "").trim(),
      ownerId: user.id,
      memberIds: validMemberIds,
      createdAt: now()
    };
    db.projects.push(project);
    writeDb(db);
    return send(res, 201, { project });
  }

  const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (projectMatch && req.method === "PUT") {
    if (!requireAdmin(user, res)) return;
    const project = db.projects.find(item => item.id === projectMatch[1]);
    if (!project) return sendError(res, 404, "Project not found");
    const body = await readBody(req);
    if (body.name !== undefined) project.name = String(body.name).trim();
    if (body.description !== undefined) project.description = String(body.description).trim();
    if (Array.isArray(body.memberIds)) {
      project.memberIds = [...new Set([project.ownerId, ...body.memberIds])].filter(idValue => db.users.some(item => item.id === idValue));
    }
    writeDb(db);
    return send(res, 200, { project });
  }

  if (projectMatch && req.method === "DELETE") {
    if (!requireAdmin(user, res)) return;
    const projectId = projectMatch[1];
    if (!db.projects.some(item => item.id === projectId)) return sendError(res, 404, "Project not found");
    db.projects = db.projects.filter(item => item.id !== projectId);
    db.tasks = db.tasks.filter(task => task.projectId !== projectId);
    writeDb(db);
    return send(res, 200, { ok: true });
  }

  if (key === "GET /api/tasks") {
    const allowedProjectIds = db.projects.filter(project => canAccessProject(user, project)).map(project => project.id);
    const tasks = db.tasks.filter(task => allowedProjectIds.includes(task.projectId));
    return send(res, 200, { tasks: tasks.map(task => taskView(task, db)) });
  }

  if (key === "POST /api/tasks") {
    if (!requireAdmin(user, res)) return;
    const body = await readBody(req);
    const missing = validateRequired(body, ["projectId", "title", "assigneeId", "dueDate"]);
    if (missing.length) return sendError(res, 400, "Missing required fields", missing);
    const project = db.projects.find(item => item.id === body.projectId);
    if (!project) return sendError(res, 404, "Project not found");
    if (!project.memberIds.includes(body.assigneeId)) return sendError(res, 400, "Assignee must belong to the project team");
    const task = {
      id: id("tsk"),
      projectId: body.projectId,
      title: String(body.title).trim(),
      description: String(body.description || "").trim(),
      assigneeId: body.assigneeId,
      status: STATUSES.includes(body.status) ? body.status : "todo",
      dueDate: String(body.dueDate),
      createdBy: user.id,
      createdAt: now(),
      updatedAt: now()
    };
    db.tasks.push(task);
    writeDb(db);
    return send(res, 201, { task: taskView(task, db) });
  }

  const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
  if (taskMatch && req.method === "PUT") {
    const task = db.tasks.find(item => item.id === taskMatch[1]);
    if (!task) return sendError(res, 404, "Task not found");
    const project = db.projects.find(item => item.id === task.projectId);
    if (!project || !canAccessProject(user, project)) return sendError(res, 403, "Access denied");
    const body = await readBody(req);
    const adminFields = ["projectId", "title", "description", "assigneeId", "dueDate"];
    const changesAdminFields = adminFields.some(field => body[field] !== undefined);
    if (changesAdminFields && !requireAdmin(user, res)) return;
    if (body.projectId !== undefined) {
      const nextProject = db.projects.find(item => item.id === body.projectId);
      if (!nextProject) return sendError(res, 404, "Project not found");
      task.projectId = body.projectId;
    }
    if (body.title !== undefined) task.title = String(body.title).trim();
    if (body.description !== undefined) task.description = String(body.description).trim();
    if (body.assigneeId !== undefined) {
      const taskProject = db.projects.find(item => item.id === task.projectId);
      if (!taskProject.memberIds.includes(body.assigneeId)) return sendError(res, 400, "Assignee must belong to the project team");
      task.assigneeId = body.assigneeId;
    }
    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status)) return sendError(res, 400, "Invalid status");
      if (user.role !== "Admin" && task.assigneeId !== user.id) return sendError(res, 403, "Only the assignee or Admin can update status");
      task.status = body.status;
    }
    if (body.dueDate !== undefined) task.dueDate = String(body.dueDate);
    task.updatedAt = now();
    writeDb(db);
    return send(res, 200, { task: taskView(task, db) });
  }

  if (taskMatch && req.method === "DELETE") {
    if (!requireAdmin(user, res)) return;
    if (!db.tasks.some(item => item.id === taskMatch[1])) return sendError(res, 404, "Task not found");
    db.tasks = db.tasks.filter(item => item.id !== taskMatch[1]);
    writeDb(db);
    return send(res, 200, { ok: true });
  }

  if (key === "GET /api/dashboard") {
    const allowedProjectIds = db.projects.filter(project => canAccessProject(user, project)).map(project => project.id);
    const tasks = db.tasks.filter(task => allowedProjectIds.includes(task.projectId)).map(task => taskView(task, db));
    const summary = {
      projects: allowedProjectIds.length,
      tasks: tasks.length,
      todo: tasks.filter(task => task.status === "todo").length,
      inProgress: tasks.filter(task => task.status === "in-progress").length,
      done: tasks.filter(task => task.status === "done").length,
      overdue: tasks.filter(task => task.overdue).length
    };
    return send(res, 200, { summary, tasks });
  }

  sendError(res, 404, "API route not found");
}

function serveStatic(req, res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      return res.end("Not found");
    }
    const ext = path.extname(filePath).toLowerCase();
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json"
    };
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    res.end(content);
  });
}

async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url.pathname);
    } else {
      serveStatic(req, res, url.pathname);
    }
  } catch (error) {
    sendError(res, error.message === "Invalid JSON" ? 400 : 500, error.message);
  }
}

function selfTest() {
  const db = initialDb();
  const admin = db.users.find(user => user.role === "Admin");
  const member = db.users.find(user => user.role === "Member");
  const project = db.projects[0];
  if (!admin || !member || !project) throw new Error("Seed data failed");
  if (!verifyPassword("admin123", admin.passwordHash)) throw new Error("Password verification failed");
  if (!canAccessProject(member, project)) throw new Error("Member project access failed");
  if (!taskView(db.tasks[0], db).assigneeName) throw new Error("Task view failed");
  console.log("Self-test passed: auth, seed database, relationships, and task dashboard helpers are valid.");
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  ensureDb();
  http.createServer(handler).listen(PORT, () => {
    console.log(`Team Task Manager running at http://localhost:${PORT}`);
    console.log("Demo Admin: admin@example.com / admin123");
    console.log("Demo Member: member@example.com / member123");
  });
}
