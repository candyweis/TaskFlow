const express = require('express');
const router = express.Router();
const Task = require('../models/Task');
const User = require('../models/User');
const Project = require('../models/Project');
const OverleafProject = require('../models/OverleafProject');

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

    const jwt = require('jsonwebtoken');
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

// Middleware для проверки прав на управление задачами
const requireTaskManagement = (req, res, next) => {
    const permissions = req.user.permissions || {};
    
    if (req.user.role === 'admin' || permissions.canManageTasks) {
        next();
    } else {
        res.status(403).json({ error: 'No permission to manage tasks' });
    }
};

// Middleware для проверки доступа к задаче
const checkTaskAccess = async (req, res, next) => {
    try {
        const taskId = req.params.id || req.params.taskId;
        const task = await Task.findById(taskId);
        
        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const permissions = req.user.permissions || {};
        
        // Проверяем доступ
        const hasAccess = permissions.canManageTasks || 
                         req.user.role === 'admin' ||
                         task.created_by === req.user.id ||
                         (task.assignees && task.assignees.includes(req.user.id));

        if (!hasAccess) {
            return res.status(403).json({ error: 'No access to this task' });
        }

        req.task = task;
        next();
    } catch (error) {
        console.error('Error checking task access:', error);
        res.status(500).json({ error: 'Database error' });
    }
};

// Получить все задачи с фильтрами
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { project_id, status, assignee_id, priority, include_archived, search, sort_by, limit, offset } = req.query;
        
        const filters = {};
        if (project_id) filters.project_id = project_id;
        if (status) filters.status = status;
        if (assignee_id) filters.assignee_id = assignee_id;
        if (priority) filters.priority = priority;
        if (search) filters.search = search;
        if (sort_by) filters.sort_by = sort_by;
        if (limit) filters.limit = parseInt(limit);
        if (offset) filters.offset = parseInt(offset);
        
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

// Получить архивированные задачи
router.get('/archived', authenticateToken, async (req, res) => {
    try {
        const tasks = await Task.findAll({ status: 'archived' });
        res.json(tasks.map(task => task.toPublic()));
    } catch (error) {
        console.error('Error fetching archived tasks:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Получить задачи с истекающим дедлайном
router.get('/upcoming-deadline', authenticateToken, async (req, res) => {
    try {
        const hours = parseInt(req.query.hours) || 24;
        const tasks = await Task.getTasksWithUpcomingDeadline(hours);
        res.json(tasks.map(task => task.toPublic()));
    } catch (error) {
        console.error('Error fetching upcoming deadline tasks:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Получить просроченные задачи
router.get('/overdue', authenticateToken, async (req, res) => {
    try {
        const tasks = await Task.getOverdueTasks();
        res.json(tasks.map(task => task.toPublic()));
    } catch (error) {
        console.error('Error fetching overdue tasks:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Получить задачи пользователя
router.get('/my', authenticateToken, async (req, res) => {
    try {
        const { status, exclude_archived, limit } = req.query;
        const options = {};
        
        if (status) options.status = status;
        if (exclude_archived) options.exclude_archived = true;
        if (limit) options.limit = parseInt(limit);
        
        const tasks = await Task.findByUser(req.user.id, options);
        res.json(tasks.map(task => task.toPublic()));
    } catch (error) {
        console.error('Error fetching user tasks:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Получить задачи по роли
router.get('/by-role/:role', authenticateToken, async (req, res) => {
    try {
        const { role } = req.params;
        const validRoles = ['tech', 'review', 'deploy'];
        
        if (!validRoles.includes(role)) {
            return res.status(400).json({ error: 'Invalid role' });
        }
        
        const tasks = await Task.findByRole(role);
        res.json(tasks.map(task => task.toPublic()));
    } catch (error) {
        console.error('Error fetching tasks by role:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Получить статистику задач
router.get('/stats', authenticateToken, async (req, res) => {
    try {
        const { project_id, exclude_archived, date_from, date_to } = req.query;
        const filters = {};
        
        if (project_id) filters.project_id = project_id;
        if (exclude_archived) filters.exclude_archived = true;
        if (date_from) filters.date_from = date_from;
        if (date_to) filters.date_to = date_to;
        
        const stats = await Task.getStats(filters);
        res.json(stats);
    } catch (error) {
        console.error('Error fetching task stats:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Получить задачу по ID
router.get('/:id', authenticateToken, checkTaskAccess, async (req, res) => {
    try {
        res.json(req.task.toPublic());
    } catch (error) {
        console.error('Error fetching task:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Создать задачу
router.post('/', authenticateToken, requireTaskManagement, async (req, res) => {
    try {
        const { 
            title, goal, description, project_link, overleaf_project_id, 
            project_id, priority, deadline, assignees, role_assignments 
        } = req.body;
        
        if (!title || title.trim() === '') {
            return res.status(400).json({ error: 'Task title is required' });
        }

        if (!deadline) {
            return res.status(400).json({ error: 'Deadline is required' });
        }

        // Проверяем существование проекта
        if (project_id) {
            const project = await Project.findById(project_id);
            if (!project) {
                return res.status(400).json({ error: 'Project not found' });
            }
        }

        // Проверяем существование Overleaf проекта
        if (overleaf_project_id) {
            const overleafProject = await OverleafProject.findById(overleaf_project_id);
            if (!overleafProject) {
                return res.status(400).json({ error: 'Overleaf project not found' });
            }
        }

        // Проверяем существование пользователей-исполнителей
        if (assignees && assignees.length > 0) {
            for (const assigneeId of assignees) {
                const user = await User.findById(assigneeId);
                if (!user) {
                    return res.status(400).json({ error: `User with id ${assigneeId} not found` });
                }
                if (!user.is_active) {
                    return res.status(400).json({ error: `User ${user.username} is not active` });
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
            priority: priority || 'medium',
            deadline,
            created_by: req.user.id,
            assignees: assignees || [],
            role_assignments: role_assignments || {}
        });

        // Real-time обновление: новая задача создана
        const newTask = await Task.findById(task.id);
        if (global.io) {
            global.io.emit('task_created', {
                task: newTask.toPublic(),
                createdBy: {
                    id: req.user.id,
                    username: req.user.username
                }
            });
        }

        // Отправляем уведомления в Telegram
        if (global.telegramBot && global.telegramBot.isRunning) {
            // Уведомления конкретным пользователям
            if (assignees && assignees.length > 0) {
                global.telegramBot.notifyTaskAssignment(task.id, assignees, req.user.id);
            }
            
            // Уведомления по ролям
            if (role_assignments) {
                for (const [role, assigned] of Object.entries(role_assignments)) {
                    if (assigned) {
                        global.telegramBot.notifyRoleAssignment(task.id, role, req.user.id);
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

// Обновить задачу
router.put('/:id', authenticateToken, checkTaskAccess, async (req, res) => {
    try {
        const permissions = req.user.permissions || {};
        
        // Проверяем права на редактирование
        const canEdit = permissions.canManageTasks || 
                       req.user.role === 'admin' ||
                       req.task.created_by === req.user.id;
        
        if (!canEdit) {
            return res.status(403).json({ error: 'No permission to edit this task' });
        }

        const { 
            title, goal, description, project_link, overleaf_project_id,
            project_id, priority, deadline, assignees, role_assignments 
        } = req.body;

        // Проверяем существование проекта
        if (project_id) {
            const project = await Project.findById(project_id);
            if (!project) {
                return res.status(400).json({ error: 'Project not found' });
            }
        }

        // Проверяем существование Overleaf проекта
        if (overleaf_project_id) {
            const overleafProject = await OverleafProject.findById(overleaf_project_id);
            if (!overleafProject) {
                return res.status(400).json({ error: 'Overleaf project not found' });
            }
        }

        // Проверяем существование пользователей-исполнителей
        if (assignees && assignees.length > 0) {
            for (const assigneeId of assignees) {
                const user = await User.findById(assigneeId);
                if (!user) {
                    return res.status(400).json({ error: `User with id ${assigneeId} not found` });
                }
            }
        }

        const updateData = {};
        if (title !== undefined) updateData.title = title.trim();
        if (goal !== undefined) updateData.goal = goal ? goal.trim() : '';
        if (description !== undefined) updateData.description = description ? description.trim() : '';
        if (project_link !== undefined) updateData.project_link = project_link ? project_link.trim() : '';
        if (overleaf_project_id !== undefined) updateData.overleaf_project_id = overleaf_project_id;
        if (project_id !== undefined) updateData.project_id = project_id;
        if (priority !== undefined) updateData.priority = priority;
        if (deadline !== undefined) updateData.deadline = deadline;
        if (assignees !== undefined) updateData.assignees = assignees;
        if (role_assignments !== undefined) updateData.role_assignments = role_assignments;

        await Task.update(req.params.id, updateData);

        // Real-time обновление: задача обновлена
        const updatedTask = await Task.findById(req.params.id);
        if (global.io) {
            global.io.emit('task_updated', {
                task: updatedTask.toPublic(),
                updatedBy: {
                    id: req.user.id,
                    username: req.user.username
                }
            });
        }

        res.json({ message: 'Task updated successfully' });
        
    } catch (error) {
        console.error('Error updating task:', error);
        if (error.message === 'Task not found') {
            res.status(404).json({ error: 'Task not found' });
        } else {
            res.status(500).json({ error: 'Database error' });
        }
    }
});

// Обновить статус задачи
router.patch('/:id/status', authenticateToken, checkTaskAccess, async (req, res) => {
    try {
        const { status } = req.body;

        if (!status) {
            return res.status(400).json({ error: 'Status is required' });
        }

        const validStatuses = ['unassigned', 'in_progress', 'developed', 'review', 'deploy', 'done', 'archived'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        const permissions = req.user.permissions || {};
        
        const canChangeStatus = permissions.canManageTasks || 
                               req.user.role === 'admin' ||
                               (req.task.assignees && req.task.assignees.includes(req.user.id));
        
        if (!canChangeStatus) {
            return res.status(403).json({ error: 'No permission to change this status' });
        }

        const oldStatus = req.task.status;
        await Task.updateStatus(req.params.id, status);

        // Real-time обновление: статус изменен
        const updatedTask = await Task.findById(req.params.id);
        if (global.io) {
            global.io.emit('task_status_changed', {
                task: updatedTask.toPublic(),
                oldStatus: oldStatus,
                newStatus: status,
                changedBy: {
                    id: req.user.id,
                    username: req.user.username
                }
            });
        }

        // Отправляем уведомление в Telegram
        if (global.telegramBot && global.telegramBot.isRunning) {
            global.telegramBot.notifyTaskStatusChange(req.params.id, oldStatus, status, req.user.id);
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
router.post('/:id/assign', authenticateToken, checkTaskAccess, async (req, res) => {
    try {
        const { user_ids, role_assignments } = req.body;

        const permissions = req.user.permissions || {};
        
        const canAssign = permissions.canManageTasks || 
                         req.user.role === 'admin' ||
                         req.task.created_by === req.user.id;
        
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
                if (!user.is_active) {
                    return res.status(400).json({ error: `User ${user.username} is not active` });
                }
            }
        }

        // Обновляем назначения
        const updateData = {
            title: req.task.title,
            goal: req.task.goal,
            description: req.task.description,
            project_link: req.task.project_link,
            overleaf_project_id: req.task.overleaf_project_id,
            project_id: req.task.project_id,
            priority: req.task.priority,
            deadline: req.task.deadline,
            assignees: user_ids || [],
            role_assignments: role_assignments || {}
        };

        await Task.update(req.params.id, updateData);

        // Real-time обновление: назначения изменены
        const updatedTask = await Task.findById(req.params.id);
        if (global.io) {
            global.io.emit('task_assignees_changed', {
                task: updatedTask.toPublic(),
                oldAssignees: req.task.assignees || [],
                newAssignees: user_ids || [],
                changedBy: {
                    id: req.user.id,
                    username: req.user.username
                }
            });
        }

        // Отправляем уведомления в Telegram
        if (global.telegramBot && global.telegramBot.isRunning) {
            // Уведомления новым участникам
            if (user_ids && user_ids.length > 0) {
                const newAssignees = user_ids.filter(userId => 
                    !req.task.assignees || !req.task.assignees.includes(userId)
                );
                if (newAssignees.length > 0) {
                    global.telegramBot.notifyTaskAssignment(req.params.id, newAssignees, req.user.id);
                }
            }
            
            // Уведомления по ролям
            if (role_assignments) {
                for (const [role, assigned] of Object.entries(role_assignments)) {
                    if (assigned && (!req.task.role_assignments || !req.task.role_assignments[role])) {
                        global.telegramBot.notifyRoleAssignment(req.params.id, role, req.user.id);
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

// Архивировать задачу
router.patch('/:id/archive', authenticateToken, checkTaskAccess, async (req, res) => {
    try {
        const permissions = req.user.permissions || {};
        
        const canArchive = permissions.canManageTasks || 
                          req.user.role === 'admin' ||
                          (req.task.assignees && req.task.assignees.includes(req.user.id));

        if (!canArchive) {
            return res.status(403).json({ error: 'No permission to archive this task' });
        }

        const oldStatus = req.task.status;
        await Task.updateStatus(req.params.id, 'archived');

        // Real-time обновление: задача архивирована
        const updatedTask = await Task.findById(req.params.id);
        if (global.io) {
            global.io.emit('task_status_changed', {
                task: updatedTask.toPublic(),
                oldStatus: oldStatus,
                newStatus: 'archived',
                changedBy: {
                    id: req.user.id,
                    username: req.user.username
                }
            });
        }

        // Отправляем уведомление в Telegram
        if (global.telegramBot && global.telegramBot.isRunning) {
            global.telegramBot.notifyTaskStatusChange(req.params.id, oldStatus, 'archived', req.user.id);
        }

        res.json({ message: 'Task archived successfully' });
        
    } catch (error) {
        console.error('Error archiving task:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Восстановить задачу из архива
router.patch('/:id/unarchive', authenticateToken, async (req, res) => {
    try {
        const task = await Task.findById(req.params.id);
        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const permissions = req.user.permissions || {};
        
        const canUnarchive = permissions.canManageTasks || 
                            req.user.role === 'admin';

        if (!canUnarchive) {
            return res.status(403).json({ error: 'No permission to unarchive this task' });
        }

        await Task.updateStatus(req.params.id, 'done');

        // Real-time обновление: задача восстановлена
        const updatedTask = await Task.findById(req.params.id);
        if (global.io) {
            global.io.emit('task_status_changed', {
                task: updatedTask.toPublic(),
                oldStatus: 'archived',
                newStatus: 'done',
                changedBy: {
                    id: req.user.id,
                    username: req.user.username
                }
            });
        }

        // Отправляем уведомление в Telegram
        if (global.telegramBot && global.telegramBot.isRunning) {
            global.telegramBot.notifyTaskStatusChange(req.params.id, 'archived', 'done', req.user.id);
        }

        res.json({ message: 'Task unarchived successfully' });
        
    } catch (error) {
        console.error('Error unarchiving task:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Клонировать задачу
router.post('/:id/clone', authenticateToken, checkTaskAccess, requireTaskManagement, async (req, res) => {
    try {
        const overrides = req.body;
        
        const clonedTask = await Task.clone(req.params.id, {
            ...overrides,
            created_by: req.user.id
        });

        // Real-time обновление: задача клонирована
        const newTask = await Task.findById(clonedTask.id);
        if (global.io) {
            global.io.emit('task_created', {
                task: newTask.toPublic(),
                createdBy: {
                    id: req.user.id,
                    username: req.user.username
                }
            });
        }

        res.status(201).json({ 
            message: 'Task cloned successfully',
            id: clonedTask.id
        });
        
    } catch (error) {
        console.error('Error cloning task:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Удалить задачу
router.delete('/:id', authenticateToken, checkTaskAccess, async (req, res) => {
    try {
        const permissions = req.user.permissions || {};
        
        const canDelete = permissions.canManageTasks || 
                         req.user.role === 'admin' || 
                         req.user.role === 'manager';
        
        if (!canDelete) {
            return res.status(403).json({ error: 'Only managers and admins can delete tasks' });
        }

        await Task.delete(req.params.id);

        // Real-time обновление: задача удалена
        if (global.io) {
            global.io.emit('task_deleted', {
                taskId: parseInt(req.params.id),
                deletedBy: {
                    id: req.user.id,
                    username: req.user.username
                }
            });
        }

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

// Получить комментарии к задаче
router.get('/:taskId/comments', authenticateToken, checkTaskAccess, async (req, res) => {
    try {
        const comments = await Task.getComments(req.params.taskId);
        res.json(comments);
    } catch (error) {
        console.error('Error fetching task comments:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Добавить комментарий к задаче
router.post('/:taskId/comments', authenticateToken, checkTaskAccess, async (req, res) => {
    try {
        const { comment } = req.body;
        
        if (!comment || comment.trim() === '') {
            return res.status(400).json({ error: 'Comment text is required' });
        }

        const newComment = await Task.addComment(req.params.taskId, req.user.id, comment.trim());

        // Real-time обновление: новый комментарий
        if (global.io) {
            global.io.emit('task_comment_added', {
                taskId: parseInt(req.params.taskId),
                comment: {
                    id: newComment.id,
                    comment: comment.trim(),
                    user_id: req.user.id,
                    username: req.user.username,
                    created_at: new Date().toISOString()
                }
            });
        }

        // Отправляем уведомление в Telegram
        if (global.telegramBot && global.telegramBot.isRunning) {
            global.telegramBot.notifyNewComment(req.params.taskId, comment.trim(), req.user.id);
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

router.post('/:id/split', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { subtasks } = req.body;

        // Проверяем доступ к задаче
        const task = await Task.findById(id);
        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const permissions = req.user.permissions || {};
        const canSplit = permissions.canManageTasks || 
                        req.user.role === 'admin' ||
                        task.created_by === req.user.id;

        if (!canSplit) {
            return res.status(403).json({ error: 'No permission to split this task' });
        }

        if (!subtasks || subtasks.length === 0) {
            return res.status(400).json({ error: 'Subtasks are required' });
        }

        // Валидируем подзадачи
        for (const subtask of subtasks) {
            if (!subtask.title || !subtask.deadline) {
                return res.status(400).json({ error: 'Each subtask must have title and deadline' });
            }
        }

        const createdSubtasks = await Task.splitTask(id, subtasks, req.user.id);

        // Real-time обновление
        if (global.io) {
            global.io.emit('task_split', {
                parentTaskId: parseInt(id),
                subtaskIds: createdSubtasks,
                splitBy: {
                    id: req.user.id,
                    username: req.user.username
                }
            });
        }

        res.status(201).json({
            message: 'Task split successfully',
            parent_task_id: parseInt(id),
            subtask_ids: createdSubtasks
        });

    } catch (error) {
        console.error('Error splitting task:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Получить подзадачи
router.get('/:id/subtasks', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        const task = await Task.findById(id);
        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const subtasks = await Task.getSubtasks(id);
        res.json(subtasks.map(subtask => subtask.toPublic()));

    } catch (error) {
        console.error('Error fetching subtasks:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Получить статистику по сложности
router.get('/complexity-stats', authenticateToken, async (req, res) => {
    try {
        const { project_id, exclude_archived, date_from, date_to } = req.query;
        const filters = {};
        
        if (project_id) filters.project_id = project_id;
        if (exclude_archived) filters.exclude_archived = true;
        if (date_from) filters.date_from = date_from;
        if (date_to) filters.date_to = date_to;
        
        const stats = await Task.getComplexityStats(filters);
        res.json(stats);

    } catch (error) {
        console.error('Error fetching complexity stats:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

module.exports = router;
