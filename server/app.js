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
const OverleafProject = require('./models/OverleafProject');
const Task = require('./models/Task');

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'taskflow-secret-key-2024-change-in-production';

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

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            console.error('Auth middleware error:', err);
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
            JWT_SECRET,
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

// Обновление профиля пользователя
app.put('/api/auth/profile', authenticateToken, async (req, res) => {
    try {
        const { newUsername, newPassword, confirmPassword } = req.body;
        const userId = req.user.id;

        // Проверяем подтверждение пароля
        if (newPassword && newPassword !== confirmPassword) {
            return res.status(400).json({ error: 'Passwords do not match' });
        }

        // Обновляем учетные данные
        const result = await User.updateCredentials(userId, newUsername, newPassword);

        // Если логин изменился, уведомляем в Telegram
        if (result.usernameChanged && telegramBot && telegramBot.isRunning) {
            telegramBot.notifyUsernameChange(userId, req.user.username, result.newUsername);
        }

        // Генерируем новый токен если логин изменился
        let newToken = null;
        if (result.usernameChanged) {
            const user = await User.findById(userId);
            const permissions = safeJSONParse(user.permissions, {});
            
            newToken = jwt.sign(
                { 
                    id: user.id, 
                    username: user.username, 
                    role: user.role,
                    permissions: typeof permissions === 'object' ? JSON.stringify(permissions) : permissions
                },
                JWT_SECRET,
                { expiresIn: '24h' }
            );
        }

        res.json({
            message: result.message,
            newToken: newToken,
            newUsername: result.newUsername
        });
    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
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
            vk: user.vk,
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

// Обновить проект
app.put('/api/projects/:id', authenticateToken, async (req, res) => {
    try {
        const permissions = req.user.permissions || {};
        
        if (!permissions.canManageProjects && req.user.role !== 'admin' && req.user.role !== 'manager') {
            return res.status(403).json({ error: 'No permission to edit projects' });
        }

        const { id } = req.params;
        const { name, description } = req.body;

        if (!name || name.trim() === '') {
            return res.status(400).json({ error: 'Project name is required' });
        }

        const existingProject = await Project.findById(id);
        if (!existingProject) {
            return res.status(404).json({ error: 'Project not found' });
        }

        await Project.update(id, {
            name: name.trim(),
            description: description ? description.trim() : ''
        });

        // Real-time обновление: проект обновлен
        const updatedProject = await Project.findById(id);
        io.emit('project_updated', {
            project: updatedProject.toPublic(),
            updatedBy: {
                id: req.user.id,
                username: req.user.username
            }
        });

        res.json({ message: 'Project updated successfully' });
        
    } catch (error) {
        console.error('Error updating project:', error);
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

// =================== OVERLEAF PROJECT ROUTES ===================

// Получить все проекты Overleaf
app.get('/api/overleaf-projects', authenticateToken, async (req, res) => {
    try {
        const projects = await OverleafProject.findAll();
        res.json(projects.map(project => project.toPublic()));
    } catch (error) {
        console.error('Error fetching overleaf projects:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Создать проект Overleaf
app.post('/api/overleaf-projects', authenticateToken, async (req, res) => {
    try {
        const { name, description, project_link } = req.body;
        
        if (!name || name.trim() === '') {
            return res.status(400).json({ error: 'Project name is required' });
        }

        const project = await OverleafProject.create({
            name: name.trim(),
            description: description ? description.trim() : '',
            project_link: project_link ? project_link.trim() : '',
            created_by: req.user.id
        });

        // Real-time обновление: новый overleaf проект создан
        const newProject = await OverleafProject.findById(project.id);
        io.emit('overleaf_project_created', {
            project: newProject.toPublic(),
            createdBy: {
                id: req.user.id,
                username: req.user.username
            }
        });

        res.status(201).json({ 
            message: 'Overleaf project created successfully',
            id: project.id
        });
        
    } catch (error) {
        console.error('Error creating overleaf project:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Обновить проект Overleaf
app.put('/api/overleaf-projects/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, project_link } = req.body;

        if (!name || name.trim() === '') {
            return res.status(400).json({ error: 'Project name is required' });
        }

        const existingProject = await OverleafProject.findById(id);
        if (!existingProject) {
            return res.status(404).json({ error: 'Overleaf project not found' });
        }

        await OverleafProject.update(id, {
            name: name.trim(),
            description: description ? description.trim() : '',
            project_link: project_link ? project_link.trim() : ''
        });

        // Real-time обновление: overleaf проект обновлен
        const updatedProject = await OverleafProject.findById(id);
        io.emit('overleaf_project_updated', {
            project: updatedProject.toPublic(),
            updatedBy: {
                id: req.user.id,
                username: req.user.username
            }
        });

        res.json({ message: 'Overleaf project updated successfully' });
        
    } catch (error) {
        console.error('Error updating overleaf project:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Удалить проект Overleaf
app.delete('/api/overleaf-projects/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        const existingProject = await OverleafProject.findById(id);
        if (!existingProject) {
            return res.status(404).json({ error: 'Overleaf project not found' });
        }

        await OverleafProject.delete(id);

        // Real-time обновление: overleaf проект удален
        io.emit('overleaf_project_deleted', {
            projectId: parseInt(id),
            deletedBy: {
                id: req.user.id,
                username: req.user.username
            }
        });

        res.json({ message: 'Overleaf project deleted successfully' });
        
    } catch (error) {
        console.error('Error deleting overleaf project:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// =================== TASK ROUTES ===================

// Получить архивированные задачи - ПЕРЕД общим эндпоинтом
app.get('/api/tasks/archived', authenticateToken, async (req, res) => {
    try {
        console.log('📊 Loading archived tasks...');
        const tasks = await Task.findAll({ status: 'archived' });
        console.log('📊 Found archived tasks:', tasks.length);
        res.json(tasks.map(task => task.toPublic()));
    } catch (error) {
        console.error('❌ Error fetching archived tasks:', error);
        res.status(500).json({ error: 'Database error: ' + error.message });
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

        const { 
            title, goal, description, project_link, overleaf_project_id, 
            project_id, priority, deadline, assignees, role_assignments 
        } = req.body;
        
        if (!title || title.trim() === '') {
            return res.status(400).json({ error: 'Task title is required' });
        }

        if (project_id) {
            const project = await Project.findById(project_id);
            if (!project) {
                return res.status(400).json({ error: 'Project not found' });
            }
        }

        if (overleaf_project_id) {
            const overleafProject = await OverleafProject.findById(overleaf_project_id);
            if (!overleafProject) {
                return res.status(400).json({ error: 'Overleaf project not found' });
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
            overleaf_project_id: overleaf_project_id || null,
            project_id: project_id || null,
            priority,
            deadline,
            created_by: req.user.id,
            assignees: assignees || [],
            role_assignments: role_assignments || {}
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

        // Отправляем уведомления в Telegram
        if (telegramBot && telegramBot.isRunning) {
            // Уведомления конкретным пользователям
            if (assignees && assignees.length > 0) {
                telegramBot.notifyTaskAssignment(task.id, assignees, req.user.id);
            }
            
            // Уведомления по ролям
            if (role_assignments) {
                for (const [role, assigned] of Object.entries(role_assignments)) {
                    if (assigned) {
                        telegramBot.notifyRoleAssignment(task.id, role, req.user.id);
                    }
                }
            }
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
        const { user_ids, role_assignments } = req.body;

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

        // Проверяем существование пользователей
        if (user_ids && user_ids.length > 0) {
            for (const userId of user_ids) {
                const user = await User.findById(userId);
                if (!user) {
                    return res.status(400).json({ error: `User with id ${userId} not found` });
                }
            }
        }

        // Обновляем назначения
        const updateData = {
            title: task.title,
            goal: task.goal,
            description: task.description,
            project_link: task.project_link,
            overleaf_project_id: task.overleaf_project_id,
            project_id: task.project_id,
            priority: task.priority,
            deadline: task.deadline,
            assignees: user_ids || [],
            role_assignments: role_assignments || {}
        };

        await Task.update(id, updateData);

        // Real-time обновление: назначения изменены
        const updatedTask = await Task.findById(id);
        io.emit('task_assignees_changed', {
            task: updatedTask.toPublic(),
            oldAssignees: task.assignees || [],
            newAssignees: user_ids || [],
            changedBy: {
                id: req.user.id,
                username: req.user.username
            }
        });

        // Отправляем уведомления в Telegram
        if (telegramBot && telegramBot.isRunning) {
            // Уведомления новым участникам
            if (user_ids && user_ids.length > 0) {
                const newAssignees = user_ids.filter(userId => 
                    !task.assignees || !task.assignees.includes(userId)
                );
                if (newAssignees.length > 0) {
                    telegramBot.notifyTaskAssignment(id, newAssignees, req.user.id);
                }
            }
            
            // Уведомления по ролям
            if (role_assignments) {
                for (const [role, assigned] of Object.entries(role_assignments)) {
                    if (assigned && (!task.role_assignments || !task.role_assignments[role])) {
                        telegramBot.notifyRoleAssignment(id, role, req.user.id);
                    }
                }
            }
        }

        res.json({ message: 'Task assigned successfully' });
        
    } catch (error) {
        console.error('Error assigning task:', error);
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

// =================== TIME LOGS ROUTES ===================

// Добавить лог времени
app.post('/api/tasks/time-logs', authenticateToken, async (req, res) => {
    try {
        const { task_id, hours_spent, comment } = req.body;

        if (!task_id || !hours_spent) {
            return res.status(400).json({ error: 'Task ID and hours spent are required' });
        }

        if (hours_spent <= 0 || hours_spent > 100) {
            return res.status(400).json({ error: 'Hours spent must be between 0.1 and 100' });
        }

        const query = `
            INSERT INTO task_time_logs (task_id, user_id, hours_spent, comment)
            VALUES (?, ?, ?, ?)
        `;
        
        const db = require('./config/database');
        db.run(query, [task_id, req.user.id, hours_spent, comment || ''], function(err) {
            if (err) {
                console.error('Error logging time:', err);
                return res.status(500).json({ error: 'Database error' });
            }
            
            res.status(201).json({
                message: 'Time logged successfully',
                log: {
                    id: this.lastID,
                    task_id,
                    user_id: req.user.id,
                    hours_spent,
                    comment: comment || ''
                }
            });
        });

    } catch (error) {
        console.error('Error logging time:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Получить логи времени для задачи
app.get('/api/tasks/time-logs/task/:taskId', authenticateToken, async (req, res) => {
    try {
        const { taskId } = req.params;

        const query = `
            SELECT tl.*, u.username
            FROM task_time_logs tl
            LEFT JOIN users u ON tl.user_id = u.id
            WHERE tl.task_id = ?
            ORDER BY tl.logged_at DESC
        `;
        
        const db = require('./config/database');
        db.all(query, [taskId], (err, rows) => {
            if (err) {
                console.error('Error fetching time logs:', err);
                return res.status(500).json({ error: 'Database error' });
            }
            
            res.json({
                time_logs: rows,
                total_time: rows.reduce((sum, log) => sum + log.hours_spent, 0)
            });
        });

    } catch (error) {
        console.error('Error fetching time logs:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// =================== ANALYTICS ROUTES ===================

// Общая статистика системы
app.get('/api/analytics/dashboard', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin' && req.user.role !== 'manager') {
            return res.status(403).json({ error: 'Access denied. Analytics available only for admins and managers.' });
        }

        const { period, employee_id, project_id } = req.query;
        
        // Определяем временной период
        let dateFilter = '';
        const params = [];
        
        if (period) {
            const now = new Date();
            let startDate;
            
            switch (period) {
                case 'week':
                    startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                    break;
                case 'month':
                    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                    break;
                case 'quarter':
                    const quarter = Math.floor(now.getMonth() / 3);
                    startDate = new Date(now.getFullYear(), quarter * 3, 1);
                    break;
                case 'year':
                    startDate = new Date(now.getFullYear(), 0, 1);
                    break;
            }
            
            if (startDate) {
                dateFilter = 'AND tl.logged_at >= ?';
                params.push(startDate.toISOString());
            }
        }

        // Отчет по времени сотрудников
        let timeQuery = `
            SELECT 
                u.username,
                u.id as user_id,
                COUNT(DISTINCT tl.task_id) as tasks_completed,
                SUM(tl.hours_spent) as total_hours,
                AVG(tl.hours_spent) as avg_hours_per_task,
                COUNT(tl.id) as time_logs_count
            FROM task_time_logs tl
            JOIN users u ON tl.user_id = u.id
            WHERE 1=1 ${dateFilter}
        `;

        if (employee_id) {
            timeQuery += ' AND u.id = ?';
            params.push(employee_id);
        }

        timeQuery += ' GROUP BY u.id, u.username ORDER BY total_hours DESC';

        const db = require('./config/database');
        const timeStats = await new Promise((resolve, reject) => {
            db.all(timeQuery, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        res.json({
            period: period || 'all_time',
            dashboard: {
                total_hours: timeStats.reduce((sum, stat) => sum + (stat.total_hours || 0), 0),
                tasks_with_time: timeStats.reduce((sum, stat) => sum + (stat.tasks_completed || 0), 0),
                time_logs_count: timeStats.reduce((sum, stat) => sum + (stat.time_logs_count || 0), 0),
                avg_hours_per_log: timeStats.length > 0 ? 
                    timeStats.reduce((sum, stat) => sum + (stat.avg_hours_per_task || 0), 0) / timeStats.length : 0
            },
            time_stats: timeStats,
            filters: {
                period,
                employee_id,
                project_id
            }
        });

    } catch (error) {
        console.error('Error generating analytics dashboard:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Экспорт данных в CSV
app.get('/api/analytics/export/:type', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin' && req.user.role !== 'manager') {
            return res.status(403).json({ error: 'Access denied. Analytics available only for admins and managers.' });
        }

        const { type } = req.params;
        const { format = 'csv', start_date, end_date, employee_id, project_id } = req.query;

        if (type !== 'time-logs') {
            return res.status(400).json({ error: 'Invalid export type' });
        }

        const timeQuery = `
            SELECT 
                u.username,
                t.title as task_title,
                t.complexity,
                t.priority,
                p.name as project_name,
                tl.hours_spent,
                tl.comment,
                tl.logged_at
            FROM task_time_logs tl
            JOIN users u ON tl.user_id = u.id
            JOIN tasks t ON tl.task_id = t.id
            LEFT JOIN projects p ON t.project_id = p.id
            WHERE 1=1
            ${start_date ? 'AND tl.logged_at >= ?' : ''}
            ${end_date ? 'AND tl.logged_at <= ?' : ''}
            ${employee_id ? 'AND tl.user_id = ?' : ''}
            ${project_id ? 'AND t.project_id = ?' : ''}
            ORDER BY tl.logged_at DESC
        `;
        
        const timeParams = [];
        if (start_date) timeParams.push(start_date);
        if (end_date) timeParams.push(end_date + ' 23:59:59');
        if (employee_id) timeParams.push(employee_id);
        if (project_id) timeParams.push(project_id);

        const db = require('./config/database');
        const data = await new Promise((resolve, reject) => {
            db.all(timeQuery, timeParams, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        if (format === 'csv') {
            const headers = ['Сотрудник', 'Задача', 'Сложность', 'Приоритет', 'Проект', 'Часы', 'Комментарий', 'Дата'];
            const csvContent = [
                headers.join(','),
                ...data.map(row => [
                    row.username,
                    `"${row.task_title}"`,
                    row.complexity || '',
                    row.priority || '',
                    row.project_name || '',
                    row.hours_spent,
                    `"${row.comment || ''}"`,
                    row.logged_at
                ].join(','))
            ].join('\n');

            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="time_logs_${new Date().toISOString().split('T')[0]}.csv"`);
            res.send('\uFEFF' + csvContent);
        } else {
            res.json({
                exported_at: new Date().toISOString(),
                data
            });
        }

    } catch (error) {
        console.error('Error exporting data:', error);
        res.status(500).json({ error: 'Export failed' });
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
            vk: user.vk,
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

        const { username, password, role, permissions, phone, telegram, vk } = req.body;
        
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
            telegram: telegram || null,
            vk: vk || null
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
        console.log('🔧 Updating user:', req.params.id);
        console.log('🔧 Request body:', req.body);

        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const { id } = req.params;
        const { username, role, permissions, is_active, phone, telegram, vk } = req.body;

        console.log('🔧 Extracted data:', { username, role, permissions, is_active, phone, telegram, vk });

        const existingUser = await User.findById(id);
        if (!existingUser) {
            console.log('❌ User not found:', id);
            return res.status(404).json({ error: 'User not found' });
        }

        console.log('🔧 Existing user found:', existingUser.username);

        // Обновляем пользователя
        await User.update(id, {
            username: username || existingUser.username,
            role: role || existingUser.role,
            permissions: JSON.stringify(permissions || {}),
            is_active: is_active !== undefined ? is_active : existingUser.is_active,
            phone: phone !== undefined ? phone : existingUser.phone,
            telegram: telegram !== undefined ? telegram : existingUser.telegram,
            vk: vk !== undefined ? vk : existingUser.vk
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
    console.log('🔌 User connected:', socket.id);
    
    // Присоединение к комнате проекта
    socket.on('join_project', (projectId) => {
        socket.join(`project_${projectId}`);
        console.log(`🔌 User ${socket.id} joined project ${projectId}`);
    });
    
    // Присоединение к общей комнате
    socket.on('join_general', () => {
        socket.join('general');
        console.log(`🔌 User ${socket.id} joined general room`);
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
        console.log('🔌 User disconnected:', socket.id);
    });
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('🔄 Shutting down server...');
    if (telegramBot) {
        await telegramBot.stop();
    }
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});

process.on('SIGTERM', async () => {
    console.log('🔄 Shutting down server...');
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
const HOST = 'localhost';

server.listen(PORT, HOST, () => {
    console.log(`🚀 TaskFlow server running on ${HOST}:${PORT}`);
    console.log(`🌐 Local access: http://localhost:${PORT}`);
    console.log(`🌐 Network access: http://192.168.1.7:${PORT}`);
    console.log(`🔑 Default admin: admin / admin123`);
    console.log(`🤖 Telegram bot status: ${telegramBot ? 'Running' : 'Disabled'}`);
    console.log(`🔄 Real-time updates: Enabled`);
    console.log(`\n🌐 For GLOBAL access, use one of these methods:`);
    console.log(`   1. ngrok: ngrok http ${PORT}`);
    console.log(`   2. cloudflared: cloudflared tunnel --url http://localhost:${PORT}`);
    console.log(`   3. localtunnel: lt --port ${PORT}`);
});

module.exports = app;
