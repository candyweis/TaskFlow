const express = require('express');
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Получить список всех коллег
router.get('/colleagues', authenticateToken, async (req, res) => {
    try {
        const users = await User.findAll();
        const colleagues = users
            .filter(user => user.is_active)
            .map(user => ({
                id: user.id,
                username: user.username,
                role: user.role,
                telegram: user.telegram,
                phone: user.phone,
                permissions: user.permissions
            }));
        
        res.json(colleagues);
    } catch (error) {
        console.error('Error fetching colleagues:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Получить исполнителей для назначения задач
router.get('/workers', authenticateToken, async (req, res) => {
    try {
        const workers = await User.findWorkers();
        res.json(workers.map(user => user.toPublic()));
    } catch (error) {
        console.error('Error fetching workers:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Получить пользователя по ID
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const user = await User.findById(id);
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json(user.toPublic());
    } catch (error) {
        console.error('Error fetching user:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Обновить профиль текущего пользователя
router.put('/profile', authenticateToken, async (req, res) => {
    try {
        const { telegram, phone } = req.body;
        const userId = req.user.id;

        // Получаем текущие данные пользователя
        const currentUser = await User.findById(userId);
        if (!currentUser) {
            return res.status(404).json({ error: 'User not found' });
        }

        await User.update(userId, {
            role: currentUser.role,
            permissions: currentUser.permissions,
            is_active: currentUser.is_active,
            telegram: telegram || currentUser.telegram,
            phone: phone || currentUser.phone
        });

        res.json({ message: 'Profile updated successfully' });
        
    } catch (error) {
        console.error('Error updating profile:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

module.exports = router;
