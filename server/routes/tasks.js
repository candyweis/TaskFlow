const express = require('express');
const Task = require('../models/Task');
const User = require('../models/User');
const Project = require('../models/Project');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// СПЕЦИАЛЬНЫЕ РОУТЫ ДОЛЖНЫ БЫТЬ ПЕРВЫМИ (до :id роутов)

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

// Получить просроченные задачи  
router.get('/overdue/list', authenticateToken, async (req, res) => {
    try {
        const overdueTasks = await Task.findOverdue();
        res.json(overdueTasks.map(task => task.toPublic()));
    } catch (error) {
        console.error('Error fetching overdue tasks:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Получить задачи текущего пользователя
router.get('/my/tasks', authenticateToken, async (req, res) => {
    try {
        const tasks = await Task.findByAssignee(req.user.id);
        res.json(tasks.map(task => task.toPublic()));
    } catch (error) {
        console.error('Error fetching user tasks:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Архивировать задачу
router.patch('/:id/archive', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        console.log(`Archiving task ${id} by user ${req.user.id}`);

        // Проверяем, существует ли задача
        const task = await Task.findById(id);
        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const permissions = req.user.permissions || {};
        
        // Проверяем права на архивирование
        const canArchive = permissions.canManageTasks || 
                          req.user.role === 'admin' ||
                          (task.assignees && task.assignees.includes(req.user.id));

        if (!canArchive) {
            return res.status(403).json({ error: 'No permission to archive this task' });
        }

        await Task.updateStatus(id, 'archived');
        console.log(`Task ${id} archived successfully`);
        res.json({ message: 'Task archived successfully' });
        
    } catch (error) {
        console.error('Error archiving task:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Восстановить задачу из архива
router.patch('/:id/unarchive', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        // Проверяем, существует ли задача
        const task = await Task.findById(id);
        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const permissions = req.user.permissions || {};
        
        // Проверяем права на восстановление
        const canUnarchive = permissions.canManageTasks || 
                            req.user.role === 'admin';

        if (!canUnarchive) {
            return res.status(403).json({ error: 'No permission to unarchive this task' });
        }

        await Task.updateStatus(id, 'done');
        res.json({ message: 'Task unarchived successfully' });
        
    } catch (error) {
        console.error('Error unarchiving task:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Обновить статус задачи
router.patch('/:id/status', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!status) {
            return res.status(400).json({ error: 'Status is required' });
        }

        // Проверяем, существует ли задача
        const task = await Task.findById(id);
        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const permissions = req.user.permissions || {};
        
        // Проверяем права на изменение статуса
        const canChangeStatus = permissions.canManageTasks || 
                               req.user.role === 'admin' ||
                               (task.assignees && task.assignees.includes(req.user.id));
        
        if (!canChangeStatus) {
            return res.status(403).json({ error: 'No permission to change this status' });
        }

        await Task.updateStatus(id, status);
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
router.post('/:id/assign', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { user_ids } = req.body;

        if (!user_ids || !Array.isArray(user_ids)) {
            return res.status(400).json({ error: 'User IDs array is required' });
        }

        // Проверяем, существует ли задача
        const task = await Task.findById(id);
        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const permissions = req.user.permissions || {};
        
        // Проверяем права на назначение
        const canAssign = permissions.canManageTasks || 
                         req.user.role === 'admin' ||
                         task.created_by === req.user.id;
        
        if (!canAssign) {
            return res.status(403).json({ error: 'No permission to assign this task' });
        }

        // Проверяем, существуют ли пользователи
        for (const userId of user_ids) {
            const user = await User.findById(userId);
            if (!user) {
                return res.status(400).json({ error: `User with id ${userId} not found` });
            }
        }

        // Обновляем назначения
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

        res.json({ message: 'Task assigned successfully' });
        
    } catch (error) {
        console.error('Error assigning task:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Получить комментарии к задаче
router.get('/:taskId/comments', authenticateToken, async (req, res) => {
    try {
        const { taskId } = req.params;
        
        // Проверяем, существует ли задача
        const task = await Task.findById(taskId);
        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        // Проверяем, может ли пользователь видеть комментарии
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
router.post('/:taskId/comments', authenticateToken, async (req, res) => {
    try {
        const { taskId } = req.params;
        const { comment } = req.body;
        
        if (!comment || comment.trim() === '') {
            return res.status(400).json({ error: 'Comment text is required' });
        }

        // Проверяем, существует ли задача
        const task = await Task.findById(taskId);
        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        // Проверяем, может ли пользователь комментировать
        const permissions = req.user.permissions || {};
        const canComment = permissions.canManageTasks || 
                          req.user.role === 'admin' ||
                          (task.assignees && task.assignees.includes(req.user.id));

        if (!canComment) {
            return res.status(403).json({ error: 'No permission to comment on this task' });
        }

        const newComment = await Task.addComment(taskId, req.user.id, comment.trim());

        res.status(201).json({ 
            message: 'Comment added successfully',
            id: newComment.id
        });
        
    } catch (error) {
        console.error('Error creating task comment:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Получить все задачи (исключая архивированные)
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { project_id, status, assignee_id, priority, include_archived } = req.query;
        
        const filters = {};
        if (project_id) filters.project_id = project_id;
        if (status) filters.status = status;
        if (assignee_id) filters.assignee_id = assignee_id;
        if (priority) filters.priority = priority;
        
        // По умолчанию исключаем архивированные задачи
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
router.get('/:id', authenticateToken, async (req, res) => {
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
router.post('/', authenticateToken, async (req, res) => {
    try {
        const permissions = req.user.permissions || {};
        if (!permissions.canManageTasks && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'No permission to create tasks' });
        }

        const { title, goal, description, project_link, overkill_project_id, project_id, priority, deadline, assignees } = req.body;
        
        if (!title || title.trim() === '') {
            return res.status(400).json({ error: 'Task title is required' });
        }

        // Проверяем, существует ли проект (если указан)
        if (project_id) {
            const project = await Project.findById(project_id);
            if (!project) {
                return res.status(400).json({ error: 'Project not found' });
            }
        }

        // Проверяем, существуют ли назначенные пользователи
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
router.put('/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { title, goal, description, project_link, overkill_project_id, priority, deadline, assignees } = req.body;

        // Проверяем, существует ли задача
        const existingTask = await Task.findById(id);
        if (!existingTask) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const permissions = req.user.permissions || {};
        
        // Проверяем права на редактирование
        const canEdit = permissions.canManageTasks || 
                       req.user.role === 'admin' ||
                       existingTask.created_by === req.user.id;
        
        if (!canEdit) {
            return res.status(403).json({ error: 'No permission to edit this task' });
        }

        // Проверяем, существуют ли назначенные пользователи
        if (assignees && assignees.length > 0) {
            for (const assigneeId of assignees) {
                const user = await User.findById(assigneeId);
                if (!user) {
                    return res.status(400).json({ error: `User with id ${assigneeId} not found` });
                }
            }
        }

        await Task.update(id, {
            title,
            goal,
            description,
            project_link,
            overkill_project_id,
            priority,
            deadline,
            assignees: assignees || []
        });

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

// Удалить задачу (только менеджеры и админы)
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        // Проверяем, существует ли задача
        const existingTask = await Task.findById(id);
        if (!existingTask) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const permissions = req.user.permissions || {};
        
        // Только менеджеры и админы могут удалять
        const canDelete = permissions.canManageTasks || 
                         req.user.role === 'admin' || 
                         req.user.role === 'manager';
        
        if (!canDelete) {
            return res.status(403).json({ error: 'Only managers and admins can delete tasks' });
        }

        await Task.delete(id);
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

module.exports = router;
