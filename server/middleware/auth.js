const jwt = require('jsonwebtoken');
const User = require('../models/User');

const JWT_SECRET = 'your-secret-key-change-in-production';

const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        
        // Загружаем актуальные данные пользователя из базы
        const user = await User.findById(decoded.id);
        if (!user) {
            return res.status(403).json({ error: 'User not found' });
        }
        
        // Исправляем структуру req.user
        req.user = {
            id: user.id,
            username: user.username,
            role: user.role,
            permissions: user.permissions // Уже объект, не строка
        };
        
        next();
    } catch (err) {
        console.error('Auth middleware error:', err);
        return res.status(403).json({ error: 'Invalid token' });
    }
};

const requireRole = (roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        next();
    };
};

const requirePermission = (permission) => {
    return (req, res, next) => {
        const permissions = req.user.permissions || {};
        if (!permissions[permission] && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Permission denied' });
        }
        next();
    };
};

module.exports = { authenticateToken, requireRole, requirePermission, JWT_SECRET };
