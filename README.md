# Team Task Manager

A full-stack assignment project where users can create projects, assign tasks, and track progress with role-based access control.

## Features

- Authentication: signup, login, logout
- Role-based access: Admin and Member
- Project and team management
- Task creation, assignment, status tracking, and deletion
- Dashboard summary for projects, tasks, status counts, and overdue tasks
- REST API with validation and relationships
- JSON-backed NoSQL database stored at `data/db.json`

## Run

```powershell
npm start
```

Open:

```text
http://localhost:3000
```

Demo accounts:

- Admin: `admin@example.com` / `admin123`
- Member: `member@example.com` / `member123`

## Test

```powershell
npm test
```

## REST API

- `POST /api/auth/signup`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/me`
- `GET /api/users`
- `GET /api/projects`
- `POST /api/projects` Admin only
- `PUT /api/projects/:id` Admin only
- `DELETE /api/projects/:id` Admin only
- `GET /api/tasks`
- `POST /api/tasks` Admin only
- `PUT /api/tasks/:id`
- `DELETE /api/tasks/:id` Admin only
- `GET /api/dashboard`
