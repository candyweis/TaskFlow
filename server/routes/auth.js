const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

// Регистрация
router.post('/register', async (req, res) => {
    try {
        const { username, password, role = 'worker' } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }

        // Проверяем, существует ли уже пользователь
        const existingUser = await User.findByUsername(username);
        if (existingUser) {
            return res.status(400).json({ error: 'Username already exists' });
        }

        const hashedPassword = bcrypt.hashSync(password, 10);
        
        // Базовые права для разных ролей
        const defaultPermissions = {
            admin: { 
                canManageUsers: true, 
                canManageProjects: true, 
                canManageTasks: true,
                canDevelop: true,
                canReview: true,
                canDeploy: true
            },
            manager: { 
                canManageProjects: true, 
                canManageTasks: true,
                canDevelop: true,
                canReview: true,
                canDeploy: true
            },
            worker: { 
                canDevelop: true 
            }
        };

        const permissions = defaultPermissions[role] || defaultPermissions.worker;

        const user = await User.create({
            username,
            password: hashedPassword,
            role,
            permissions
        });

        const token = jwt.sign(
            { 
                id: user.id, 
                username, 
                role, 
                permissions: JSON.stringify(permissions)
            },
            JWT_SECRET
        );

        res.json({ 
            token, 
            user: { 
                id: user.id, 
                username, 
                role, 
                permissions 
            } 
        });
        
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Вход
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }

        const user = await User.findByUsername(username);
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        if (!bcrypt.compareSync(password, user.password)) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign(
            { 
                id: user.id, 
                username: user.username, 
                role: user.role, 
                permissions: JSON.stringify(user.permissions)
            },
            JWT_SECRET
        );

        res.json({ 
            token, 
            user: { 
                id: user.id, 
                username: user.username, 
                role: user.role, 
                permissions: user.permissions
            } 
        });
        
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Проверка токена
router.get('/verify', async (req, res) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.id);
        
        if (!user) {
            return res.status(401).json({ error: 'Invalid token' });
        }

        res.json({ 
            user: user.toPublic() 
        });
        
    } catch (error) {
        res.status(401).json({ error: 'Invalid token' });
    }
});

module.exports = router;
