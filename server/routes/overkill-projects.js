const express = require('express');
const OverkillProject = require('../models/OverkillProject');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Получить все проекты оверлиф
router.get('/', authenticateToken, async (req, res) => {
    try {
        const projects = await OverkillProject.findAll();
        res.json(projects.map(project => project.toPublic()));
    } catch (error) {
        console.error('Error fetching overkill projects:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Получить проект оверлиф по ID
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const project = await OverkillProject.findById(id);
        
        if (!project) {
            return res.status(404).json({ error: 'Overkill project not found' });
        }

        res.json(project.toPublic());
    } catch (error) {
        console.error('Error fetching overkill project:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Создать проект оверлиф
router.post('/', authenticateToken, async (req, res) => {
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

        res.status(201).json({ 
            message: 'Overkill project created successfully',
            id: project.id
        });
        
    } catch (error) {
        console.error('Error creating overkill project:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Обновить проект оверлиф
router.put('/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, project_link } = req.body;

        const existingProject = await OverkillProject.findById(id);
        if (!existingProject) {
            return res.status(404).json({ error: 'Overkill project not found' });
        }

        await OverkillProject.update(id, { name, description, project_link });
        res.json({ message: 'Overkill project updated successfully' });
        
    } catch (error) {
        console.error('Error updating overkill project:', error);
        if (error.message === 'Overkill project not found') {
            res.status(404).json({ error: 'Overkill project not found' });
        } else {
            res.status(500).json({ error: 'Database error' });
        }
    }
});

// Удалить проект оверлиф
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        const existingProject = await OverkillProject.findById(id);
        if (!existingProject) {
            return res.status(404).json({ error: 'Overkill project not found' });
        }

        await OverkillProject.delete(id);
        res.json({ message: 'Overkill project deleted successfully' });
        
    } catch (error) {
        console.error('Error deleting overkill project:', error);
        if (error.message === 'Overkill project not found') {
            res.status(404).json({ error: 'Overkill project not found' });
        } else {
            res.status(500).json({ error: 'Database error' });
        }
    }
});

module.exports = router;
