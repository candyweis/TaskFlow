const express = require('express');
const Project = require('../models/Project');
const Task = require('../models/Task');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Получить все проекты
router.get('/', authenticateToken, async (req, res) => {
    try {
        const projects = await Project.findAll();
        res.json(projects.map(project => project.toPublic()));
    } catch (error) {
        console.error('Error fetching projects:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Получить проекты пользователя
router.get('/my', authenticateToken, async (req, res) => {
    try {
        const projects = await Project.findByUser(req.user.id);
        res.json(projects.map(project => project.toPublic()));
    } catch (error) {
        console.error('Error fetching user projects:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Получить проект по ID
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const project = await Project.findById(id);
        
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        res.json(project.toPublic());
    } catch (error) {
        console.error('Error fetching project:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Создать проект (могут пользователи с правами на создание задач)
router.post('/', authenticateToken, async (req, res) => {
    try {
        const permissions = req.user.permissions || {};
        
        // Теперь создавать проекты могут пользователи с правами на создание задач
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

        // Возвращаем простой ответ без лишних полей
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
router.put('/:id', authenticateToken, async (req, res) => {
    try {
        const permissions = req.user.permissions || {};
        if (!permissions.canManageProjects && !permissions.canManageTasks && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'No permission to update projects' });
        }

        const { id } = req.params;
        const { name, description } = req.body;

        // Проверяем, существует ли проект
        const existingProject = await Project.findById(id);
        if (!existingProject) {
            return res.status(404).json({ error: 'Project not found' });
        }

        // Проверяем права на редактирование
        if (!existingProject.canEdit(req.user.id, req.user.role)) {
            return res.status(403).json({ error: 'No permission to edit this project' });
        }

        await Project.update(id, { name, description });
        res.json({ message: 'Project updated successfully' });
        
    } catch (error) {
        console.error('Error updating project:', error);
        if (error.message === 'Project not found') {
            res.status(404).json({ error: 'Project not found' });
        } else {
            res.status(500).json({ error: 'Database error' });
        }
    }
});

// Удалить проект (только менеджеры и админы)
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const permissions = req.user.permissions || {};
        
        // Только менеджеры и админы могут удалять
        if (!permissions.canManageProjects && req.user.role !== 'admin' && req.user.role !== 'manager') {
            return res.status(403).json({ error: 'Only managers and admins can delete projects' });
        }

        const { id } = req.params;

        const existingProject = await Project.findById(id);
        if (!existingProject) {
            return res.status(404).json({ error: 'Project not found' });
        }

        await Project.delete(id);
        res.json({ message: 'Project deleted successfully' });
        
    } catch (error) {
        console.error('Error deleting project:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Получить статистику проекта
router.get('/:id/stats', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        
        const project = await Project.findById(id);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const stats = await Project.getStats(id);
        const participants = await Project.getParticipants(id);

        res.json({
            project: project.toPublic(),
            stats,
            participants
        });
        
    } catch (error) {
        console.error('Error getting project stats:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Получить участников проекта
router.get('/:id/participants', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        
        const project = await Project.findById(id);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const participants = await Project.getParticipants(id);
        res.json(participants);
        
    } catch (error) {
        console.error('Error getting project participants:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Получить задачи проекта
router.get('/:id/tasks', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        
        const project = await Project.findById(id);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const tasks = await Task.findAll({ project_id: id });
        res.json(tasks.map(task => task.toPublic()));
        
    } catch (error) {
        console.error('Error getting project tasks:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

module.exports = router;
