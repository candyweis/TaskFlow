const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');

// Middleware для проверки прав на аналитику
const requireAnalyticsAccess = (req, res, next) => {
    if (req.user.role === 'admin' || req.user.role === 'manager') {
        next();
    } else {
        res.status(403).json({ error: 'Access denied. Analytics available only for admins and managers.' });
    }
};

// Общая статистика системы
router.get('/dashboard', authenticateToken, requireAnalyticsAccess, async (req, res) => {
    try {
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

        const timeStats = await new Promise((resolve, reject) => {
            db.all(timeQuery, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        // Базовая статистика
        const baseQuery = `
            SELECT 
                COUNT(DISTINCT t.id) as total_tasks,
                SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) as completed_tasks,
                SUM(CASE WHEN t.status IN ('unassigned', 'in_progress', 'developed', 'review', 'deploy') THEN 1 ELSE 0 END) as active_tasks,
                SUM(CASE WHEN t.deadline < datetime('now') AND t.status NOT IN ('done', 'archived') THEN 1 ELSE 0 END) as overdue_tasks,
                AVG(CASE WHEN t.status = 'done' THEN 
                    (julianday(t.updated_at) - julianday(t.created_at)) 
                    ELSE NULL END) as avg_completion_days
            FROM tasks t
            WHERE 1=1
        `;

        let queryParams = [];
        let finalQuery = baseQuery;

        if (project_id) {
            finalQuery += ' AND t.project_id = ?';
            queryParams.push(project_id);
        }

        const [dashboardStats] = await new Promise((resolve, reject) => {
            db.get(finalQuery, queryParams, (err, row) => {
                if (err) reject(err);
                else resolve([row]);
            });
        });

        res.json({
            period: period || 'all_time',
            dashboard: {
                ...dashboardStats,
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

// Отчет по времени сотрудников
router.get('/time-report', authenticateToken, requireAnalyticsAccess, async (req, res) => {
    try {
        const { start_date, end_date, employee_id, project_id } = req.query;
        
        let query = `
            SELECT 
                u.username,
                u.id as user_id,
                t.title as task_title,
                t.id as task_id,
                t.complexity,
                t.priority,
                p.name as project_name,
                tl.hours_spent,
                tl.comment,
                tl.logged_at,
                CASE t.status WHEN 'done' THEN 1 ELSE 0 END as is_completed
            FROM task_time_logs tl
            JOIN users u ON tl.user_id = u.id
            JOIN tasks t ON tl.task_id = t.id
            LEFT JOIN projects p ON t.project_id = p.id
            WHERE 1=1
        `;
        
        const params = [];
        
        if (start_date) {
            query += ' AND tl.logged_at >= ?';
            params.push(start_date);
        }
        
        if (end_date) {
            query += ' AND tl.logged_at <= ?';
            params.push(end_date + ' 23:59:59');
        }
        
        if (employee_id) {
            query += ' AND tl.user_id = ?';
            params.push(employee_id);
        }
        
        if (project_id) {
            query += ' AND t.project_id = ?';
            params.push(project_id);
        }
        
        query += ' ORDER BY tl.logged_at DESC, u.username ASC';
        
        const timeEntries = await new Promise((resolve, reject) => {
            db.all(query, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        // Группируем по пользователям
        const reportByUser = {};
        let totalHours = 0;
        
        timeEntries.forEach(entry => {
            if (!reportByUser[entry.user_id]) {
                reportByUser[entry.user_id] = {
                    username: entry.username,
                    total_hours: 0,
                    completed_tasks: 0,
                    total_tasks: new Set(),
                    entries: []
                };
            }
            
            reportByUser[entry.user_id].total_hours += entry.hours_spent;
            reportByUser[entry.user_id].total_tasks.add(entry.task_id);
            if (entry.is_completed) {
                reportByUser[entry.user_id].completed_tasks++;
            }
            reportByUser[entry.user_id].entries.push(entry);
            totalHours += entry.hours_spent;
        });

        // Конвертируем Set в число
        Object.values(reportByUser).forEach(user => {
            user.total_tasks = user.total_tasks.size;
        });

        res.json({
            summary: {
                total_hours: totalHours,
                total_entries: timeEntries.length,
                unique_users: Object.keys(reportByUser).length
            },
            by_user: reportByUser,
            entries: timeEntries,
            filters: {
                start_date,
                end_date,
                employee_id,
                project_id
            }
        });

    } catch (error) {
        console.error('Error generating time report:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Экспорт данных в CSV
router.get('/export/:type', authenticateToken, requireAnalyticsAccess, async (req, res) => {
    try {
        const { type } = req.params;
        const { format = 'csv', start_date, end_date, employee_id, project_id } = req.query;

        let data = [];
        let filename = '';
        let headers = [];

        switch (type) {
            case 'time-logs':
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

                data = await new Promise((resolve, reject) => {
                    db.all(timeQuery, timeParams, (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows);
                    });
                });

                headers = ['Сотрудник', 'Задача', 'Сложность', 'Приоритет', 'Проект', 'Часы', 'Комментарий', 'Дата'];
                filename = 'time_logs_export';
                break;

            case 'tasks':
                const tasksQuery = `
                    SELECT 
                        t.title,
                        t.status,
                        t.priority,
                        t.complexity,
                        u.username as created_by,
                        p.name as project_name,
                        t.created_at,
                        t.deadline,
                        COALESCE(SUM(tl.hours_spent), 0) as total_hours
                    FROM tasks t
                    LEFT JOIN users u ON t.created_by = u.id
                    LEFT JOIN projects p ON t.project_id = p.id
                    LEFT JOIN task_time_logs tl ON t.id = tl.task_id
                    WHERE 1=1
                    ${start_date ? 'AND t.created_at >= ?' : ''}
                    ${end_date ? 'AND t.created_at <= ?' : ''}
                    ${project_id ? 'AND t.project_id = ?' : ''}
                    GROUP BY t.id
                    ORDER BY t.created_at DESC
                `;

                const taskParams = [];
                if (start_date) taskParams.push(start_date);
                if (end_date) taskParams.push(end_date + ' 23:59:59');
                if (project_id) taskParams.push(project_id);

                data = await new Promise((resolve, reject) => {
                    db.all(tasksQuery, taskParams, (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows);
                    });
                });

                headers = ['Задача', 'Статус', 'Приоритет', 'Сложность', 'Создатель', 'Проект', 'Создана', 'Дедлайн', 'Всего часов'];
                filename = 'tasks_export';
                break;

            default:
                return res.status(400).json({ error: 'Invalid export type' });
        }

        if (format === 'csv') {
            // Генерируем CSV
            const csvContent = [
                headers.join(','),
                ...data.map(row => Object.values(row).map(value => 
                    typeof value === 'string' && value.includes(',') ? `"${value}"` : value
                ).join(','))
            ].join('\n');

            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}_${new Date().toISOString().split('T')[0]}.csv"`);
            res.send('\uFEFF' + csvContent); // BOM для корректного отображения в Excel
        } else {
            // JSON формат
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}_${new Date().toISOString().split('T')[0]}.json"`);
            res.json({
                exported_at: new Date().toISOString(),
                type,
                filters: { start_date, end_date, employee_id, project_id },
                headers,
                data
            });
        }

    } catch (error) {
        console.error('Error exporting data:', error);
        res.status(500).json({ error: 'Export failed' });
    }
});

module.exports = router;
