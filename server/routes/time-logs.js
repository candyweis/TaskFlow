const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// Добавить лог времени
router.post('/', authenticateToken, async (req, res) => {
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
router.get('/task/:taskId', authenticateToken, async (req, res) => {
    try {
        const { taskId } = req.params;

        const query = `
            SELECT tl.*, u.username
            FROM task_time_logs tl
            LEFT JOIN users u ON tl.user_id = u.id
            WHERE tl.task_id = ?
            ORDER BY tl.logged_at DESC
        `;
        
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

module.exports = router;
