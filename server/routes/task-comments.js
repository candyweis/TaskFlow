const express = require('express');
const TaskComment = require('../models/TaskComment');
const Task = require('../models/Task');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Получить комментарии к задаче
router.get('/task/:taskId', authenticateToken, async (req, res) => {
    try {
        const { taskId } = req.params;
        
        // Проверяем, существует ли задача
        const task = await Task.findById(taskId);
        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        // Проверяем, может ли пользователь видеть комментарии (назначен на задачу или имеет права управления)
        const permissions = req.user.permissions || {};
        const canView = permissions.canManageTasks || 
                       req.user.role === 'admin' ||
                       task.assignees.includes(req.user.id);

        if (!canView) {
            return res.status(403).json({ error: 'No permission to view comments' });
        }

        const comments = await TaskComment.findByTaskId(taskId);
        res.json(comments.map(comment => comment.toPublic()));
    } catch (error) {
        console.error('Error fetching task comments:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Добавить комментарий к задаче
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { task_id, comment } = req.body;
        
        if (!task_id || !comment || comment.trim() === '') {
            return res.status(400).json({ error: 'Task ID and comment are required' });
        }

        // Проверяем, существует ли задача
        const task = await Task.findById(task_id);
        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        // Проверяем, может ли пользователь комментировать (назначен на задачу или имеет права управления)
        const permissions = req.user.permissions || {};
        const canComment = permissions.canManageTasks || 
                          req.user.role === 'admin' ||
                          task.assignees.includes(req.user.id);

        if (!canComment) {
            return res.status(403).json({ error: 'No permission to comment on this task' });
        }

        const newComment = await TaskComment.create({
            task_id,
            user_id: req.user.id,
            comment: comment.trim()
        });

        res.status(201).json({ 
            message: 'Comment added successfully',
            id: newComment.id
        });
        
    } catch (error) {
        console.error('Error creating task comment:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Удалить комментарий
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        
        // Проверяем права (только автор комментария или админ/менеджер)
        const permissions = req.user.permissions || {};
        const canDelete = permissions.canManageTasks || req.user.role === 'admin';

        if (!canDelete) {
            // Если не админ, проверяем, что пользователь - автор комментария
            const comment = await TaskComment.findById(id);
            if (!comment || comment.user_id !== req.user.id) {
                return res.status(403).json({ error: 'No permission to delete this comment' });
            }
        }

        await TaskComment.delete(id);
        res.json({ message: 'Comment deleted successfully' });
        
    } catch (error) {
        console.error('Error deleting comment:', error);
        if (error.message === 'Comment not found') {
            res.status(404).json({ error: 'Comment not found' });
        } else {
            res.status(500).json({ error: 'Database error' });
        }
    }
});

module.exports = router;
