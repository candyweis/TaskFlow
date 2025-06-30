const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Инициализация базы данных
require('./config/database');

// Импорт моделей
const User = require('./models/User');
const Project = require('./models/Project');
const Task = require('./models/Task');
const OverkillProject = require('./models/OverkillProject');

// Инициализация Telegram бота
const TaskFlowTelegramBot = require('./telegram-bot');
let telegramBot = null;

// Инициализируем бота
console.log('🤖 Starting Telegram bot initialization...');
try {
    telegramBot = new TaskFlowTelegramBot();
    console.log('✅ Telegram bot initialized successfully');
} catch (error) {
    console.warn('⚠️ Failed to initialize Telegram bot:', error.message);
    console.warn('⚠️ Bot functionality will be disabled');
    telegramBot = null;
}

// Функция для безопасного парсинга JSON
const safeJSONParse = (str, defaultValue = {}) => {
    if (typeof str === 'object') return str;
    if (typeof str !== 'string') return defaultValue;
    try {
        return JSON.parse(str);
    } catch (e) {
        console.warn('JSON parse error:', e);
        return defaultValue;
    }
};

// Middleware аутентификации
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, decoded) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid or expired token' });
        }
        
        req.user = {
            id: decoded.id,
            username: decoded.username,
            role: decoded.role,
            permissions: safeJSONParse(decoded.permissions, {})
        };
        next();
    });
};

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST", "PUT", "DELETE", "PATCH"]
    }
});

// Сохраняем io в глобальной области для использования в роутах
global.io = io;

// Middleware для логирования
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// =================== AUTH ROUTES ===================

// Логин
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }

        const user = await User.findByUsername(username);
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        if (!user.is_active) {
            return res.status(401).json({ error: 'Account is deactivated' });
        }

        // Безопасно парсим permissions
        const permissions = safeJSONParse(user.permissions, {});

        const token = jwt.sign(
            { 
                id: user.id, 
                username: user.username, 
                role: user.role,
                permissions: typeof permissions === 'object' ? JSON.stringify(permissions) : permissions
            },
            process.env.JWT_SECRET || 'your-secret-key',
            { expiresIn: '24h' }
        );

        res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                role: user.role,
                permissions: permissions
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Верификация токена
app.get('/api/auth/verify', authenticateToken, (req, res) => {
    res.json({ 
        valid: true, 
        user: req.user 
    });
});

// =================== USER ROUTES ===================

// Получить коллег
app.get('/api/users/colleagues', authenticateToken, async (req, res) => {
    try {
        const users = await User.findAll();
        res.json(users.map(user => ({
            id: user.id,
            username: user.username,
            role: user.role,
            permissions: safeJSONParse(user.permissions, {}),
            telegram: user.telegram,
            phone: user.phone,
            is_active: user.is_active
        })));
    } catch (error) {
        console.error('Error fetching colleagues:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Получить работников
app.get('/api/users/workers', authenticateToken, async (req, res) => {
    try {
        const users = await User.findAll();
        const workers = users.filter(user => user.role === 'worker' || user.role === 'manager');
        res.json(workers.map(user => ({
            id: user.id,
            username: user.username,
            role: user.role,
            permissions: safeJSONParse(user.permissions, {})
        })));
    } catch (error) {
        console.error('Error fetching workers:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// =================== PROJECT ROUTES ===================

// Получить все проекты
app.get('/api/projects', authenticateToken, async (req, res) => {
    try {
        const projects = await Project.findAll();
        res.json(projects.map(project => project.toPublic()));
    } catch (error) {
        console.error('Error fetching projects:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Создать проект
app.post('/api/projects', authenticateToken, async (req, res) => {
    try {
        const permissions = req.user.permissions || {};
        
        if (!permissions.canManageProjects && !permissions.canManageTasks && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'No permission to create projects' });
        }

        const { name, description } = req.body;
        
        if (!name || name.trim() === '') {
            return res.status(400).json({ error: 'Project name is required' });
        }

        const project = await Project.create({
            name: name.trim(),
            description: description ? description.trim() : '',
            created_by: req.user.id
        });

        // Real-time обновление: новый проект создан
        const newProject = await Project.findById(project.id);
        io.emit('project_created', {
            project: newProject.toPublic(),
            createdBy: {
                id: req.user.id,
                username: req.user.username
            }
        });

        res.status(201).json({ 
            message: 'Project created successfully',
            id: project.id
        });
        
    } catch (error) {
        console.error('Error creating project:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Удалить проект
app.delete('/api/projects/:id', authenticateToken, async (req, res) => {
    try {
        const permissions = req.user.permissions || {};
        
        if (!permissions.canManageProjects && req.user.role !== 'admin' && req.user.role !== 'manager') {
            return res.status(403).json({ error: 'Only managers and admins can delete projects' });
        }

        const { id } = req.params;

        const existingProject = await Project.findById(id);
        if (!existingProject) {
            return res.status(404).json({ error: 'Project not found' });
        }

        await Project.delete(id);

        // Real-time обновление: проект удален
        io.emit('project_deleted', {
            projectId: parseInt(id),
            deletedBy: {
                id: req.user.id,
                username: req.user.username
            }
        });

        res.json({ message: 'Project deleted successfully' });
        
    } catch (error) {
        console.error('Error deleting project:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// =================== OVERKILL PROJECT ROUTES ===================

// Получить все проекты overkill
app.get('/api/overkill-projects', authenticateToken, async (req, res) => {
    try {
        const projects = await OverkillProject.findAll();
        res.json(projects.map(project => project.toPublic()));
    } catch (error) {
        console.error('Error fetching overkill projects:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Создать проект overkill
app.post('/api/overkill-projects', authenticateToken, async (req, res) => {
    try {
        const { name, description, project_link } = req.body;
        
        if (!name || name.trim() === '') {
            return res.status(400).json({ error: 'Project name is required' });
        }

        const project = await OverkillProject.create({
            name: name.trim(),
            description: description ? description.trim() : '',
            project_link: project_link ? project_link.trim() : '',
            created_by: req.user.id
        });

        // Real-time обновление: новый overkill проект создан
        const newProject = await OverkillProject.findById(project.id);
        io.emit('overkill_project_created', {
            project: newProject.toPublic(),
            createdBy: {
                id: req.user.id,
                username: req.user.username
            }
        });

        res.status(201).json({ 
            message: 'Overkill project created successfully',
            id: project.id
        });
        
    } catch (error) {
        console.error('Error creating overkill project:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Удалить проект overkill
app.delete('/api/overkill-projects/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        const existingProject = await OverkillProject.findById(id);
        if (!existingProject) {
            return res.status(404).json({ error: 'Overkill project not found' });
        }

        await OverkillProject.delete(id);

        // Real-time обновление: overkill проект удален
        io.emit('overkill_project_deleted', {
            projectId: parseInt(id),
            deletedBy: {
                id: req.user.id,
                username: req.user.username
            }
        });

        res.json({ message: 'Overkill project deleted successfully' });
        
    } catch (error) {
        console.error('Error deleting overkill project:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// =================== TASK ROUTES ===================

// Получить архивированные задачи
app.get('/api/tasks/archived', authenticateToken, async (req, res) => {
    try {
        const tasks = await Task.findAll({ status: 'archived' });
        res.json(tasks.map(task => task.toPublic()));
    } catch (error) {
        console.error('Error fetching archived tasks:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Архивировать задачу
app.patch('/api/tasks/:id/archive', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        const task = await Task.findById(id);
        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const permissions = req.user.permissions || {};
        
        const canArchive = permissions.canManageTasks || 
                          req.user.role === 'admin' ||
                          (task.assignees && task.assignees.includes(req.user.id));

        if (!canArchive) {
            return res.status(403).json({ error: 'No permission to archive this task' });
        }

        const oldStatus = task.status;
        await Task.updateStatus(id, 'archived');

        // Real-time обновление: задача архивирована
        const updatedTask = await Task.findById(id);
        io.emit('task_status_changed', {
            task: updatedTask.toPublic(),
            oldStatus: oldStatus,
            newStatus: 'archived',
            changedBy: {
                id: req.user.id,
                username: req.user.username
            }
        });

        // Отправляем уведомление в Telegram
        if (telegramBot && telegramBot.isRunning) {
            telegramBot.notifyTaskStatusChange(id, oldStatus, 'archived', req.user.id);
        }

        res.json({ message: 'Task archived successfully' });
        
    } catch (error) {
        console.error('Error archiving task:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Восстановить задачу из архива
app.patch('/api/tasks/:id/unarchive', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        const task = await Task.findById(id);
        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const permissions = req.user.permissions || {};
        
        const canUnarchive = permissions.canManageTasks || 
                            req.user.role === 'admin';

        if (!canUnarchive) {
            return res.status(403).json({ error: 'No permission to unarchive this task' });
        }

        await Task.updateStatus(id, 'done');

        // Real-time обновление: задача восстановлена
        const updatedTask = await Task.findById(id);
        io.emit('task_status_changed', {
            task: updatedTask.toPublic(),
            oldStatus: 'archived',
            newStatus: 'done',
            changedBy: {
                id: req.user.id,
                username: req.user.username
            }
        });

        // Отправляем уведомление в Telegram
        if (telegramBot && telegramBot.isRunning) {
            telegramBot.notifyTaskStatusChange(id, 'archived', 'done', req.user.id);
        }

        res.json({ message: 'Task unarchived successfully' });
        
    } catch (error) {
        console.error('Error unarchiving task:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Получить комментарии к задаче
app.get('/api/tasks/:taskId/comments', authenticateToken, async (req, res) => {
    try {
        const { taskId } = req.params;
        
        const task = await Task.findById(taskId);
        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const permissions = req.user.permissions || {};
        const canView = permissions.canManageTasks || 
                       req.user.role === 'admin' ||
                       (task.assignees && task.assignees.includes(req.user.id));

        if (!canView) {
            return res.status(403).json({ error: 'No permission to view comments' });
        }

        const comments = await Task.getComments(taskId);
        res.json(comments);
    } catch (error) {
        console.error('Error fetching task comments:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Добавить комментарий к задаче
app.post('/api/tasks/:taskId/comments', authenticateToken, async (req, res) => {
    try {
        const { taskId } = req.params;
        const { comment } = req.body;
        
        if (!comment || comment.trim() === '') {
            return res.status(400).json({ error: 'Comment text is required' });
        }

        const task = await Task.findById(taskId);
        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const permissions = req.user.permissions || {};
        const canComment = permissions.canManageTasks || 
                          req.user.role === 'admin' ||
                          (task.assignees && task.assignees.includes(req.user.id));

        if (!canComment) {
            return res.status(403).json({ error: 'No permission to comment on this task' });
        }

        const newComment = await Task.addComment(taskId, req.user.id, comment.trim());

        // Real-time обновление: новый комментарий
        io.emit('task_comment_added', {
            taskId: parseInt(taskId),
            comment: {
                id: newComment.id,
                comment: comment.trim(),
                user_id: req.user.id,
                username: req.user.username,
                created_at: new Date().toISOString()
            }
        });

        // Отправляем уведомление в Telegram
        if (telegramBot && telegramBot.isRunning) {
            telegramBot.notifyNewComment(taskId, comment.trim(), req.user.id);
        }

        res.status(201).json({ 
            message: 'Comment added successfully',
            id: newComment.id
        });
        
    } catch (error) {
        console.error('Error creating task comment:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Обновить статус задачи
app.patch('/api/tasks/:id/status', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!status) {
            return res.status(400).json({ error: 'Status is required' });
        }

        const task = await Task.findById(id);
        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const permissions = req.user.permissions || {};
        
        const canChangeStatus = permissions.canManageTasks || 
                               req.user.role === 'admin' ||
                               (task.assignees && task.assignees.includes(req.user.id));
        
        if (!canChangeStatus) {
            return res.status(403).json({ error: 'No permission to change this status' });
        }

        const oldStatus = task.status;
        await Task.updateStatus(id, status);

        // Real-time обновление: статус изменен
        const updatedTask = await Task.findById(id);
        io.emit('task_status_changed', {
            task: updatedTask.toPublic(),
            oldStatus: oldStatus,
            newStatus: status,
            changedBy: {
                id: req.user.id,
                username: req.user.username
            }
        });

        // Отправляем уведомление в Telegram
        if (telegramBot && telegramBot.isRunning) {
            telegramBot.notifyTaskStatusChange(id, oldStatus, status, req.user.id);
        }

        res.json({ message: 'Task status updated successfully' });
        
    } catch (error) {
        console.error('Error updating task status:', error);
        if (error.message === 'Task not found') {
            res.status(404).json({ error: 'Task not found' });
        } else {
            res.status(500).json({ error: 'Database error' });
        }
    }
});

// Назначить задачу пользователю
app.post('/api/tasks/:id/assign', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { user_ids } = req.body;

        if (!user_ids || !Array.isArray(user_ids)) {
            return res.status(400).json({ error: 'User IDs array is required' });
        }

        const task = await Task.findById(id);
        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const permissions = req.user.permissions || {};
        
        const canAssign = permissions.canManageTasks || 
                         req.user.role === 'admin' ||
                         task.created_by === req.user.id;
        
        if (!canAssign) {
            return res.status(403).json({ error: 'No permission to assign this task' });
        }

        for (const userId of user_ids) {
            const user = await User.findById(userId);
            if (!user) {
                return res.status(400).json({ error: `User with id ${userId} not found` });
            }
        }

        await Task.update(id, {
            title: task.title,
            goal: task.goal,
            description: task.description,
            project_link: task.project_link,
            overkill_project_id: task.overkill_project_id,
            priority: task.priority,
            deadline: task.deadline,
            assignees: user_ids
        });

        // Real-time обновление: назначения изменены
        const updatedTask = await Task.findById(id);
        io.emit('task_assignees_changed', {
            task: updatedTask.toPublic(),
            oldAssignees: task.assignees || [],
            newAssignees: user_ids,
            changedBy: {
                id: req.user.id,
                username: req.user.username
            }
        });

        // Отправляем уведомление в Telegram новым участникам
        if (telegramBot && telegramBot.isRunning) {
            const newAssignees = user_ids.filter(userId => 
                !task.assignees || !task.assignees.includes(userId)
            );
            if (newAssignees.length > 0) {
                telegramBot.notifyTaskAssignment(id, newAssignees, req.user.id);
            }
        }

        res.json({ message: 'Task assigned successfully' });
        
    } catch (error) {
        console.error('Error assigning task:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Получить все задачи
app.get('/api/tasks', authenticateToken, async (req, res) => {
    try {
        const { project_id, status, assignee_id, priority, include_archived } = req.query;
        
        const filters = {};
        if (project_id) filters.project_id = project_id;
        if (status) filters.status = status;
        if (assignee_id) filters.assignee_id = assignee_id;
        if (priority) filters.priority = priority;
        
        if (!include_archived) {
            filters.exclude_archived = true;
        }
        
        const tasks = await Task.findAll(filters);
        res.json(tasks.map(task => task.toPublic()));
    } catch (error) {
        console.error('Error fetching tasks:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Получить задачу по ID
app.get('/api/tasks/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const task = await Task.findById(id);
        
        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        res.json(task.toPublic());
    } catch (error) {
        console.error('Error fetching task:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Создать задачу
app.post('/api/tasks', authenticateToken, async (req, res) => {
    try {
        const permissions = req.user.permissions || {};
        if (!permissions.canManageTasks && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'No permission to create tasks' });
        }

        const { title, goal, description, project_link, overkill_project_id, project_id, priority, deadline, assignees } = req.body;
        
        if (!title || title.trim() === '') {
            return res.status(400).json({ error: 'Task title is required' });
        }

        if (project_id) {
            const project = await Project.findById(project_id);
            if (!project) {
                return res.status(400).json({ error: 'Project not found' });
            }
        }

        if (assignees && assignees.length > 0) {
            for (const assigneeId of assignees) {
                const user = await User.findById(assigneeId);
                if (!user) {
                    return res.status(400).json({ error: `User with id ${assigneeId} not found` });
                }
            }
        }

        const task = await Task.create({
            title: title.trim(),
            goal: goal ? goal.trim() : '',
            description: description ? description.trim() : '',
            project_link: project_link ? project_link.trim() : '',
            overkill_project_id: overkill_project_id || null,
            project_id: project_id || null,
            priority,
            deadline,
            created_by: req.user.id,
            assignees: assignees || []
        });

        // Real-time обновление: новая задача создана
        const newTask = await Task.findById(task.id);
        io.emit('task_created', {
            task: newTask.toPublic(),
            createdBy: {
                id: req.user.id,
                username: req.user.username
            }
        });

        // Отправляем уведомление в Telegram
        if (telegramBot && telegramBot.isRunning && assignees && assignees.length > 0) {
            telegramBot.notifyTaskAssignment(task.id, assignees, req.user.id);
        }

        res.status(201).json({ 
            message: 'Task created successfully',
            id: task.id
        });
        
    } catch (error) {
        console.error('Error creating task:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Удалить задачу
app.delete('/api/tasks/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        const existingTask = await Task.findById(id);
        if (!existingTask) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const permissions = req.user.permissions || {};
        
        const canDelete = permissions.canManageTasks || 
                         req.user.role === 'admin' || 
                         req.user.role === 'manager';
        
        if (!canDelete) {
            return res.status(403).json({ error: 'Only managers and admins can delete tasks' });
        }

        await Task.delete(id);

        // Real-time обновление: задача удалена
        io.emit('task_deleted', {
            taskId: parseInt(id),
            deletedBy: {
                id: req.user.id,
                username: req.user.username
            }
        });

        res.json({ message: 'Task deleted successfully' });
        
    } catch (error) {
        console.error('Error deleting task:', error);
        if (error.message === 'Task not found') {
            res.status(404).json({ error: 'Task not found' });
        } else {
            res.status(500).json({ error: 'Database error' });
        }
    }
});

// =================== ADMIN ROUTES ===================

// Получить статистику
app.get('/api/admin/stats', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const users = await User.findAll();
        const projects = await Project.findAll();
        const tasks = await Task.findAll();

        const stats = {
            activeUsers: users.filter(u => u.is_active).length,
            totalProjects: projects.length,
            tasksByStatus: tasks.reduce((acc, task) => {
                acc[task.status] = (acc[task.status] || 0) + 1;
                return acc;
            }, {})
        };

        res.json(stats);
    } catch (error) {
        console.error('Error fetching admin stats:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Получить всех пользователей
app.get('/api/admin/users', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const users = await User.findAll();
        res.json(users.map(user => ({
            id: user.id,
            username: user.username,
            role: user.role,
            permissions: safeJSONParse(user.permissions, {}),
            telegram: user.telegram,
            phone: user.phone,
            telegram_chat_id: user.telegram_chat_id,
            is_active: user.is_active,
            created_at: user.created_at
        })));
    } catch (error) {
        console.error('Error fetching admin users:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Создать пользователя
app.post('/api/admin/users', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const { username, password, role, permissions, phone, telegram } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }

        const existingUser = await User.findByUsername(username);
        if (existingUser) {
            return res.status(400).json({ error: 'Username already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        
        const user = await User.create({
            username,
            password: hashedPassword,
            role: role || 'worker',
            permissions: JSON.stringify(permissions || {}),
            phone: phone || null,
            telegram: telegram || null
        });

        res.status(201).json({ 
            message: 'User created successfully',
            id: user.id
        });
        
    } catch (error) {
        console.error('Error creating user:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Обновить пользователя
app.put('/api/admin/users/:id', authenticateToken, async (req, res) => {
    try {
        console.log('📝 Updating user:', req.params.id);
        console.log('📝 Request body:', req.body);

        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const { id } = req.params;
        const { username, role, permissions, is_active, phone, telegram } = req.body;

        console.log('📝 Extracted data:', { username, role, permissions, is_active, phone, telegram });

        const existingUser = await User.findById(id);
        if (!existingUser) {
            console.log('❌ User not found:', id);
            return res.status(404).json({ error: 'User not found' });
        }

        console.log('📝 Existing user found:', existingUser.username);

        // Обновляем пользователя
        await User.update(id, {
            username: username || existingUser.username,
            role: role || existingUser.role,
            permissions: JSON.stringify(permissions || {}),
            is_active: is_active !== undefined ? is_active : existingUser.is_active,
            phone: phone || existingUser.phone,
            telegram: telegram || existingUser.telegram
        });

        console.log('✅ User updated successfully');
        res.json({ message: 'User updated successfully' });
        
    } catch (error) {
        console.error('❌ Error updating user:', error);
        res.status(500).json({ error: 'Database error: ' + error.message });
    }
});

// Удалить пользователя
app.delete('/api/admin/users/:id', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const { id } = req.params;

        if (id == 1) {
            return res.status(400).json({ error: 'Cannot delete main admin' });
        }

        const existingUser = await User.findById(id);
        if (!existingUser) {
            return res.status(404).json({ error: 'User not found' });
        }

        await User.delete(id);
        res.json({ message: 'User deleted successfully' });
        
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Socket.IO для real-time обновлений
io.on('connection', (socket) => {
    console.log('👤 User connected:', socket.id);
    
    // Присоединение к комнате проекта
    socket.on('join_project', (projectId) => {
        socket.join(`project_${projectId}`);
        console.log(`👤 User ${socket.id} joined project ${projectId}`);
    });
    
    // Присоединение к общей комнате
    socket.on('join_general', () => {
        socket.join('general');
        console.log(`👤 User ${socket.id} joined general room`);
    });
    
    // Уведомление о активности пользователя
    socket.on('user_activity', (data) => {
        socket.broadcast.emit('user_activity', {
            ...data,
            socketId: socket.id,
            timestamp: new Date().toISOString()
        });
    });
    
    socket.on('disconnect', () => {
        console.log('👤 User disconnected:', socket.id);
    });
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('📛 Shutting down server...');
    if (telegramBot) {
        await telegramBot.stop();
    }
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});

process.on('SIGTERM', async () => {
    console.log('📛 Shutting down server...');
    if (telegramBot) {
        await telegramBot.stop();
    }
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});

// Главная страница
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Админка
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/admin.html'));
});

// Обработка 404
app.use('*', (req, res) => {
    console.log('404 - Route not found:', req.originalUrl);
    res.status(404).json({ error: 'Route not found' });
});

// Обработка ошибок
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
});

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

server.listen(PORT, HOST, () => {
    console.log(`🚀 TaskFlow server running on ${HOST}:${PORT}`);
    console.log(`📱 Local access: http://localhost:${PORT}`);
    console.log(`🏠 Network access: http://192.168.1.7:${PORT}`);
    console.log(`👤 Default admin: admin / admin123`);
    console.log(`🤖 Telegram bot status: ${telegramBot ? 'Running' : 'Disabled'}`);
    console.log(`🔥 Real-time updates: Enabled`);
    console.log(`\n🌐 For GLOBAL access, use one of these methods:`);
    console.log(`   1. ngrok: ngrok http ${PORT}`);
    console.log(`   2. cloudflared: cloudflared tunnel --url http://localhost:${PORT}`);
    console.log(`   3. localtunnel: lt --port ${PORT}`);
});

module.exports = app;
