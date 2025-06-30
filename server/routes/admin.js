const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Project = require('../models/Project');
const Task = require('../models/Task');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// Получить всех пользователей (только для админов)
router.get('/users', authenticateToken, requireRole(['admin']), async (req, res) => {
    try {
        const users = await User.findAll();
        res.json(users.map(user => user.toPublic()));
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Создать пользователя
router.post('/users', authenticateToken, requireRole(['admin']), async (req, res) => {
    try {
        const { username, password, role, permissions, telegram, phone } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }

        // Проверяем, существует ли уже пользователь
        const existingUser = await User.findByUsername(username);
        if (existingUser) {
            return res.status(400).json({ error: 'Username already exists' });
        }

        const hashedPassword = bcrypt.hashSync(password, 10);

        const user = await User.create({
            username,
            password: hashedPassword,
            role,
            permissions: permissions || {},
            telegram,
            phone
        });

        res.json({ 
            message: 'User created successfully', 
            user: user.toPublic() 
        });
        
    } catch (error) {
        console.error('Error creating user:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Обновить пользователя
router.put('/users/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
    try {
        const { id } = req.params;
        const { role, permissions, is_active, telegram, phone } = req.body;

        await User.update(id, {
            role,
            permissions: permissions || {},
            is_active: is_active !== undefined ? is_active : 1,
            telegram,
            phone
        });

        res.json({ message: 'User updated successfully' });
        
    } catch (error) {
        console.error('Error updating user:', error);
        if (error.message === 'User not found') {
            res.status(404).json({ error: 'User not found' });
        } else {
            res.status(500).json({ error: 'Database error' });
        }
    }
});

// Обновить пароль пользователя
router.put('/users/:id/password', authenticateToken, requireRole(['admin']), async (req, res) => {
    try {
        const { id } = req.params;
        const { password } = req.body;

        if (!password) {
            return res.status(400).json({ error: 'Password required' });
        }

        const hashedPassword = bcrypt.hashSync(password, 10);
        await User.updatePassword(id, hashedPassword);

        res.json({ message: 'Password updated successfully' });
        
    } catch (error) {
        console.error('Error updating password:', error);
        if (error.message === 'User not found') {
            res.status(404).json({ error: 'User not found' });
        } else {
            res.status(500).json({ error: 'Database error' });
        }
    }
});

// Деактивировать пользователя
router.patch('/users/:id/deactivate', authenticateToken, requireRole(['admin']), async (req, res) => {
    try {
        const { id } = req.params;

        // Не позволяем деактивировать главного админа
        if (parseInt(id) === 1) {
            return res.status(400).json({ error: 'Cannot deactivate main admin' });
        }

        await User.deactivate(id);
        res.json({ message: 'User deactivated successfully' });
        
    } catch (error) {
        console.error('Error deactivating user:', error);
        if (error.message === 'User not found') {
            res.status(404).json({ error: 'User not found' });
        } else {
            res.status(500).json({ error: 'Database error' });
        }
    }
});

// Удалить пользователя
router.delete('/users/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
    try {
        const { id } = req.params;

        await User.delete(id);
        res.json({ message: 'User deleted successfully' });
        
    } catch (error) {
        console.error('Error deleting user:', error);
        if (error.message === 'Cannot delete main admin') {
            res.status(400).json({ error: 'Cannot delete main admin' });
        } else if (error.message === 'User not found') {
            res.status(404).json({ error: 'User not found' });
        } else {
            res.status(500).json({ error: 'Database error' });
        }
    }
});

// Получить статистику системы
router.get('/stats', authenticateToken, requireRole(['admin']), async (req, res) => {
    try {
        const stats = {};

        // Получаем всех активных пользователей
        const users = await User.findAll();
        stats.activeUsers = users.filter(u => u.is_active).length;

        // Получаем все проекты
        const projects = await Project.findAll();
        stats.totalProjects = projects.length;

        // Получаем все задачи и группируем по статусам
        const tasks = await Task.findAll();
        stats.tasksByStatus = {};
        
        tasks.forEach(task => {
            if (!stats.tasksByStatus[task.status]) {
                stats.tasksByStatus[task.status] = 0;
            }
            stats.tasksByStatus[task.status]++;
        });

        // Дополнительная статистика
        stats.totalTasks = tasks.length;
        stats.completedTasks = stats.tasksByStatus.done || 0;
        stats.overdueTasks = (await Task.findOverdue()).length;

        // Статистика по ролям
        stats.usersByRole = {
            admin: users.filter(u => u.role === 'admin').length,
            manager: users.filter(u => u.role === 'manager').length,
            worker: users.filter(u => u.role === 'worker').length
        };

        res.json(stats);
        
    } catch (error) {
        console.error('Error getting stats:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Получить активность пользователей
router.get('/activity', authenticateToken, requireRole(['admin']), async (req, res) => {
    try {
        const users = await User.findAll();
        const userActivity = [];

        for (const user of users) {
            if (!user.is_active) continue;

            const userTasks = await Task.findByAssignee(user.id);
            const completedTasks = userTasks.filter(t => t.status === 'done').length;
            const activeTasks = userTasks.filter(t => t.status !== 'done').length;
            const overdueTasks = userTasks.filter(t => 
                t.status !== 'done' && new Date(t.deadline) < new Date()
            ).length;

            userActivity.push({
                user: user.toPublic(),
                totalTasks: userTasks.length,
                completedTasks,
                activeTasks,
                overdueTasks,
                completionRate: userTasks.length > 0 
                    ? Math.round((completedTasks / userTasks.length) * 100) 
                    : 0
            });
        }

        // Сортируем по количеству выполненных задач
        userActivity.sort((a, b) => b.completedTasks - a.completedTasks);

        res.json(userActivity);
        
    } catch (error) {
        console.error('Error getting user activity:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Получить просроченные задачи
router.get('/overdue-tasks', authenticateToken, requireRole(['admin']), async (req, res) => {
    try {
        const overdueTasks = await Task.findOverdue();
        res.json(overdueTasks.map(task => task.toPublic()));
    } catch (error) {
        console.error('Error getting overdue tasks:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

module.exports = router;
