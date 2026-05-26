const state = {
  token: localStorage.getItem("ttm_token") || "",
  user: JSON.parse(localStorage.getItem("ttm_user") || "null"),
  view: "dashboard",
  projects: [],
  tasks: [],
  users: [],
  dashboard: null,
  error: "",
  taskFilter: "all",
  taskSearch: ""
};

const app = document.querySelector("#app");

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(path, { ...options, headers });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function saveAuth(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem("ttm_token", token);
  localStorage.setItem("ttm_user", JSON.stringify(user));
}

function clearAuth() {
  state.token = "";
  state.user = null;
  localStorage.removeItem("ttm_token");
  localStorage.removeItem("ttm_user");
}

function isAdmin() {
  return state.user && state.user.role === "Admin";
}

function initials(name) {
  return String(name || "U")
    .split(" ")
    .map(part => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function formatDate(value) {
  if (!value) return "No due date";
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function statusLabel(status) {
  return {
    "todo": "To Do",
    "in-progress": "In Progress",
    "done": "Done"
  }[status] || status;
}

function filteredTasks() {
  const query = state.taskSearch.trim().toLowerCase();
  return state.tasks.filter(task => {
    const matchesStatus = state.taskFilter === "all" || task.status === state.taskFilter || (state.taskFilter === "overdue" && task.overdue);
    const haystack = `${task.title} ${task.description} ${task.projectName} ${task.assigneeName}`.toLowerCase();
    return matchesStatus && (!query || haystack.includes(query));
  });
}

async function loadData() {
  const [dashboard, projects, tasks, users] = await Promise.all([
    api("/api/dashboard"),
    api("/api/projects"),
    api("/api/tasks"),
    api("/api/users")
  ]);
  state.dashboard = dashboard.summary;
  state.projects = projects.projects;
  state.tasks = tasks.tasks;
  state.users = users.users;
}

function setError(message) {
  state.error = message || "";
  render();
}

function field(form, name) {
  return form.elements[name].value.trim();
}

function authScreen(mode = "login") {
  app.innerHTML = `
    <section class="auth-page">
      <div class="auth-panel">
        <div class="auth-copy">
          <div class="brand-mark">TT</div>
          <h1>Team Task Manager</h1>
          <p>Create projects, assign work, track progress, and keep Admin and Member permissions separated through REST APIs and a JSON NoSQL database.</p>
          <div class="auth-highlights">
            <span>REST API</span>
            <span>RBAC</span>
            <span>Dashboard</span>
          </div>
          <div class="demo-grid">
            <div>
              <small>Demo Admin</small>
              <strong>admin@example.com</strong>
              <span>admin123</span>
            </div>
            <div>
              <small>Demo Member</small>
              <strong>member@example.com</strong>
              <span>member123</span>
            </div>
          </div>
        </div>
        <form class="auth-form" id="authForm">
          <div>
            <h2>${mode === "login" ? "Welcome back" : "Create Account"}</h2>
            <p class="muted">${mode === "login" ? "Use a demo account or your own login." : "New users can be Admin or Member."}</p>
          </div>
          ${state.error ? `<div class="notice">${escapeHtml(state.error)}</div>` : ""}
          <div class="form-grid">
            <label class="${mode === "login" ? "hidden" : ""}">Name
              <input name="name" autocomplete="name" value="New Member">
            </label>
            <label>Email
              <input name="email" type="email" autocomplete="email" value="${mode === "login" ? "admin@example.com" : ""}" required>
            </label>
            <label>Password
              <input name="password" type="password" autocomplete="${mode === "login" ? "current-password" : "new-password"}" value="${mode === "login" ? "admin123" : ""}" required>
            </label>
            <label class="${mode === "login" ? "hidden" : ""}">Role
              <select name="role">
                <option>Member</option>
                <option>Admin</option>
              </select>
            </label>
          </div>
          <button class="btn primary" type="submit">${mode === "login" ? "Login" : "Sign Up"}</button>
          <button class="btn" type="button" id="switchAuth">${mode === "login" ? "Need an account? Sign up" : "Already have an account? Login"}</button>
        </form>
      </div>
    </section>
  `;

  document.querySelector("#switchAuth").addEventListener("click", () => {
    state.error = "";
    authScreen(mode === "login" ? "signup" : "login");
  });

  document.querySelector("#authForm").addEventListener("submit", async event => {
    event.preventDefault();
    try {
      const form = event.currentTarget;
      const body = mode === "login"
        ? { email: field(form, "email"), password: field(form, "password") }
        : { name: field(form, "name"), email: field(form, "email"), password: field(form, "password"), role: field(form, "role") };
      const data = await api(`/api/auth/${mode}`, { method: "POST", body: JSON.stringify(body) });
      saveAuth(data.token, data.user);
      state.error = "";
      await loadData();
      render();
    } catch (error) {
      setError(error.message);
    }
  });
}

function layout(content) {
  app.innerHTML = `
    <section class="shell">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-row">
            <span class="brand-icon">TT</span>
            <strong>Task Manager</strong>
          </div>
          <span>Full-stack assignment</span>
        </div>
        <nav class="nav">
          ${navButton("dashboard", "Dashboard", "01")}
          ${navButton("projects", "Projects & Team", "02")}
          ${navButton("tasks", "Tasks", "03")}
        </nav>
        <div class="user-box">
          <div class="avatar">${escapeHtml(initials(state.user.name))}</div>
          <div>
            <strong>${escapeHtml(state.user.name)}</strong><br>
            <span>${escapeHtml(state.user.email)} / ${escapeHtml(state.user.role)}</span>
          </div>
          <button class="btn ghost" id="logoutBtn">Logout</button>
        </div>
      </aside>
      <section class="content">
        ${state.error ? `<div class="notice">${escapeHtml(state.error)}</div>` : ""}
        ${content}
      </section>
    </section>
  `;

  document.querySelectorAll("[data-view]").forEach(button => {
    button.addEventListener("click", async () => {
      state.view = button.dataset.view;
      state.error = "";
      await refresh();
    });
  });

  document.querySelector("#logoutBtn").addEventListener("click", async () => {
    try {
      await api("/api/auth/logout", { method: "POST", body: "{}" });
    } catch {}
    clearAuth();
    authScreen();
  });
}

function navButton(view, label, number) {
  return `<button data-view="${view}" class="${state.view === view ? "active" : ""}"><span>${number}</span>${label}</button>`;
}

function dashboardView() {
  const summary = state.dashboard || { projects: 0, tasks: 0, todo: 0, inProgress: 0, done: 0, overdue: 0 };
  const completion = summary.tasks ? Math.round((summary.done / summary.tasks) * 100) : 0;
  layout(`
    <div class="topbar">
      <div>
        <h1>Dashboard</h1>
        <p class="muted">Track task volume, status, and overdue work.</p>
      </div>
      <button class="btn primary" data-view="tasks">New Task</button>
    </div>
    <section class="stats">
      ${stat("Projects", summary.projects, "Active workspaces")}
      ${stat("Tasks", summary.tasks, "Total assigned work")}
      ${stat("To Do", summary.todo, "Waiting to start")}
      ${stat("In Progress", summary.inProgress, "Currently moving")}
      ${stat("Done", summary.done, `${completion}% complete`)}
      ${stat("Overdue", summary.overdue, "Needs attention")}
    </section>
    <section class="panel focus-panel">
      <div class="panel-head">
        <div>
          <h2>Progress Overview</h2>
          <p class="muted">A quick read on team delivery health.</p>
        </div>
        <strong>${completion}%</strong>
      </div>
      <div class="progress-track"><span style="width:${completion}%"></span></div>
      <div class="status-row">
        <span><b>${summary.todo}</b> To Do</span>
        <span><b>${summary.inProgress}</b> In Progress</span>
        <span><b>${summary.done}</b> Done</span>
      </div>
    </section>
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>Recent Tasks</h2>
          <p class="muted">Latest visible assignments for your role.</p>
        </div>
      </div>
      <div class="list">${taskList(state.tasks.slice(0, 6))}</div>
    </section>
  `);
}

function stat(label, value, helper) {
  return `<div class="stat"><span>${label}</span><strong>${value}</strong><small>${helper}</small></div>`;
}

function projectsView() {
  layout(`
    <div class="topbar">
      <div>
        <h1>Projects & Team</h1>
        <p class="muted">${isAdmin() ? "Admins can create projects and assign team members." : "Members can view projects they belong to."}</p>
      </div>
    </div>
    <section class="grid">
      <form class="panel ${isAdmin() ? "" : "hidden"}" id="projectForm">
        <div class="panel-head"><h2>Create Project</h2></div>
        <label>Project name<input name="name" required></label>
        <label>Description<textarea name="description"></textarea></label>
        <label>Team members<select name="memberIds" multiple size="5">${userOptions()}</select></label>
        <button class="btn primary">Create Project</button>
      </form>
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>Projects</h2>
            <p class="muted">${state.projects.length} available to you</p>
          </div>
        </div>
        <div class="list">${projectList()}</div>
      </section>
    </section>
  `);

  const form = document.querySelector("#projectForm");
  if (form) {
    form.addEventListener("submit", async event => {
      event.preventDefault();
      try {
        const memberIds = [...form.elements.memberIds.selectedOptions].map(option => option.value);
        await api("/api/projects", {
          method: "POST",
          body: JSON.stringify({
            name: field(form, "name"),
            description: field(form, "description"),
            memberIds
          })
        });
        state.error = "";
        await refresh();
      } catch (error) {
        setError(error.message);
      }
    });
  }
}

function userOptions(selected = []) {
  return state.users.map(user => `<option value="${user.id}" ${selected.includes(user.id) ? "selected" : ""}>${escapeHtml(user.name)} (${user.role})</option>`).join("");
}

function projectList() {
  if (!state.projects.length) return `<div class="empty">No projects yet.</div>`;
  return state.projects.map(project => {
    const names = project.memberIds
      .map(id => state.users.find(user => user.id === id))
      .filter(Boolean)
      .map(user => user.name)
      .join(", ");
    return `
      <article class="item">
        <div class="item-head">
          <div>
            <h3>${escapeHtml(project.name)}</h3>
            <p class="muted">${escapeHtml(project.description || "No description")}</p>
          </div>
          <span class="badge">${project.memberIds.length} members</span>
        </div>
        <div class="meta-line"><strong>Team</strong><span>${escapeHtml(names || "No members")}</span></div>
        ${isAdmin() ? `<button class="btn danger slim" data-delete-project="${project.id}">Delete Project</button>` : ""}
      </article>
    `;
  }).join("");
}

function tasksView() {
  layout(`
    <div class="topbar">
      <div>
        <h1>Tasks</h1>
        <p class="muted">${isAdmin() ? "Admins create and assign tasks. Members update their assigned status." : "Update the status of tasks assigned to you."}</p>
      </div>
    </div>
    <section class="toolbar panel">
      <label>Search tasks
        <input id="taskSearch" value="${escapeHtml(state.taskSearch)}" placeholder="Search by title, project, or assignee">
      </label>
      <label>Status
        <select id="taskFilter">
          <option value="all" ${state.taskFilter === "all" ? "selected" : ""}>All tasks</option>
          <option value="todo" ${state.taskFilter === "todo" ? "selected" : ""}>To Do</option>
          <option value="in-progress" ${state.taskFilter === "in-progress" ? "selected" : ""}>In Progress</option>
          <option value="done" ${state.taskFilter === "done" ? "selected" : ""}>Done</option>
          <option value="overdue" ${state.taskFilter === "overdue" ? "selected" : ""}>Overdue</option>
        </select>
      </label>
    </section>
    <section class="grid">
      <form class="panel ${isAdmin() ? "" : "hidden"}" id="taskForm">
        <div class="panel-head"><h2>Create Task</h2></div>
        <label>Project<select name="projectId" required>${projectOptions()}</select></label>
        <label>Title<input name="title" required></label>
        <label>Description<textarea name="description"></textarea></label>
        <label>Assignee<select name="assigneeId" required>${userOptions()}</select></label>
        <label>Status<select name="status">${statusOptions()}</select></label>
        <label>Due date<input name="dueDate" type="date" required></label>
        <button class="btn primary">Create Task</button>
      </form>
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>Task List</h2>
            <p class="muted"><span id="taskMatchCount">${filteredTasks().length}</span> matching tasks</p>
          </div>
        </div>
        <div class="list" id="taskList">${taskList(filteredTasks())}</div>
      </section>
    </section>
  `);

  document.querySelector("#taskSearch").addEventListener("input", event => {
    state.taskSearch = event.currentTarget.value;
    updateTaskResults();
  });

  document.querySelector("#taskFilter").addEventListener("change", event => {
    state.taskFilter = event.currentTarget.value;
    updateTaskResults();
  });

  bindTaskActions();

  const form = document.querySelector("#taskForm");
  if (form) {
    form.elements.dueDate.value = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    form.addEventListener("submit", async event => {
      event.preventDefault();
      try {
        await api("/api/tasks", {
          method: "POST",
          body: JSON.stringify({
            projectId: field(form, "projectId"),
            title: field(form, "title"),
            description: field(form, "description"),
            assigneeId: field(form, "assigneeId"),
            status: field(form, "status"),
            dueDate: field(form, "dueDate")
          })
        });
        state.error = "";
        await refresh();
      } catch (error) {
        setError(error.message);
      }
    });
  }
}

function updateTaskResults() {
  const tasks = filteredTasks();
  document.querySelector("#taskMatchCount").textContent = String(tasks.length);
  document.querySelector("#taskList").innerHTML = taskList(tasks);
  bindTaskActions();
}

function bindTaskActions() {
  document.querySelectorAll("[data-status-task]").forEach(select => {
    select.addEventListener("change", async event => {
      try {
        await api(`/api/tasks/${event.currentTarget.dataset.statusTask}`, {
          method: "PUT",
          body: JSON.stringify({ status: event.currentTarget.value })
        });
        state.error = "";
        await refresh();
      } catch (error) {
        setError(error.message);
      }
    });
  });

  document.querySelectorAll("[data-delete-task]").forEach(button => {
    button.addEventListener("click", async event => {
      try {
        await api(`/api/tasks/${event.currentTarget.dataset.deleteTask}`, { method: "DELETE" });
        state.error = "";
        await refresh();
      } catch (error) {
        setError(error.message);
      }
    });
  });
}

function projectOptions() {
  return state.projects.map(project => `<option value="${project.id}">${escapeHtml(project.name)}</option>`).join("");
}

function statusOptions(selected = "todo") {
  return [
    ["todo", "To Do"],
    ["in-progress", "In Progress"],
    ["done", "Done"]
  ].map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`).join("");
}

function taskList(tasks) {
  if (!tasks.length) return `<div class="empty">No tasks found.</div>`;
  return tasks.map(task => `
    <article class="item task-card">
      <div class="item-head">
        <div>
          <h3>${escapeHtml(task.title)}</h3>
          <p class="muted">${escapeHtml(task.description || "No description")}</p>
        </div>
        <div class="badges">
          <span class="badge ${task.status}">${statusLabel(task.status)}</span>
          ${task.overdue ? `<span class="badge overdue">Overdue</span>` : ""}
        </div>
      </div>
      <div class="task-meta">
        <span><strong>Project</strong>${escapeHtml(task.projectName)}</span>
        <span><strong>Assignee</strong>${escapeHtml(task.assigneeName)}</span>
        <span><strong>Due</strong>${escapeHtml(formatDate(task.dueDate))}</span>
      </div>
      <div class="inline actions">
        <select data-status-task="${task.id}" ${!isAdmin() && task.assigneeId !== state.user.id ? "disabled" : ""}>${statusOptions(task.status)}</select>
        ${isAdmin() ? `<button class="btn danger slim" data-delete-task="${task.id}">Delete</button>` : ""}
      </div>
    </article>
  `).join("");
}

async function refresh() {
  try {
    await loadData();
    render();
  } catch (error) {
    clearAuth();
    authScreen();
    setError(error.message);
  }
}

function render() {
  if (!state.token || !state.user) return authScreen();
  if (state.view === "projects") return projectsView();
  if (state.view === "tasks") return tasksView();
  return dashboardView();
}

document.addEventListener("click", async event => {
  const projectButton = event.target.closest("[data-delete-project]");
  if (projectButton) {
    try {
      await api(`/api/projects/${projectButton.dataset.deleteProject}`, { method: "DELETE" });
      state.error = "";
      await refresh();
    } catch (error) {
      setError(error.message);
    }
  }
});

(async function start() {
  if (state.token) {
    try {
      await loadData();
    } catch {
      clearAuth();
    }
  }
  render();
})();
